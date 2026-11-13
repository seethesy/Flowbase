import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { Communication } from "../../shared/communications";
import type { Task } from "../../shared/tasks";
import { salesDataSchema } from "../../shared/sales";
import { createLead } from "../../worker/records/leads";

// Client communication log (FLOW-120) through the real API and database.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1200000-0000-4000-8000-000000000001",
  sam: "c1200000-0000-4000-8000-000000000002",
  sue: "c1200000-0000-4000-8000-000000000003",
  kitchen: "c1200000-0000-4000-8000-000000000004",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["sue", "salesperson", "full_time"],
  ["kitchen", "kitchen_staff", "full_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const actor = { userId: people[who], role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
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
  return {
    call,
    get: async <T>(path: string) => {
      const response = await call("GET", path);
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as T;
    },
    log: async (body: unknown, status = 201) => {
      const response = await call("POST", "/api/communications", body);
      expect(response.status, await response.clone().text()).toBe(status);
      return (await response.json()) as Communication;
    },
  };
};
const admin = signedInAs("admin");
const sam = signedInAs("sam");
const sue = signedInAs("sue");
const kitchen = signedInAs("kitchen");

const tables = sql`truncate table communications, closeout_lines, event_closeouts, day_of_updates, day_of_checkpoints, day_of_staff_states, truck_assignments, event_planning_outputs, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, task_comments, task_checklist_items, task_assignees, tasks, notifications, notification_preferences, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
const clientId = "c1200000-0000-4000-8000-0000000000c1";
const eventId = "c1200000-0000-4000-8000-0000000000e1";

const newLead = async (owner: string | undefined, name = "Maya Ortiz") =>
  (
    await createLead(
      db,
      { channel: "manual", source: "Phone", name, phone: "(202) 555-0142" },
      { assignedSalespersonId: owner },
    )
  ).id;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@communications.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255512${i}`,
      status: "active" as const,
    })),
  );
  await db.insert(schema.clients).values({
    id: clientId,
    name: "Aster Events",
    kind: "organization",
    assignedSalespersonId: people.sam,
  });
  await db.insert(schema.events).values({
    id: eventId,
    title: "Aster Gala",
    clientId,
    startsAt: new Date("2027-03-06T23:00:00Z"),
    assignedSalespersonId: people.sam,
  });
});
afterAll(async () => {
  await client.end();
});

describe("follow-up tasks (AC1)", () => {
  it("creates a task due on the follow-up date for the lead's salesperson", async () => {
    const leadId = await newLead(people.sam);
    const entry = await admin.log({
      leadId,
      kind: "call",
      summary: "Wants a tasting before booking.",
      followUpDate: "2026-11-20",
    });
    expect(entry).toMatchObject({
      leadId,
      kind: "call",
      loggedByName: "Admin",
      followUpDate: "2026-11-20",
      followUpOpen: true,
    });
    const task = await admin.get<Task>(`/api/tasks/${entry.followUpTaskId}`);
    expect(task).toMatchObject({
      title: "Follow up: Maya Ortiz",
      description: "Wants a tasting before booking.",
      // 5 pm New York on Friday 20 November (EST).
      dueAt: "2026-11-20T22:00:00.000Z",
      status: "todo",
    });
    expect(task.assignees.map((person) => person.id)).toEqual([people.sam]);
  });

  it("assigns the follow-up to the person logging it when nobody owns the lead", async () => {
    const leadId = await newLead(undefined);
    const entry = await admin.log({
      leadId,
      kind: "email",
      summary: "Sent the menu.",
      followUpDate: "2026-11-20",
    });
    const task = await admin.get<Task>(`/api/tasks/${entry.followUpTaskId}`);
    expect(task.assignees.map((person) => person.id)).toEqual([people.admin]);
  });

  it("links a client or event follow-up task to that record", async () => {
    const onClient = await sam.log({
      clientId,
      kind: "meeting",
      summary: "Walked the venue.",
      followUpDate: "2026-12-01",
    });
    const clientTask = await sam.get<Task>(`/api/tasks/${onClient.followUpTaskId}`);
    expect(clientTask).toMatchObject({ clientId, eventId: null });
    const onEvent = await sam.log({
      eventId,
      kind: "text",
      summary: "Confirmed headcount.",
      followUpDate: "2026-12-02",
    });
    const eventTask = await sam.get<Task>(`/api/tasks/${onEvent.followUpTaskId}`);
    expect(eventTask).toMatchObject({ eventId, clientId });
  });

  it("creates no task without a follow-up date", async () => {
    const entry = await sam.log({ clientId, kind: "note", summary: "Prefers email." });
    expect(entry).toMatchObject({ followUpTaskId: null, followUpDate: null, followUpOpen: false });
    expect(await db.select().from(schema.tasks)).toHaveLength(0);
  });

  it("keeps no entry when the follow-up task cannot be created", async () => {
    const leadId = await newLead(people.sam);
    await admin.log({ leadId, kind: "call", summary: "x", followUpDate: "2026-02-31" }, 400);
    expect(await db.select().from(schema.communications)).toHaveLength(0);
    expect(await db.select().from(schema.tasks)).toHaveLength(0);
  });
});

describe("the log (AC2)", () => {
  it("lists entries newest first with who logged them", async () => {
    const leadId = await newLead(people.sam);
    await admin.log({ leadId, kind: "call", summary: "First", occurredAt: "2026-11-01T15:00:00.000Z" });
    await sam.log({ leadId, kind: "email", summary: "Third", occurredAt: "2026-11-03T15:00:00.000Z" });
    await admin.log({ leadId, kind: "text", summary: "Second", occurredAt: "2026-11-02T15:00:00.000Z" });
    const entries = await sam.get<Communication[]>(`/api/communications?leadId=${leadId}`);
    expect(entries.map((entry) => entry.summary)).toEqual(["Third", "Second", "First"]);
    expect(entries.map((entry) => entry.loggedByName)).toEqual(["Sam", "Admin", "Admin"]);
  });

  it("keeps each record's log apart", async () => {
    const leadId = await newLead(people.sam);
    await sam.log({ leadId, kind: "note", summary: "On the lead" });
    await sam.log({ clientId, kind: "note", summary: "On the client" });
    await sam.log({ eventId, kind: "note", summary: "On the event" });
    for (const [key, id, summary] of [
      ["leadId", leadId, "On the lead"],
      ["clientId", clientId, "On the client"],
      ["eventId", eventId, "On the event"],
    ]) {
      const entries = await sam.get<Communication[]>(`/api/communications?${key}=${id}`);
      expect(entries.map((entry) => entry.summary)).toEqual([summary]);
    }
  });

  it("shows a follow-up as done once its task is completed", async () => {
    const leadId = await newLead(people.sam);
    const entry = await sam.log({ leadId, kind: "call", summary: "Call back", followUpDate: "2026-11-20" });
    await db
      .update(schema.tasks)
      .set({ status: "done" })
      .where(eq(schema.tasks.id, entry.followUpTaskId!));
    const [listed] = await sam.get<Communication[]>(`/api/communications?leadId=${leadId}`);
    expect(listed.followUpOpen).toBe(false);
  });
});

describe("access and validation", () => {
  it("answers 404 for records the user cannot open and 403 for roles that do not sell", async () => {
    const leadId = await newLead(people.sue);
    expect((await sam.call("GET", `/api/communications?leadId=${leadId}`)).status).toBe(404);
    await sam.log({ leadId, kind: "note", summary: "Not mine" }, 404);
    expect((await sue.call("GET", `/api/communications?leadId=${leadId}`)).status).toBe(200);
    expect((await kitchen.call("GET", `/api/communications?clientId=${clientId}`)).status).toBe(403);
    await kitchen.log({ clientId, kind: "note", summary: "No access" }, 403);
    expect(await db.select().from(schema.communications)).toHaveLength(0);
  });

  it("needs exactly one record and a summary", async () => {
    const leadId = await newLead(people.sam);
    await admin.log({ kind: "call", summary: "No record" }, 400);
    await admin.log({ leadId, clientId, kind: "call", summary: "Two records" }, 400);
    await admin.log({ leadId, kind: "call", summary: "  " }, 400);
    await admin.log({ leadId, kind: "fax", summary: "Bad kind" }, 400);
    expect((await admin.call("GET", "/api/communications")).status).toBe(400);
    expect(await db.select().from(schema.communications)).toHaveLength(0);
  });
});

describe("sales tracker feed", () => {
  it("shows the latest activity and the next open follow-up", async () => {
    const leadId = await newLead(people.sam);
    const rowFor = async () =>
      salesDataSchema
        .parse(await sam.get("/api/sales"))
        .rows.find((row) => row.id === leadId)!;
    expect((await rowFor()).nextFollowUp).toBeNull();
    const later = await sam.log({
      leadId,
      kind: "call",
      summary: "Later follow-up",
      occurredAt: "2027-01-10T15:00:00.000Z",
      followUpDate: "2027-02-10",
    });
    const sooner = await sam.log({
      leadId,
      kind: "email",
      summary: "Sooner follow-up",
      occurredAt: "2027-01-05T15:00:00.000Z",
      followUpDate: "2027-01-20",
    });
    const row = await rowFor();
    expect(row.lastActivity).toBe("2027-01-10T15:00:00.000Z");
    expect(row.nextFollowUp).toBe("2027-01-20T22:00:00.000Z");
    await db
      .update(schema.tasks)
      .set({ status: "done" })
      .where(eq(schema.tasks.id, sooner.followUpTaskId!));
    expect((await rowFor()).nextFollowUp).toBe("2027-02-10T22:00:00.000Z");
    await db
      .update(schema.tasks)
      .set({ archivedAt: new Date() })
      .where(eq(schema.tasks.id, later.followUpTaskId!));
    expect((await rowFor()).nextFollowUp).toBeNull();
  });

  it("feeds client and event rows too", async () => {
    await sam.log({
      clientId,
      kind: "meeting",
      summary: "Lunch",
      occurredAt: "2027-01-11T15:00:00.000Z",
      followUpDate: "2027-01-25",
    });
    await sam.log({
      eventId,
      kind: "call",
      summary: "Timeline",
      occurredAt: "2027-01-12T15:00:00.000Z",
    });
    const rows = salesDataSchema.parse(await sam.get("/api/sales")).rows;
    const clientRow = rows.find((row) => row.kind === "client" && row.id === clientId)!;
    const eventRow = rows.find((row) => row.kind === "event" && row.id === eventId)!;
    expect(clientRow).toMatchObject({
      lastActivity: "2027-01-11T15:00:00.000Z",
      nextFollowUp: "2027-01-25T22:00:00.000Z",
    });
    expect(eventRow).toMatchObject({
      lastActivity: "2027-01-12T15:00:00.000Z",
      nextFollowUp: null,
    });
  });
});
