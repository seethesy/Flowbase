import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { HistoryEntry } from "../../shared/audit";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { Task, TaskInput, TaskSummary } from "../../shared/tasks";
import { completion } from "../../shared/tasks";
import { createTask, emitDueTaskEvents, updateTask } from "../../worker/records/tasks";

// Task engine (FLOW-58) through the real API and database: one task model for
// every module (AC1), the service API, status rules, and auditing with
// task.assigned on assignee changes (AC2).

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c5800000-0000-4000-8000-000000000001",
  lead: "c5800000-0000-4000-8000-000000000002",
  sam: "c5800000-0000-4000-8000-000000000003",
  pat: "c5800000-0000-4000-8000-000000000004",
  casey: "c5800000-0000-4000-8000-000000000005",
  gone: "c5800000-0000-4000-8000-000000000006",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["lead", "kitchen_lead", "full_time"],
  ["sam", "salesperson", "full_time"],
  // Part-time: sees only their own tasks and can't assign others.
  ["pat", "staff", "part_time"],
  ["casey", "staff", "full_time"],
  ["gone", "staff", "full_time"],
];
const actorOf = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  return { userId: people[who], role, employmentType };
};
const signedInAs = (who: keyof typeof people) => {
  const app = createApp({ withDb, resolveActor: async () => actorOf(who) });
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
const lead = signedInAs("lead");
const sam = signedInAs("sam");
const pat = signedInAs("pat");
const casey = signedInAs("casey");

const tables = sql`truncate table consumable_allocations, event_requirements, reservation_conflicts, reservations, task_comments, task_checklist_items, task_assignees, tasks, notifications, notification_preferences, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@tasks.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255591${i}`,
      status: name === "gone" ? ("deactivated" as const) : ("active" as const),
    })),
  );
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const newTask = (input: TaskInput, as = admin) =>
  as.send<Task>("POST", "/api/tasks", input);
const assignedEvents = () =>
  db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.type, "event:task.assigned"));

describe("service API", () => {
  it("creates a task with assignees, overseer, checklist and links, and audits it", async () => {
    const task = await newTask({
      title: "Polish the chafing dishes",
      description: "All twelve, before Friday.",
      type: "kitchen",
      priority: "high",
      dueAt: "2026-11-13T15:00:00.000Z",
      assigneeIds: [people.casey, people.pat],
      overseerId: people.lead,
      checklist: ["Soak", "Polish"],
    });
    expect(task).toMatchObject({
      title: "Polish the chafing dishes",
      type: "kitchen",
      status: "todo",
      priority: "high",
      dueAt: "2026-11-13T15:00:00.000Z",
      overseer: { id: people.lead, name: "Lead" },
      creator: { id: people.admin, name: "Admin" },
      checklistDone: 0,
      checklistTotal: 2,
      completedAt: null,
      canManage: true,
    });
    expect(task.assignees.map((a) => a.id).sort()).toEqual([people.casey, people.pat].sort());
    expect(task.checklist.map((item) => item.label)).toEqual(["Soak", "Polish"]);
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, task.id));
    expect(audit).toMatchObject({ entityType: "task", action: "create", createdBy: people.admin });
    expect(audit.changes.assigneeIds.after).toEqual([people.casey, people.pat].sort());
  });

  it("rejects assignees who aren't active staff", async () => {
    const response = await admin.call("POST", "/api/tasks", {
      title: "Load truck 2",
      assigneeIds: [people.gone],
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("active staff");
  });

  it("lets other modules create tasks in their own transaction; a rollback leaves no task", async () => {
    await expect(
      db.transaction(async (tx) => {
        await createTask(tx, null, {
          title: "Rolled back",
          description: "",
          type: "production",
          status: "todo",
          priority: "normal",
          dueAt: null,
          assigneeIds: [people.casey],
          overseerId: null,
          eventId: null,
          clientId: null,
          inventoryItemId: null,
          beoId: null,
          checklist: [],
        });
        throw new Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    expect(await db.select().from(schema.tasks)).toEqual([]);
    expect(await assignedEvents()).toEqual([]);
  });
});

describe("AC1: one task list for every module", () => {
  it("lists kitchen, production and truck-loading tasks created by modules with tasks created in the app", async () => {
    const base = {
      description: "",
      status: "todo" as const,
      priority: "normal" as const,
      dueAt: null,
      assigneeIds: [people.casey],
      overseerId: null,
      eventId: null,
      clientId: null,
      inventoryItemId: null,
      beoId: null,
      checklist: [],
    };
    await db.transaction(async (tx) => {
      await createTask(tx, null, { ...base, title: "Prep 40 crab cakes", type: "kitchen" });
      await createTask(tx, null, { ...base, title: "Build the bar", type: "production" });
      await createTask(tx, null, { ...base, title: "Load linens", type: "truck_load" });
    });
    await newTask({ title: "Call the florist", assigneeIds: [people.casey] });
    const all = await casey.send<TaskSummary[]>("GET", "/api/tasks");
    expect(all.map((task) => [task.title, task.type, task.creator])).toEqual(
      expect.arrayContaining([
        ["Prep 40 crab cakes", "kitchen", null],
        ["Build the bar", "production", null],
        ["Load linens", "truck_load", null],
        ["Call the florist", "general", { id: people.admin, name: "Admin" }],
      ]),
    );
    expect(all).toHaveLength(4);
    const kitchen = await casey.send<TaskSummary[]>("GET", "/api/tasks?type=kitchen");
    expect(kitchen.map((task) => task.title)).toEqual(["Prep 40 crab cakes"]);
    const mine = await casey.send<TaskSummary[]>(
      "GET",
      `/api/tasks?mine=true&assigneeId=${people.casey}`,
    );
    expect(mine).toHaveLength(4);
  });

  it("filters by event and leaves done tasks out unless asked", async () => {
    const juniper = await sam.send<Client>("POST", "/api/clients", {
      name: "Juniper & Co.",
      kind: "organization",
      contacts: [],
    });
    const gala = await sam.send<FlowEvent>("POST", "/api/events", {
      title: "Autumn gala",
      date: "2026-11-14",
      startTime: "18:00",
      endTime: "23:00",
      clientId: juniper.id,
    });
    const linked = await newTask({ title: "Gala floor plan", eventId: gala.id }, sam);
    expect(linked).toMatchObject({ eventId: gala.id, eventTitle: "Autumn gala" });
    await newTask({ title: "Unrelated" }, sam);
    const done = await newTask({ title: "Already done", eventId: gala.id, status: "done" }, sam);
    expect(
      (await sam.send<TaskSummary[]>("GET", `/api/tasks?eventId=${gala.id}`)).map((t) => t.title),
    ).toEqual(["Gala floor plan"]);
    expect(
      (await sam.send<TaskSummary[]>("GET", `/api/tasks?eventId=${gala.id}&includeDone=true`)).map(
        (t) => t.id,
      ),
    ).toEqual([done.id, linked.id]);
    // A kitchen lead can't open Sam's event, so can't link a task to it.
    const refused = await lead.call("POST", "/api/tasks", { title: "Peek", eventId: gala.id });
    expect(refused.status).toBe(404);
  });
});

describe("status rules", () => {
  it("records who completed a task and when, and forgets it when reopened", async () => {
    const task = await newTask({ title: "Count napkins", assigneeIds: [people.pat] });
    const started = await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "in_progress" });
    expect(started).toMatchObject({ status: "in_progress", completedAt: null, completedBy: null });
    const done = await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect(done.completedBy).toEqual({ id: people.pat, name: "Pat" });
    expect(Date.parse(done.completedAt!)).toBeGreaterThan(Date.now() - 60_000);
    // Saving done again keeps the original completion.
    const again = await admin.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    expect(again).toMatchObject({ completedAt: done.completedAt, completedBy: done.completedBy });
    const reopened = await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "blocked" });
    expect(reopened).toMatchObject({ status: "blocked", completedAt: null, completedBy: null });
  });

  it("applies the same rule as a pure function", () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    const open = { status: "todo" as const, completedAt: null, completedBy: null };
    expect(completion(open, "done", people.sam, now)).toEqual({
      completedAt: now,
      completedBy: people.sam,
    });
    const earlier = new Date("2026-10-26T12:00:00.000Z");
    const closed = { status: "done" as const, completedAt: earlier, completedBy: people.pat };
    expect(completion(closed, "done", people.sam, now)).toEqual({
      completedAt: earlier,
      completedBy: people.pat,
    });
    expect(completion(closed, "todo", people.sam, now)).toEqual({
      completedAt: null,
      completedBy: null,
    });
  });

  it("lets an assignee who can't manage the task change its status but not its details", async () => {
    const task = await newTask({ title: "Iron linens", assigneeIds: [people.pat] });
    expect((await pat.call("PATCH", `/api/tasks/${task.id}`, { title: "Skip it" })).status).toBe(403);
    expect((await pat.call("PATCH", `/api/tasks/${task.id}`, { status: "done" })).status).toBe(200);
    expect(
      (await pat.send<Task>("GET", `/api/tasks/${task.id}`)).canManage,
    ).toBe(false);
  });
});

describe("visibility and delegation", () => {
  it("shows part-time staff only the tasks they're on, and full-time staff every task", async () => {
    const theirs = await newTask({ title: "Pat's task", assigneeIds: [people.pat] });
    const other = await newTask({ title: "Casey's task", assigneeIds: [people.casey] });
    expect((await pat.send<TaskSummary[]>("GET", "/api/tasks")).map((t) => t.id)).toEqual([theirs.id]);
    expect((await pat.call("GET", `/api/tasks/${other.id}`)).status).toBe(404);
    expect((await casey.send<TaskSummary[]>("GET", "/api/tasks")).map((t) => t.id)).toEqual([
      other.id,
      theirs.id,
    ]);
  });

  it("lets only managers and full-time staff assign tasks to other people", async () => {
    const own = await newTask({ title: "Restock gloves", assigneeIds: [people.pat] }, pat);
    expect(own.creator).toEqual({ id: people.pat, name: "Pat" });
    const refused = await pat.call("POST", "/api/tasks", {
      title: "Casey, do this",
      assigneeIds: [people.casey],
    });
    expect(refused.status).toBe(403);
    expect(
      (await pat.call("PATCH", `/api/tasks/${own.id}`, { overseerId: people.casey })).status,
    ).toBe(403);
    // The creator manages their own task: details and self-assignment are fine.
    expect(
      (await pat.send<Task>("PATCH", `/api/tasks/${own.id}`, { title: "Restock nitrile gloves" })).title,
    ).toBe("Restock nitrile gloves");
    // A full-time staff member delegates.
    const delegated = await newTask(
      { title: "Pat, restock the bar", type: "delegated", assigneeIds: [people.pat], overseerId: people.casey },
      casey,
    );
    expect(delegated.overseer).toEqual({ id: people.casey, name: "Casey" });
  });
});

describe("AC2: audited changes and task.assigned", () => {
  it("emits task.assigned with the people added and removed, and nothing for other changes", async () => {
    const task = await newTask({ title: "Set tables", assigneeIds: [people.casey] }, lead);
    let emitted = await assignedEvents();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toEqual({
      entityId: task.id,
      addedUserIds: [people.casey],
      removedUserIds: [],
      actorId: people.lead,
    });
    await lead.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "in_progress", priority: "high" });
    expect(await assignedEvents()).toHaveLength(1);
    // Same people in another order: not a change.
    await lead.send<Task>("PATCH", `/api/tasks/${task.id}`, { assigneeIds: [people.casey] });
    expect(await assignedEvents()).toHaveLength(1);
    const moved = await lead.send<Task>("PATCH", `/api/tasks/${task.id}`, {
      assigneeIds: [people.pat, people.sam],
    });
    expect(moved.assignees.map((a) => a.id).sort()).toEqual([people.pat, people.sam].sort());
    emitted = await assignedEvents();
    expect(emitted).toHaveLength(2);
    expect(emitted.map((job) => job.payload)).toContainEqual({
      entityId: task.id,
      addedUserIds: [people.pat, people.sam],
      removedUserIds: [people.casey],
      actorId: people.lead,
    });
    // Casey no longer sees it as theirs; Pat (part-time) now does.
    expect((await pat.send<TaskSummary[]>("GET", "/api/tasks")).map((t) => t.id)).toEqual([task.id]);
  });

  it("records every change in the task's history, checklist and comments included", async () => {
    const task = await newTask({ title: "Fold napkins", assigneeIds: [people.casey], checklist: ["Swan fold"] });
    await casey.send<Task>("PATCH", `/api/tasks/${task.id}/checklist/${task.checklist[0].id}`, {
      done: true,
    });
    const withItem = await casey.send<Task>("POST", `/api/tasks/${task.id}/checklist`, {
      label: "Count 120",
    });
    expect(withItem.checklist).toMatchObject([
      { label: "Swan fold", done: true, doneBy: { id: people.casey, name: "Casey" } },
      { label: "Count 120", done: false, doneBy: null },
    ]);
    const commented = await casey.send<Task>("POST", `/api/tasks/${task.id}/comments`, {
      body: "Swans take longer than expected.",
    });
    expect(commented.comments).toMatchObject([
      { body: "Swans take longer than expected.", author: { id: people.casey, name: "Casey" } },
    ]);
    await admin.send<Task>("PATCH", `/api/tasks/${task.id}`, { dueAt: "2026-11-01T14:00:00.000Z" });
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, task.id))
      .orderBy(asc(schema.auditLog.createdAt));
    const changes = rows.map((row) => [row.action, Object.keys(row.changes).sort()]);
    expect(changes).toEqual([
      ["create", expect.arrayContaining(["title", "assigneeIds", "checklist"])],
      ["update", ["checklist"]],
      ["update", ["checklist"]],
      ["update", ["dueAt"]],
    ]);
    const [comment] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, "task_comment"));
    expect(comment).toMatchObject({ action: "create", createdBy: people.casey });
    const history = rows.map((row) => row.changes) as HistoryEntry["changes"][];
    expect(history[1].checklist).toEqual({
      before: [{ label: "Swan fold", done: false }],
      after: [{ label: "Swan fold", done: true }],
    });
  });

  it("lets the system update a task it doesn't own and audits it with no actor", async () => {
    const task = await newTask({ title: "Return rentals" });
    await db.transaction((tx) => updateTask(tx, null, task.id, { assigneeIds: [people.casey] }));
    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityId, task.id), eq(schema.auditLog.action, "update")));
    expect(row.createdBy).toBeNull();
    expect((await assignedEvents()).map((job) => job.payload)).toContainEqual({
      entityId: task.id,
      addedUserIds: [people.casey],
      removedUserIds: [],
      actorId: null,
    });
  });
});

describe("task.due", () => {
  it("emits one task.due per open task and due time, and repeats nothing on the next scan", async () => {
    const now = new Date("2026-11-02T15:00:00.000Z");
    const due = await newTask({ title: "Due now", dueAt: "2026-11-02T14:00:00.000Z" });
    await newTask({ title: "Later", dueAt: "2026-11-03T14:00:00.000Z" });
    await newTask({ title: "Done", status: "done", dueAt: "2026-11-02T10:00:00.000Z" });
    await newTask({ title: "Long overdue", dueAt: "2026-10-01T10:00:00.000Z" });
    expect(await emitDueTaskEvents(db, now)).toBe(1);
    expect(await emitDueTaskEvents(db, now)).toBe(0);
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(like(schema.jobs.idempotencyKey, "event:task.due:%"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "event:task.due",
      payload: { entityId: due.id },
      idempotencyKey: `event:task.due:${due.id}:${Date.parse("2026-11-02T14:00:00.000Z")}`,
    });
    // Moving the due time announces it again when the new time comes.
    await admin.send<Task>("PATCH", `/api/tasks/${due.id}`, { dueAt: "2026-11-02T16:00:00.000Z" });
    expect(await emitDueTaskEvents(db, now)).toBe(0);
    expect(await emitDueTaskEvents(db, new Date("2026-11-02T16:05:00.000Z"))).toBe(1);
  });
});
