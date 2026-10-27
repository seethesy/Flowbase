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
import type { EventHub } from "../../shared/event-hub";
import type { EventRoster, ShiftInput } from "../../shared/event-staff";

// Staff assignment and Production Leads (FLOW-140) through the real API and
// database: shifts and slots, double-booking warnings (AC1), open slots and the
// staffing breakdown (AC2), and the Production Lead rules (AC3, AC4).

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1400000-0000-4000-8000-000000000001",
  manager: "c1400000-0000-4000-8000-000000000002",
  sam: "c1400000-0000-4000-8000-000000000003",
  jamie: "c1400000-0000-4000-8000-000000000004",
  casey: "c1400000-0000-4000-8000-000000000005",
  kit: "c1400000-0000-4000-8000-000000000006",
  gone: "c1400000-0000-4000-8000-000000000007",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["jamie", "staff", "part_time"],
  ["casey", "staff", "full_time"],
  ["kit", "kitchen_staff", "part_time"],
  ["gone", "staff", "full_time"],
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
  const send = async <T>(
    method: string,
    path: string,
    body?: unknown,
    status = method === "POST" ? 201 : 200,
  ) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs("admin");
const manager = signedInAs("manager");
const sam = signedInAs("sam");
const jamie = signedInAs("jamie");
const kit = signedInAs("kit");

const tables = sql`truncate table event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@roster.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255590${i}`,
      status: name === "gone" ? ("deactivated" as const) : ("active" as const),
    })),
  );
});
afterAll(async () => {
  // Other suites delete users; leave no slot pointing at one.
  await db.execute(tables);
  await client.end();
});

let clientId = "";
const newEvent = async (title: string, date = "2026-11-14") => {
  if (!clientId)
    clientId = (
      await sam.send<Client>("POST", "/api/clients", {
        name: "Juniper & Co.",
        kind: "organization",
        contacts: [],
      })
    ).id;
  return sam.send<FlowEvent>("POST", "/api/events", {
    title,
    date,
    startTime: "18:00",
    endTime: "23:00",
    clientId,
  });
};
beforeEach(() => {
  clientId = "";
});
const addShift = (event: FlowEvent, input: ShiftInput, as = sam) =>
  as.send<EventRoster>("POST", `/api/events/${event.id}/shifts`, input);
const addSlots = (
  event: FlowEvent,
  shiftId: string,
  position: string,
  count = 1,
  department = "service",
) =>
  sam.send<EventRoster>("POST", `/api/events/${event.id}/slots`, {
    shiftId,
    position,
    department,
    count,
  });
const assign = (event: FlowEvent, slotId: string, assigneeId: string | null) =>
  sam.send<EventRoster>("PATCH", `/api/events/${event.id}/slots/${slotId}`, {
    assigneeId,
  });
const eventDay = (date = "2026-11-14"): ShiftInput => ({
  kind: "event_day",
  date,
  startTime: "16:00",
  endTime: "23:30",
});

describe("roster", () => {
  it("builds a multi-day roster with numbered open slots and a staffing breakdown (AC2)", async () => {
    const gala = await newEvent("Fall gala");
    await addShift(gala, {
      kind: "pull_load",
      date: "2026-11-13",
      startTime: "08:00",
      endTime: "12:00",
      activities: "Pull rentals and load Truck 1",
    });
    await addShift(gala, {
      kind: "setup",
      date: "2026-11-13",
      startTime: "13:00",
      endTime: "18:00",
    });
    let roster = await addShift(gala, eventDay());
    expect(roster.shifts.map((shift) => shift.kind)).toEqual([
      "pull_load",
      "setup",
      "event_day",
    ]);
    expect(roster.shifts[0]).toMatchObject({
      date: "2026-11-13",
      startTime: "08:00",
      endTime: "12:00",
      activities: "Pull rentals and load Truck 1",
    });
    const [pull, setup, day] = roster.shifts;
    await addSlots(gala, pull.id, "Pull/Load crew", 2, "pull_load");
    await addSlots(gala, setup.id, "Sous Chef", 3, "kitchen");
    await addSlots(gala, day.id, "Chef on site", 1, "kitchen");
    roster = await addSlots(gala, day.id, "Server", 5);
    const servers = roster.shifts[2].slots.filter((s) => s.position === "Server");
    expect(servers.map((slot) => slot.number)).toEqual([1, 2, 3, 4, 5]);
    expect(roster.shifts[2].slots[0]).toMatchObject({
      position: "Chef on site",
      number: null,
    });
    roster = await assign(gala, servers[0].id, people.jamie);
    roster = await assign(gala, roster.shifts[1].slots[0].id, people.kit);
    expect(roster.shifts[2].slots[1].assignee).toEqual({
      id: people.jamie,
      name: "Jamie",
    });
    expect(roster.shifts[2].slots[5]).toMatchObject({
      number: 5,
      assignee: null,
    });
    expect(roster.breakdown).toEqual([
      { department: "kitchen", total: 4, filled: 1 },
      { department: "service", total: 5, filled: 1 },
      { department: "pull_load", total: 2, filled: 0 },
    ]);
    expect(roster.openSlots).toBe(9);
    expect(roster).toMatchObject({ canEdit: true, canNameLeads: false });

    // Removing a shift removes its slots from the roster and the breakdown.
    roster = await sam.send<EventRoster>(
      "POST",
      `/api/events/${gala.id}/shifts/${pull.id}/archive`,
      {},
      200,
    );
    expect(roster.shifts).toHaveLength(2);
    expect(roster.openSlots).toBe(7);
    const hub = await sam.send<EventHub>("GET", `/api/events/${gala.id}/hub`);
    expect(hub.sections).toContain("staff");
  });

  it("warns about double-booking on both overlapping shifts, not on back-to-back ones (AC1)", async () => {
    const gala = await newEvent("Fall gala");
    const brunch = await newEvent("Board brunch");
    const galaRoster = await addShift(gala, eventDay());
    const brunchRoster = await addShift(brunch, {
      kind: "event_day",
      date: "2026-11-14",
      startTime: "09:00",
      endTime: "16:00",
    });
    const galaSlot = (await addSlots(gala, galaRoster.shifts[0].id, "Server"))
      .shifts[0].slots[0];
    const brunchSlot = (
      await addSlots(brunch, brunchRoster.shifts[0].id, "Server")
    ).shifts[0].slots[0];
    await assign(gala, galaSlot.id, people.jamie);
    // Back to back (brunch ends at 4 pm when the gala shift starts): no warning.
    let roster = await assign(brunch, brunchSlot.id, people.jamie);
    expect(roster.shifts[0].slots[0].conflicts).toEqual([]);

    // Moving the brunch shift to overlap warns on both events.
    roster = await sam.send<EventRoster>(
      "PUT",
      `/api/events/${brunch.id}/shifts/${brunchRoster.shifts[0].id}`,
      { kind: "event_day", date: "2026-11-14", startTime: "12:00", endTime: "17:00" },
    );
    expect(roster.shifts[0].slots[0].conflicts).toEqual([
      expect.objectContaining({
        eventId: gala.id,
        eventTitle: "Fall gala",
        shiftKind: "event_day",
      }),
    ]);
    const gala2 = await sam.send<EventRoster>("GET", `/api/events/${gala.id}/roster`);
    expect(gala2.shifts[0].slots[0].conflicts).toEqual([
      expect.objectContaining({ eventId: brunch.id, eventTitle: "Board brunch" }),
    ]);

    // Two slots on the same shift overlap too.
    const second = (await addSlots(gala, galaRoster.shifts[0].id, "Bartender"))
      .shifts[0].slots[1];
    roster = await assign(gala, second.id, people.jamie);
    expect(roster.shifts[0].slots[1].conflicts.map((c) => c.eventId)).toEqual(
      expect.arrayContaining([gala.id, brunch.id]),
    );

    // A lost event no longer counts.
    await admin.send("POST", `/api/events/${brunch.id}/status`, {
      status: "lost",
    }, 200);
    roster = await assign(gala, second.id, null);
    expect(roster.shifts[0].slots[0].conflicts).toEqual([]);
  });

  it("hides the other event's title from someone who can't open it", async () => {
    const gala = await newEvent("Fall gala");
    const other = await admin.send<FlowEvent>("POST", "/api/events", {
      title: "Someone else's party",
      date: "2026-11-14",
      startTime: "18:00",
      clientId: (
        await admin.send<Client>("POST", "/api/clients", {
          name: "Glasshouse",
          kind: "organization",
          contacts: [],
        })
      ).id,
      assignedSalespersonId: people.manager,
    });
    const otherRoster = await addShift(other, eventDay(), admin);
    const otherSlot = (
      await admin.send<EventRoster>("POST", `/api/events/${other.id}/slots`, {
        shiftId: otherRoster.shifts[0].id,
        position: "Server",
        department: "service",
      })
    ).shifts[0].slots[0];
    await admin.send(
      "PATCH",
      `/api/events/${other.id}/slots/${otherSlot.id}`,
      { assigneeId: people.jamie },
    );
    const roster = await addShift(gala, eventDay());
    const slot = (await addSlots(gala, roster.shifts[0].id, "Server")).shifts[0]
      .slots[0];
    const assigned = await assign(gala, slot.id, people.jamie);
    expect(assigned.shifts[0].slots[0].conflicts).toEqual([
      expect.objectContaining({ eventId: other.id, eventTitle: null }),
    ]);
  });

  it("notifies the assignee and lets assigned staff open the event", async () => {
    const gala = await newEvent("Fall gala");
    const roster = await addShift(gala, eventDay());
    const slot = (await addSlots(gala, roster.shifts[0].id, "Server")).shifts[0]
      .slots[0];
    expect((await jamie.call("GET", `/api/events/${gala.id}`)).status).toBe(404);
    await assign(gala, slot.id, people.jamie);
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "event:event.staff_assigned"));
    expect(jobs.map((job) => job.payload)).toEqual([
      expect.objectContaining({
        entityId: gala.id,
        slotId: slot.id,
        userId: people.jamie,
        previousUserId: null,
      }),
    ]);
    expect((await jamie.call("GET", `/api/events/${gala.id}`)).status).toBe(200);
    const seen = await jamie.send<EventRoster>(
      "GET",
      `/api/events/${gala.id}/roster`,
    );
    expect(seen.canEdit).toBe(false);
    // Unassigning ends access again.
    await assign(gala, slot.id, null);
    expect((await jamie.call("GET", `/api/events/${gala.id}`)).status).toBe(404);
  });

  it("rejects inactive assignees, unknown positions and other events' shifts", async () => {
    const gala = await newEvent("Fall gala");
    const brunch = await newEvent("Board brunch");
    const roster = await addShift(gala, eventDay());
    const shiftId = roster.shifts[0].id;
    const slot = (await addSlots(gala, shiftId, "Server")).shifts[0].slots[0];
    const inactive = await sam.call(
      "PATCH",
      `/api/events/${gala.id}/slots/${slot.id}`,
      { assigneeId: people.gone },
    );
    expect(inactive.status).toBe(400);
    const unknown = await sam.call("POST", `/api/events/${gala.id}/slots`, {
      shiftId,
      position: "Juggler",
      department: "other",
    });
    expect(unknown.status).toBe(400);
    const elsewhere = await sam.call("POST", `/api/events/${brunch.id}/slots`, {
      shiftId,
      position: "Server",
      department: "service",
    });
    expect(elsewhere.status).toBe(404);
    const backwards = await sam.call("POST", `/api/events/${gala.id}/shifts`, {
      ...eventDay(),
      endTime: "16:00",
    });
    expect(backwards.status).toBe(400);
    // Staff without events.write read the roster but can't change it.
    await assign(gala, slot.id, people.kit);
    expect(
      (await kit.call("POST", `/api/events/${gala.id}/shifts`, eventDay()))
        .status,
    ).toBe(403);
  });
});

describe("Production Leads", () => {
  const setLeads = (
    as: ReturnType<typeof signedInAs>,
    event: FlowEvent,
    body: unknown,
  ) => as.call("PUT", `/api/events/${event.id}/production-leads`, body);

  it("can't have assistants without a primary (AC3)", async () => {
    const gala = await newEvent("Fall gala");
    const response = await setLeads(manager, gala, {
      productionLeadId: null,
      assistantLeadIds: [people.jamie],
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "Name a primary Production Lead before adding assistants.",
    );
  });

  it("names only full-time staff as the primary (AC4)", async () => {
    const gala = await newEvent("Fall gala");
    const partTime = await setLeads(manager, gala, {
      productionLeadId: people.jamie,
      assistantLeadIds: [],
    });
    expect(partTime.status).toBe(400);
    expect((await partTime.json()).error.message).toBe(
      "Only full-time staff can be the primary Production Lead.",
    );
    const inactive = await setLeads(manager, gala, {
      productionLeadId: people.gone,
      assistantLeadIds: [],
    });
    expect(inactive.status).toBe(400);

    const ok = await setLeads(manager, gala, {
      productionLeadId: people.casey,
      assistantLeadIds: [people.jamie],
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      productionLeadId: people.casey,
      assistantLeadIds: [people.jamie],
    });
    const roster = await sam.send<EventRoster>(
      "GET",
      `/api/events/${gala.id}/roster`,
    );
    expect(roster).toMatchObject({
      productionLead: { id: people.casey, name: "Casey" },
      assistantLeads: [{ id: people.jamie, name: "Jamie" }],
    });
    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "event:event.production_leads_changed"));
    expect(job.payload).toMatchObject({
      entityId: gala.id,
      productionLeadId: people.casey,
      assistantLeadIds: [people.jamie],
      previousProductionLeadId: null,
    });
    // The leads now see the event.
    expect((await jamie.call("GET", `/api/events/${gala.id}`)).status).toBe(200);
  });

  it("is the Sales Manager's and Admin's call, and the event form doesn't change it", async () => {
    const gala = await newEvent("Fall gala");
    expect(
      (
        await setLeads(sam, gala, {
          productionLeadId: people.casey,
          assistantLeadIds: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await setLeads(admin, gala, {
          productionLeadId: people.casey,
          assistantLeadIds: [],
        })
      ).status,
    ).toBe(200);
    const saved = await sam.send<FlowEvent>("PUT", `/api/events/${gala.id}`, {
      title: "Fall gala",
      date: "2026-11-14",
      startTime: "18:00",
      clientId: gala.client.id,
      arrivalTime: "15:30",
      productionLeadId: people.jamie,
    });
    expect(saved).toMatchObject({
      productionLeadId: people.casey,
      arrivalTime: "15:30",
    });
  });
});
