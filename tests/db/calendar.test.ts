import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { HistoryEntry } from "../../shared/audit";
import type { Calendar } from "../../shared/calendar";
import type { Client, EventInput, FlowEvent } from "../../shared/core-records";
import type { EventHub } from "../../shared/event-hub";
import type { EventRoster, ShiftInput } from "../../shared/event-staff";
import type { Task, TaskInput, TaskSummary } from "../../shared/tasks";

// Basic calendar (FLOW-63), its overview mode (FLOW-64) and layers (FLOW-67), and
// the event hub's tasks and history sections (FLOW-166) against Postgres.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c6300000-0000-4000-8000-000000000001",
  sam: "c6300000-0000-4000-8000-000000000002",
  sue: "c6300000-0000-4000-8000-000000000003",
  helper: "c6300000-0000-4000-8000-000000000004",
  casey: "c6300000-0000-4000-8000-000000000005",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["sue", "salesperson", "full_time"],
  // Part-time staff: sees the events they work and their own tasks.
  ["helper", "staff", "part_time"],
  ["casey", "staff", "full_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const actor: Actor = { userId: people[who], role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
  const call = async (method: string, path: string, body?: unknown) =>
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
  return { call, send, get: <T>(path: string) => send<T>("GET", path) };
};
const admin = signedInAs("admin");
const sam = signedInAs("sam");
const sue = signedInAs("sue");
const helper = signedInAs("helper");
const casey = signedInAs("casey");

const tables = sql`truncate table reservation_conflicts, reservations, event_staff_slots, event_shifts, task_comments, task_checklist_items, task_assignees, tasks, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_mappings, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs cascade`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  // Added once and kept; other files' users stay as they are.
  await db
    .insert(schema.users)
    .values(
      directory.map(([name, role, employmentType], i) => ({
        id: people[name],
        email: `${name}@calendar.example`,
        name: name[0].toUpperCase() + name.slice(1),
        role,
        employmentType,
        mobile: `20255595${i}`,
        status: "active" as const,
      })),
    )
    .onConflictDoNothing({ target: schema.users.id });
});
// Rental items the layer tests add, removed at the end.
const items: string[] = [];
afterAll(async () => {
  await db.execute(tables);
  if (items.length)
    await db.delete(schema.inventoryItems).where(inArray(schema.inventoryItems.id, items));
  await db.delete(schema.users).where(inArray(schema.users.id, Object.values(people)));
  await client.end();
});

// The gala is Sam's (the helper is an Assistant Lead), the brunch Sue's; the
// late party runs past midnight; one October event and one archived event.
async function seed() {
  const juniper = await admin.send<Client>(
    "POST",
    "/api/clients",
    { name: "Juniper & Co.", kind: "organization", assignedSalespersonId: people.sam, contacts: [] },
    201,
  );
  const event = (title: string, overrides: Partial<EventInput>) =>
    admin.send<FlowEvent>(
      "POST",
      "/api/events",
      {
        title,
        clientId: juniper.id,
        assignedSalespersonId: people.sam,
        ...overrides,
      },
      201,
    );
  // AC1: created on 9/17 at 5–10 PM.
  const gala = await event("Fall gala", { date: "2026-09-17", startTime: "17:00", endTime: "22:00" });
  const brunch = await event("Board brunch", {
    date: "2026-09-20",
    startTime: "10:00",
    assignedSalespersonId: people.sue,
  });
  const late = await event("Late party", { date: "2026-09-25", startTime: "22:00", endTime: "02:00" });
  const october = await event("Harvest dinner", { date: "2026-10-20", startTime: "18:00" });
  const gone = await event("Cancelled tasting", { date: "2026-09-10", startTime: "12:00" });
  await admin.send("POST", `/api/events/${gone.id}/archive`, {});
  // Stored directly: naming leads through the API is FLOW-140's.
  await db
    .update(schema.events)
    .set({ assistantLeadIds: [people.helper] })
    .where(eq(schema.events.id, gala.id));
  return { juniper, gala, brunch, late, october };
}
const newTask = (input: TaskInput) => admin.send<Task>("POST", "/api/tasks", input, 201);
const september = "/api/calendar?from=2026-09-01&to=2026-09-30";

describe("calendar (FLOW-63)", () => {
  it("shows an event made for 9/17 at 5–10 PM at those New York times (AC1)", async () => {
    const { gala, brunch, late } = await seed();
    const calendar = await admin.get<Calendar>(september);
    expect(calendar.events).toEqual([
      {
        id: gala.id,
        title: "Fall gala",
        status: "inquiry",
        start: "2026-09-17T17:00",
        end: "2026-09-17T22:00",
        clientName: "Juniper & Co.",
        venueName: null,
        guestCount: null,
        salespersonName: "Sam",
        staffCount: 0,
      },
      expect.objectContaining({ id: brunch.id, start: "2026-09-20T10:00", end: null }),
      // Past midnight: it ends on the next day.
      expect.objectContaining({ id: late.id, start: "2026-09-25T22:00", end: "2026-09-26T02:00" }),
    ]);
  });

  it("includes an event that started before the range and runs into it", async () => {
    const { late } = await seed();
    const day = await admin.get<Calendar>("/api/calendar?from=2026-09-26&to=2026-09-26");
    expect(day.events.map((event) => event.id)).toEqual([late.id]);
    const before = await admin.get<Calendar>("/api/calendar?from=2026-09-24&to=2026-09-24");
    expect(before.events).toEqual([]);
  });

  it("shows a salesperson only their own events (AC2)", async () => {
    const { gala, brunch, late } = await seed();
    expect((await sam.get<Calendar>(september)).events.map((e) => e.id)).toEqual([
      gala.id,
      late.id,
    ]);
    expect((await sue.get<Calendar>(september)).events.map((e) => e.id)).toEqual([brunch.id]);
  });

  it("shows staff the events they work and their own open tasks", async () => {
    const { gala } = await seed();
    const prep = await newTask({
      title: "Polish the chafing dishes",
      dueAt: "2026-09-16T14:00:00.000Z",
      assigneeIds: [people.helper],
      eventId: gala.id,
    });
    const other = await newTask({
      title: "Count linens",
      dueAt: "2026-09-16T15:00:00.000Z",
      assigneeIds: [people.casey],
    });
    const done = await newTask({
      title: "Book the truck",
      dueAt: "2026-09-15T15:00:00.000Z",
      assigneeIds: [people.helper],
    });
    await admin.send("PATCH", `/api/tasks/${done.id}`, { status: "done" });
    await newTask({ title: "No due time", assigneeIds: [people.helper] });
    await newTask({
      title: "Next month",
      dueAt: "2026-10-16T15:00:00.000Z",
      assigneeIds: [people.helper],
    });

    const mine = await helper.get<Calendar>(september);
    expect(mine.events.map((event) => event.id)).toEqual([gala.id]);
    expect(mine.tasks).toEqual([
      {
        id: prep.id,
        title: "Polish the chafing dishes",
        status: "todo",
        priority: "normal",
        // 14:00 UTC is 10 AM in New York in September.
        due: "2026-09-16T10:00",
        eventId: gala.id,
      },
    ]);
    // Full-time staff working no event see no events, and only their own tasks.
    const theirs = await casey.get<Calendar>(september);
    expect(theirs.events).toEqual([]);
    expect(theirs.tasks.map((task) => task.id)).toEqual([other.id]);
    // The creator's calendar shows the tasks they made.
    expect((await admin.get<Calendar>(september)).tasks.map((task) => task.id)).toEqual([
      prep.id,
      other.id,
    ]);
  });

  it("refuses a missing, reversed or too long range", async () => {
    for (const query of [
      "",
      "?from=2026-09-01",
      "?from=2026-09-30&to=2026-09-01",
      "?from=2026-09-01&to=2026-11-30",
      "?from=2026-02-30&to=2026-03-01",
    ]) {
      expect((await admin.call("GET", `/api/calendar${query}`)).status, query).toBe(400);
    }
    // Six weeks, as a month view asks for, is fine.
    expect((await admin.call("GET", "/api/calendar?from=2026-08-30&to=2026-10-10")).status).toBe(200);
  });
});

// Staffing (FLOW-140): a shift through the API, its slots stored directly (adding
// them through the API checks the position list, which isn't this file's subject).
const addShift = async (eventId: string, input: ShiftInput) => {
  const roster = await admin.send<EventRoster>(
    "POST",
    `/api/events/${eventId}/shifts`,
    input,
    201,
  );
  return roster.shifts.find(
    (shift) => shift.kind === input.kind && shift.date === input.date,
  )!.id;
};
const addSlots = (shiftId: string, assignees: (string | null)[], archived = false) =>
  db.insert(schema.eventStaffSlots).values(
    assignees.map((assigneeId, sortOrder) => ({
      shiftId,
      position: "Server",
      department: "service" as const,
      assigneeId,
      sortOrder,
      archivedAt: archived ? new Date() : null,
    })),
  );

describe("calendar overview mode (FLOW-64)", () => {
  it("gives every event its venue, guest count, salesperson and staff count (AC1)", async () => {
    const { gala, brunch } = await seed();
    await db
      .update(schema.events)
      .set({ guestCount: 120 })
      .where(eq(schema.events.id, gala.id));
    const setup = await addShift(gala.id, {
      kind: "setup",
      date: "2026-09-16",
      startTime: "14:00",
      endTime: "18:00",
    });
    const day = await addShift(gala.id, {
      kind: "event_day",
      date: "2026-09-17",
      startTime: "15:00",
      endTime: "23:00",
    });
    // The helper works both shifts but counts once; open and removed slots don't count.
    await addSlots(setup, [people.helper, people.casey, null]);
    await addSlots(day, [people.helper]);
    await addSlots(day, [people.sue], true);

    const events = (await admin.get<Calendar>(september)).events;
    expect(events.find((event) => event.id === gala.id)).toMatchObject({
      guestCount: 120,
      salespersonName: "Sam",
      staffCount: 2,
      venueName: null,
    });
    expect(events.find((event) => event.id === brunch.id)).toMatchObject({
      guestCount: null,
      salespersonName: "Sue",
      staffCount: 0,
    });
  });

  it("shows part-time staff the same overview, with no contact or pricing fields (AC1)", async () => {
    const { gala } = await seed();
    const mine = await helper.get<Calendar>(september);
    const theirs = (await admin.get<Calendar>(september)).events.find((e) => e.id === gala.id);
    expect(mine.events).toEqual([theirs]);
    expect(Object.keys(mine.events[0]).sort()).toEqual(
      [
        "clientName",
        "end",
        "guestCount",
        "id",
        "salespersonName",
        "staffCount",
        "start",
        "status",
        "title",
        "venueName",
      ].sort(),
    );
  });
});

describe("calendar layers (FLOW-67)", () => {
  const rental = async (name: string) => {
    const [item] = await db
      .insert(schema.inventoryItems)
      .values({ kind: "rental", name, unit: "each" })
      .returning();
    items.push(item.id);
    return item.id;
  };
  const hold = (
    eventId: string,
    itemId: string,
    window: [string, string],
    status: "tentative" | "confirmed" = "tentative",
    quantity = 10,
  ) =>
    db.insert(schema.reservations).values({
      eventId,
      itemId,
      quantity,
      status,
      windowStart: window[0],
      windowEnd: window[1],
    });

  it("lists open production tasks the viewer may see", async () => {
    const { gala } = await seed();
    const crudites = await newTask({
      title: "Prep crudités",
      type: "production",
      dueAt: "2026-09-17T13:00:00.000Z",
      assigneeIds: [people.casey],
      eventId: gala.id,
    });
    const mine = await newTask({
      title: "Fold napkins",
      type: "production",
      dueAt: "2026-09-16T13:00:00.000Z",
      assigneeIds: [people.helper],
    });
    await newTask({
      title: "Count linens",
      type: "general",
      dueAt: "2026-09-16T15:00:00.000Z",
      assigneeIds: [people.casey],
    });
    const done = await newTask({
      title: "Bake rolls",
      type: "production",
      dueAt: "2026-09-15T13:00:00.000Z",
      assigneeIds: [people.casey],
    });
    await admin.send("PATCH", `/api/tasks/${done.id}`, { status: "done" });

    const all = await admin.get<Calendar>(september);
    expect(all.layers.production).toEqual([
      expect.objectContaining({ id: mine.id, due: "2026-09-16T09:00" }),
      expect.objectContaining({ id: crudites.id, eventId: gala.id }),
    ]);
    // FT+ see every task; part-time staff only theirs.
    expect((await casey.get<Calendar>(september)).layers.production.map((t) => t.id)).toEqual([
      mine.id,
      crudites.id,
    ]);
    expect((await helper.get<Calendar>(september)).layers.production.map((t) => t.id)).toEqual([
      mine.id,
    ]);
  });

  it("lists tentative holds per event and window, on the events the viewer may open", async () => {
    const { gala, brunch } = await seed();
    const chairs = await rental("Chiavari chairs");
    const linens = await rental("Ivory linens");
    await hold(gala.id, chairs, ["2026-09-16", "2026-09-18"], "tentative", 120);
    await hold(gala.id, linens, ["2026-09-16", "2026-09-18"], "tentative", 12);
    await hold(brunch.id, chairs, ["2026-09-19", "2026-09-21"], "confirmed");
    // Outside the range.
    await hold(brunch.id, linens, ["2026-10-01", "2026-10-03"]);

    const expected = {
      eventId: gala.id,
      eventTitle: "Fall gala",
      start: "2026-09-16",
      end: "2026-09-18",
      items: 2,
      quantity: 132,
    };
    expect((await admin.get<Calendar>(september)).layers.holds).toEqual([expected]);
    expect((await sam.get<Calendar>(september)).layers.holds).toEqual([expected]);
    expect((await sue.get<Calendar>(september)).layers.holds).toEqual([]);
    // A window that starts before the range still shows.
    expect(
      (await admin.get<Calendar>("/api/calendar?from=2026-09-18&to=2026-09-18")).layers.holds,
    ).toEqual([expected]);
  });

  it("puts a day-before setup shift on its own date (AC2) for everyone who may open the event", async () => {
    const { gala } = await seed();
    const setup = await addShift(gala.id, {
      kind: "setup",
      date: "2026-09-16",
      startTime: "14:00",
      endTime: "18:00",
    });
    await addSlots(setup, [people.helper, null]);
    const shift = {
      id: setup,
      eventId: gala.id,
      eventTitle: "Fall gala",
      kind: "setup",
      start: "2026-09-16T14:00",
      end: "2026-09-16T18:00",
      slots: 2,
      staffed: 1,
    };
    expect((await admin.get<Calendar>(september)).layers.shifts).toEqual([shift]);
    expect((await helper.get<Calendar>(september)).layers.shifts).toEqual([shift]);
    expect((await sue.get<Calendar>(september)).layers.shifts).toEqual([]);
    // Only the day before is in this range: the shift, but not the event.
    const dayBefore = await admin.get<Calendar>("/api/calendar?from=2026-09-16&to=2026-09-16");
    expect(dayBefore.events).toEqual([]);
    expect(dayBefore.layers.shifts.map((s) => s.id)).toEqual([setup]);
  });
});

describe("event hub tasks and history (FLOW-166)", () => {
  it("lists the tasks and history sections for everyone who can open the event (AC1)", async () => {
    const { gala } = await seed();
    const hub = await admin.get<EventHub>(`/api/events/${gala.id}/hub`);
    expect(hub.sections).toEqual(
      expect.arrayContaining(["details", "tasks", "files", "history"]),
    );
    expect(hub.sections.indexOf("tasks")).toBeLessThan(hub.sections.indexOf("history"));
    expect((await helper.get<EventHub>(`/api/events/${gala.id}/hub`)).sections).toEqual([
      "details",
      "inventory",
      "tasks",
      "staff",
      "files",
      "history",
    ]);
  });

  it("shows part-time staff only their own tasks on the event (AC2)", async () => {
    const { gala } = await seed();
    const prep = await newTask({
      title: "Polish the chafing dishes",
      assigneeIds: [people.helper],
      eventId: gala.id,
    });
    const other = await newTask({
      title: "Plan the seating",
      assigneeIds: [people.casey],
      eventId: gala.id,
    });
    // As the hub's tasks section asks (FLOW-59): part-time users ask for their
    // own tasks; the team list is refused to them.
    const tasksOf = async (who: ReturnType<typeof signedInAs>, mine = false) =>
      (
        await who.get<TaskSummary[]>(
          `/api/tasks?eventId=${gala.id}&includeDone=true${mine ? "&mine=true" : ""}`,
        )
      ).map((task) => task.id);
    expect(await tasksOf(helper, true)).toEqual([prep.id]);
    expect(
      (await helper.call("GET", `/api/tasks?eventId=${gala.id}&includeDone=true`)).status,
    ).toBe(403);
    expect((await tasksOf(admin)).sort()).toEqual([prep.id, other.id].sort());
  });

  it("shows the event's history to people who can open it, and no one else (AC2)", async () => {
    const { gala, brunch } = await seed();
    await admin.send("PUT", `/api/events/${gala.id}`, {
      title: "Fall gala 2026",
      date: "2026-09-17",
      startTime: "17:00",
      endTime: "22:00",
      clientId: gala.client.id,
      assignedSalespersonId: people.sam,
      updatedAt: (await admin.get<FlowEvent>(`/api/events/${gala.id}`)).updatedAt,
    });
    const history = await helper.get<HistoryEntry[]>(`/api/events/${gala.id}/history`);
    expect(history.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(history[0].changes.title).toEqual({ before: "Fall gala", after: "Fall gala 2026" });
    expect((await helper.call("GET", `/api/events/${brunch.id}/history`)).status).toBe(404);
    expect((await sam.call("GET", `/api/events/${brunch.id}/history`)).status).toBe(404);
  });
});
