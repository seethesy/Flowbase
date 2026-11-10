import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { EventRoster } from "../../shared/event-staff";
import type { DayOfBoard, DayOfLog, DayOfUpdate } from "../../shared/day-of";

// Day-of board (FLOW-155) and update log (FLOW-156) through the real API and
// database.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1550000-0000-4000-8000-000000000001",
  manager: "c1550000-0000-4000-8000-000000000002",
  sam: "c1550000-0000-4000-8000-000000000003",
  jamie: "c1550000-0000-4000-8000-000000000004",
  casey: "c1550000-0000-4000-8000-000000000005",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["jamie", "staff", "part_time"],
  ["casey", "staff", "part_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const app = createApp({
    withDb,
    resolveActor: async () => ({ userId: people[who], role, employmentType }),
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
  const send = async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const manager = signedInAs("manager");
const sam = signedInAs("sam");
const jamie = signedInAs("jamie");
const casey = signedInAs("casey");

const tables = sql`truncate table closeout_lines, event_closeouts, day_of_updates, day_of_checkpoints, day_of_staff_states, truck_assignments, event_planning_outputs, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@dayof.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255591${i}`,
      status: "active" as const,
    })),
  );
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const DATE = "2026-11-14";
// A gala with Jamie on the event-day shift and a truck assigned, Jamie driving.
async function setup() {
  const { id: clientId } = await sam.send<Client>(
    "POST",
    "/api/clients",
    { name: "Juniper & Co.", kind: "organization", contacts: [] },
    201,
  );
  const gala = await sam.send<FlowEvent>(
    "POST",
    "/api/events",
    { title: "Fall gala", date: DATE, startTime: "18:00", endTime: "23:00", clientId },
    201,
  );
  let roster = await sam.send<EventRoster>(
    "POST",
    `/api/events/${gala.id}/shifts`,
    { kind: "event_day", date: DATE, startTime: "16:00", endTime: "23:30" },
    201,
  );
  roster = await sam.send<EventRoster>(
    "POST",
    `/api/events/${gala.id}/slots`,
    { shiftId: roster.shifts[0].id, position: "Server", department: "service", count: 1 },
    201,
  );
  const slotId = roster.shifts[0].slots[0].id;
  await sam.send("PATCH", `/api/events/${gala.id}/slots/${slotId}`, { assigneeId: people.jamie });
  // The seeded trucks persist between tests; assign the first.
  const trucks = await sam.send<{ trucks: { id: string; name: string }[] }>(
    "GET",
    `/api/events/${gala.id}/trucks`,
  );
  const truckName = trucks.trucks[0].name;
  const assigned = await sam.send<{ assignments: { id: string }[] }>(
    "POST",
    `/api/events/${gala.id}/trucks/assignments`,
    {
      truckId: trucks.trucks[0].id,
      departsAt: "2026-11-14T19:00:00.000Z",
      returnsAt: "2026-11-15T05:00:00.000Z",
      driverId: people.jamie,
      loaderIds: [],
      acknowledgeConflict: false,
    },
    201,
  );
  return { gala, slotId, truckName, assignmentId: assigned.assignments[0].id };
}
const board = (who: ReturnType<typeof signedInAs>) =>
  who.send<DayOfBoard>("GET", `/api/day-of?date=${DATE}`);
const logOf = (who: ReturnType<typeof signedInAs>, eventId: string) =>
  who.send<DayOfLog>("GET", `/api/day-of/events/${eventId}/log`);

describe("day-of board (FLOW-155)", () => {
  it("lists the day's events with their staff, trucks and checkpoints", async () => {
    const { gala, truckName } = await setup();
    const { events, canUpdate } = await board(manager);
    expect(canUpdate).toBe(true);
    expect(events.map((event) => event.title)).toEqual(["Fall gala"]);
    expect(events[0].staff).toMatchObject([{ name: "Jamie", status: "scheduled", location: "" }]);
    expect(events[0].trucks).toMatchObject([{ name: truckName, driverName: "Jamie" }]);
    expect(events[0].checkpoints.map((checkpoint) => checkpoint.key)).toEqual([
      "food_left_kitchen",
      "arrived_at_venue",
      "service_started",
      "service_ended",
    ]);
    expect(events[0].id).toBe(gala.id);
  });

  it("shows another open board a truck status update (AC1)", async () => {
    const { assignmentId } = await setup();
    await manager.send<DayOfUpdate>("PATCH", `/api/day-of/trucks/${assignmentId}`, {
      status: "on_the_road",
      location: "I-95 north",
    });
    // Jamie is the driver, so the event is on their board too.
    const seen = await board(jamie);
    expect(seen.canUpdate).toBe(false);
    expect(seen.events[0].trucks[0]).toMatchObject({ status: "on_the_road", location: "I-95 north" });
  });

  it("records the time food left the kitchen against the timeline (AC2)", async () => {
    const { gala } = await setup();
    const before = Date.now();
    await manager.send<DayOfUpdate>(
      "PUT",
      `/api/day-of/events/${gala.id}/checkpoints/food_left_kitchen`,
      { reached: true },
    );
    const checkpoint = (await board(manager)).events[0].checkpoints[0];
    expect(checkpoint.key).toBe("food_left_kitchen");
    expect(Date.parse(checkpoint.reachedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(checkpoint.reachedByName).toBe("Manager");
    const again = await manager.call("PUT", `/api/day-of/events/${gala.id}/checkpoints/food_left_kitchen`, { reached: true });
    expect(again.status).toBe(409);
  });

  it("keeps updates to managers and the board to people who can open the event", async () => {
    const { gala, slotId, assignmentId } = await setup();
    expect((await jamie.call("PATCH", `/api/day-of/staff/${slotId}`, { status: "on_site" })).status).toBe(403);
    expect((await jamie.call("PATCH", `/api/day-of/trucks/${assignmentId}`, { status: "loading" })).status).toBe(403);
    expect((await jamie.call("PUT", `/api/day-of/events/${gala.id}/checkpoints/service_started`, { reached: true })).status).toBe(403);
    // Casey doesn't work the gala: nothing on the board, no log.
    expect((await board(casey)).events).toEqual([]);
    expect((await casey.call("GET", `/api/day-of/events/${gala.id}/log`)).status).toBe(404);
  });

  it("tells the affected staff about an urgent update, not about the person who made it", async () => {
    const { slotId } = await setup();
    await manager.send("PATCH", `/api/day-of/staff/${slotId}`, { status: "en_route" });
    const quiet = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:event.day_of_changed"));
    expect(quiet.filter((job) => (job.payload as { recipientIds?: string[] }).recipientIds)).toEqual([]);
    await manager.send("PATCH", `/api/day-of/staff/${slotId}`, { status: "on_site", urgent: true });
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:event.day_of_changed"));
    const urgent = jobs.map((job) => job.payload as { recipientIds?: string[] }).filter((p) => p.recipientIds);
    expect(urgent).toHaveLength(1);
    expect(urgent[0].recipientIds).toEqual([people.jamie]);
  });

  it("refuses an update that changes nothing", async () => {
    const { slotId, gala } = await setup();
    const response = await manager.call("PATCH", `/api/day-of/staff/${slotId}`, { status: "scheduled" });
    expect(response.status).toBe(409);
    expect((await logOf(manager, gala.id)).entries).toEqual([]);
  });
});

describe("day-of update log (FLOW-156)", () => {
  it("writes exactly one entry per board update (AC1)", async () => {
    const { gala, slotId, assignmentId, truckName } = await setup();
    await manager.send("PATCH", `/api/day-of/staff/${slotId}`, { status: "on_site", location: "Dock B" });
    await manager.send("PATCH", `/api/day-of/trucks/${assignmentId}`, { status: "loading" });
    await manager.send("PUT", `/api/day-of/events/${gala.id}/checkpoints/food_left_kitchen`, { reached: true });
    const { entries, truncated } = await logOf(manager, gala.id);
    expect(truncated).toBe(false);
    expect(entries).toHaveLength(3);
    // Newest first.
    expect(entries.map((entry) => entry.kind)).toEqual(["checkpoint", "truck", "staff"]);
    expect(entries[2]).toMatchObject({
      subjectName: "Jamie",
      actorName: "Manager",
      summary: 'Jamie (Server): status: Scheduled → On site; location: none → "Dock B"',
    });
    expect(entries[1]).toMatchObject({ truckName, subjectName: truckName });
  });

  it("is visible to the event's staff and no one else, and can't be edited (AC2)", async () => {
    const { gala, slotId } = await setup();
    await manager.send("PATCH", `/api/day-of/staff/${slotId}`, { status: "done" });
    expect((await logOf(jamie, gala.id)).entries).toHaveLength(1);
    // The log is read from the database after the event, whatever its status;
    // rows can't be changed or removed.
    await db.update(schema.events).set({ status: "finished" }).where(eq(schema.events.id, gala.id));
    expect((await logOf(manager, gala.id)).entries).toHaveLength(1);
    await expect(db.execute(sql`update day_of_updates set summary = 'edited'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from day_of_updates`)).rejects.toThrow();
  });
});
