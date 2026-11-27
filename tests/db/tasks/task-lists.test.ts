import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Bindings } from "../../../worker/bindings";
import type { EmploymentType, Role } from "../../../shared/access";
import type { Client, FlowEvent } from "../../../shared/core-records";
import type {
  ApplyTemplateResult,
  Task,
  TaskDashboard,
  TaskSummary,
  TaskTemplate,
  TaskView,
} from "../../../shared/tasks";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { createJobRegistry } from "../../../worker/jobs/cron";
import { runDueJobs, type JobRegistry } from "../../../worker/jobs/queue";
import { emitDueSoonTaskEvents, emitDueTaskEvents } from "../../../worker/records/tasks/tasks";

// Task lists, delegation, the dashboard and templates (FLOW-59/60/61/62) through
// the real API, jobs system and database.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } } as Bindings;

const people = {
  admin: "c5900000-0000-4000-8000-000000000001",
  lead: "c5900000-0000-4000-8000-000000000002",
  manager: "c5900000-0000-4000-8000-000000000003",
  casey: "c5900000-0000-4000-8000-000000000004",
  pat: "c5900000-0000-4000-8000-000000000005",
  sam: "c5900000-0000-4000-8000-000000000006",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["lead", "admin", "full_time"],
  ["manager", "admin", "full_time"],
  ["casey", "staff", "full_time"],
  // Part-time: no communal list, own tasks only.
  ["pat", "staff", "part_time"],
  ["sam", "salesperson", "full_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const app = createApp({
    withDb,
    resolveActor: async () => ({ userId: people[who], role: employmentType === "part_time" ? "part_time_staff" : role, employmentType }),
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
    return (response.status === 204 ? null : await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs("admin");
const lead = signedInAs("lead");
const manager = signedInAs("manager");
const casey = signedInAs("casey");
const pat = signedInAs("pat");

let registry: JobRegistry;
const drain = async () => {
  for (let i = 0; i < 20; i += 1)
    if (!(await runDueJobs(db, registry, { env })).claimed) return;
};
const notificationsOf = (who: keyof typeof people) =>
  db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, people[who]));
const titlesOf = async (who: keyof typeof people) =>
  (await notificationsOf(who)).map((n) => n.title).sort();

const tables = sql`truncate table closeout_lines, event_closeouts, truck_assignments, event_planning_outputs, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, task_views, task_template_items, task_templates, task_comments, task_checklist_items, task_assignees, task_managers, tasks, sop_versions, sops, notifications, notification_preferences, settings, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@task-lists.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role: employmentType === "part_time" ? "part_time_staff" : role,
      mobile: `20255593${i}`,
      status: "active" as const,
    })),
  );
  registry = createJobRegistry({ emailProvider: () => undefined });
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const newTask = (body: Record<string, unknown>, as = admin) =>
  as.send<Task>("POST", "/api/tasks", "managerIds" in body || "overseerId" in body ? body : { ...body, managerIds: [] });
const list = (as: ReturnType<typeof signedInAs>, query = "") =>
  as.send<TaskSummary[]>("GET", `/api/tasks${query}`);
const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id).sort();

const today = () => utcToBusinessTime(new Date()).date;
// An instant `days` from today at a New York wall-clock time.
const at = (days: number, time = "12:00") =>
  businessTimeToUtc(addLocalDays(today(), days), time).toISOString();
let clientId = "";
const newEvent = async (title: string, date: string, startTime = "18:00") => {
  if (!clientId)
    clientId = (
      await admin.send<Client>("POST", "/api/clients", {
        name: "Juniper & Co.",
        kind: "organization",
        contacts: [],
      })
    ).id;
  return admin.send<FlowEvent>("POST", "/api/events", {
    title,
    date,
    startTime,
    endTime: "23:00",
    clientId,
  });
};
beforeEach(() => {
  clientId = "";
});

describe("FLOW-59 communal task list", () => {
  it("FLOW-344: active staff without accounts may be assigned but receive no notification", async () => {
    const id = "c5900000-0000-4000-8000-000000000099";
    await db.insert(schema.users).values({ id, name: "Offline staff", email: "", mobile: "", role: "part_time_staff", status: "active", hasAccount: false });
    const task = await newTask({ title: "Prepare chairs", assigneeIds: [id] });
    expect(task.assignees.map((person) => person.id)).toEqual([id]);
    await drain();
    expect((await db.select().from(schema.notifications)).filter((notice) => notice.userId === id)).toEqual([]);
  });
  it("FLOW-324: a manager filter finds a task with several managers", async () => {
    const task = await newTask({ title: "Check linens", managerIds: [people.manager, people.lead] });
    expect(ids(await list(manager, `?mine=true&overseerId=${people.manager}`))).toContain(task.id);
    expect(ids(await list(lead, `?mine=true&overseerId=${people.lead}`))).toContain(task.id);
    expect(ids(await list(pat, `?mine=true&overseerId=${people.pat}`))).not.toContain(task.id);
  });

  it("FLOW-324: completion tells every active manager except the completer", async () => {
    const task = await newTask({ title: "Polish glasses", assigneeIds: [people.pat], managerIds: [people.manager, people.lead] });
    await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    await drain();
    expect(await titlesOf("manager")).toContain("Task completed: Polish glasses");
    expect(await titlesOf("lead")).toContain("Task completed: Polish glasses");
    expect(await titlesOf("pat")).not.toContain("Task completed: Polish glasses");
  });

  it("FLOW-324: deactivated managers stay on the task but stop receiving notifications", async () => {
    const task = await newTask({ title: "Count linens", assigneeIds: [people.pat], managerIds: [people.lead, people.manager] });
    await db.update(schema.users).set({ status: "deactivated" }).where(eq(schema.users.id, people.lead));
    await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "done" });
    await drain();
    expect(await titlesOf("lead")).not.toContain("Task completed: Count linens");
    expect(await titlesOf("manager")).toContain("Task completed: Count linens");
    expect((await admin.send<Task>("GET", `/api/tasks/${task.id}`)).managers.map((person) => person.id)).toContain(people.lead);
  });

  it("AC1: part-time staff see their own tasks and the open unassigned ones, not others' (FLOW-272)", async () => {
    const theirs = await newTask({ title: "Restock gloves", assigneeIds: [people.pat] });
    await newTask({ title: "Polish trays", assigneeIds: [people.casey] });
    const open = await newTask({ title: "Sweep the dock" });
    const finished = await newTask({ title: "Mop", status: "done" });
    expect(ids(await list(pat, "?type=general"))).toEqual(ids([theirs, open]));
    expect(ids(await list(pat, "?type=general&includeDone=true"))).toEqual(ids([theirs, open]));
    expect(ids(await list(pat, "?mine=true"))).toEqual([theirs.id]);
    expect(ids(await list(pat, "?unassigned=true"))).toEqual([open.id]);
    expect((await pat.call("GET", `/api/tasks/${finished.id}`)).status).toBe(404);
    expect(await list(casey)).toHaveLength(3);
  });

  it("AC2: claiming makes the user an assignee and tells the overseer", async () => {
    const task = await newTask({ title: "Fold 200 napkins", overseerId: people.lead });
    await drain();
    const claimed = await casey.send<Task>("POST", `/api/tasks/${task.id}/claim`, {}, 200);
    expect(claimed.assignees).toEqual([{ id: people.casey, name: "Casey" }]);
    // Claiming again changes nothing and tells nobody again.
    await casey.send<Task>("POST", `/api/tasks/${task.id}/claim`, {}, 200);
    await drain();
    expect(await titlesOf("lead")).toEqual(["Task claimed: Fold 200 napkins"]);
    // Casey claimed it, so Casey isn't told it was assigned.
    expect(await notificationsOf("casey")).toEqual([]);
    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, people.lead));
    expect(row).toMatchObject({ type: "task_claimed", body: "Casey took this task." });
  });

  it("FLOW-344: a viewer joins an assigned task without displacing its assignee", async () => {
    const task = await newTask({ title: "Hold the door", assigneeIds: [people.casey] });
    await drain();
    // Part-time staff can't even see it, and can't take it by id.
    expect((await pat.call("POST", `/api/tasks/${task.id}/claim`, {})).status).toBe(404);
    const taken = await manager.send<Task>("POST", `/api/tasks/${task.id}/claim`, {}, 200);
    expect(taken.assignees.map((person) => person.id).sort()).toEqual([people.casey, people.manager].sort());
    await drain();
    expect(await titlesOf("casey")).toEqual(["Task assigned: Hold the door"]);
  });

  it("FLOW-272 AC1: part-time staff pick up an unassigned task and it joins their My tasks", async () => {
    const task = await newTask({ title: "Stack chairs", overseerId: people.lead });
    const picked = await pat.send<Task>(
      "POST",
      `/api/tasks/${task.id}/claim`,
      { unassignedOnly: true },
      200,
    );
    expect(picked.assignees).toEqual([{ id: people.pat, name: "Pat" }]);
    expect(ids(await list(pat, "?mine=true&assigneeId=" + people.pat))).toEqual([task.id]);
    await drain();
    expect(await titlesOf("lead")).toEqual(["Task claimed: Stack chairs"]);
  });

  it("FLOW-344: two people may pick up together, and Drop removes only the caller", async () => {
    const task = await newTask({ title: "Carry ice" });
    const results = await Promise.all([
      manager.call("POST", `/api/tasks/${task.id}/claim`, { unassignedOnly: true }),
      casey.call("POST", `/api/tasks/${task.id}/claim`, { unassignedOnly: true }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 200]);
    expect((await admin.send<Task>("GET", `/api/tasks/${task.id}`)).assignees.map((person) => person.id).sort()).toEqual([people.manager, people.casey].sort());
    await casey.send<Task>("POST", `/api/tasks/${task.id}/drop`, {}, 200);
    expect((await admin.send<Task>("GET", `/api/tasks/${task.id}`)).assignees.map((person) => person.id)).toEqual([people.manager]);
    const history = await admin.send<{ action: string; actor: { id: string } | null }[]>("GET", `/api/tasks/${task.id}/assignments`);
    expect(history.map((entry) => entry.action).sort()).toEqual(["added", "added", "removed"]);
    expect(history.at(-1)?.actor?.id).toBe(people.casey);
  });

  it("AC2: refuses claims on done tasks and tasks the user can't see; no overseer, nobody told", async () => {
    const done = await newTask({ title: "Done already", status: "done" });
    expect((await casey.call("POST", `/api/tasks/${done.id}/claim`, {})).status).toBe(409);
    const other = await newTask({ title: "Casey's", assigneeIds: [people.casey] });
    expect((await pat.call("POST", `/api/tasks/${other.id}/claim`, {})).status).toBe(404);
    const loose = await newTask({ title: "No overseer" });
    await casey.send<Task>("POST", `/api/tasks/${loose.id}/claim`, {}, 200);
    await drain();
    expect(
      (await db.select().from(schema.notifications)).filter((n) => n.type === "task_claimed"),
    ).toEqual([]);
  });

  it("AC1/AC2: completing a task works for the assignee and tells the overseer and creator", async () => {
    const task = await newTask(
      { title: "Wipe menus", assigneeIds: [people.pat], overseerId: people.lead },
      manager,
    );
    await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "done" }, 200);
    // Saving done again is not a second completion.
    await pat.send<Task>("PATCH", `/api/tasks/${task.id}`, { status: "done" }, 200);
    await drain();
    expect(await titlesOf("lead")).toEqual(["Task completed: Wipe menus"]);
    expect(await titlesOf("manager")).toEqual(["Task completed: Wipe menus"]);
    expect((await notificationsOf("lead"))[0].body).toBe("Marked done by Pat.");
  });

  it("AC3: combines filters", async () => {
    const gala = await newEvent("Autumn gala", addLocalDays(today(), 10));
    const match = await newTask({
      title: "Gala centerpieces",
      type: "production",
      eventId: gala.id,
      assigneeIds: [people.casey],
      dueAt: at(3),
    });
    await newTask({ title: "Wrong type", type: "kitchen", eventId: gala.id, assigneeIds: [people.casey], dueAt: at(3) });
    await newTask({ title: "Wrong person", type: "production", eventId: gala.id, assigneeIds: [people.pat], dueAt: at(3) });
    await newTask({ title: "No event", type: "production", assigneeIds: [people.casey], dueAt: at(3) });
    await newTask({ title: "Overdue", type: "production", eventId: gala.id, assigneeIds: [people.casey], dueAt: at(-1) });
    await newTask({ title: "Done", type: "production", eventId: gala.id, assigneeIds: [people.casey], dueAt: at(3), status: "done" });
    const query = `?type=production&assigneeId=${people.casey}&eventId=${gala.id}&due=upcoming`;
    expect(ids(await list(casey, query))).toEqual([match.id]);
    expect(await list(casey, `${query}&includeDone=true`)).toHaveLength(2);
    expect((await list(casey, `?eventId=${gala.id}&due=overdue`)).map((t) => t.title)).toEqual(["Overdue"]);
    expect((await list(casey, "?unassigned=true")).length).toBe(0);
    expect((await casey.call("GET", "/api/tasks?due=someday")).status).toBe(400);
  });

  it("AC3: saves views per user", async () => {
    const view = await casey.send<TaskView>("POST", "/api/tasks/views", {
      name: "My production",
      filter: { type: "production", mine: "true", due: "today" },
    });
    expect(view).toMatchObject({
      name: "My production",
      filter: { type: "production", mine: "true", due: "today" },
    });
    await casey.send<TaskView>("POST", "/api/tasks/views", { name: "Kitchen", filter: { type: "kitchen" } });
    expect((await casey.send<TaskView[]>("GET", "/api/tasks/views")).map((v) => v.name)).toEqual([
      "My production",
      "Kitchen",
    ]);
    // Nobody else sees or deletes them.
    expect(await pat.send<TaskView[]>("GET", "/api/tasks/views")).toEqual([]);
    expect((await pat.call("POST", `/api/tasks/views/${view.id}/archive`)).status).toBe(404);
    expect(
      (await casey.call("POST", "/api/tasks/views", { name: "Bad", filter: { colour: "red" } })).status,
    ).toBe(400);
    expect((await casey.call("POST", `/api/tasks/views/${view.id}/archive`)).status).toBe(204);
    expect((await casey.send<TaskView[]>("GET", "/api/tasks/views")).map((v) => v.name)).toEqual([
      "Kitchen",
    ]);
  });
});

describe("FLOW-60 task delegation", () => {
  it("AC1: a delegated task shows on the assignee's and the overseer's lists", async () => {
    const task = await newTask(
      {
        title: "Iron tablecloths",
        type: "delegated",
        assigneeIds: [people.pat, people.casey],
        overseerId: people.lead,
        dueAt: at(2),
      },
      lead,
    );
    for (const who of [pat, casey]) {
      const dashboard = await who.send<TaskDashboard>("GET", "/api/tasks/dashboard");
      expect(ids(dashboard.upcoming.tasks)).toEqual([task.id]);
    }
    const forLead = await lead.send<TaskDashboard>("GET", "/api/tasks/dashboard");
    expect(ids(forLead.overseeing.tasks)).toEqual([task.id]);
    expect(forLead.upcoming.count).toBe(0);
    expect(ids(await list(lead, `?mine=true&overseerId=${people.lead}`))).toEqual([task.id]);
    // Part-time staff can't delegate to others.
    expect(
      (await pat.call("POST", "/api/tasks", { title: "Casey, do this", assigneeIds: [people.casey] })).status,
    ).toBe(403);
  });

  it("AC2: an overdue task tells the assignee and the overseer once", async () => {
    await newTask(
      { title: "Return linens", assigneeIds: [people.pat], overseerId: people.lead, dueAt: at(-1) },
      lead,
    );
    await drain();
    expect(await emitDueTaskEvents(db)).toBe(1);
    await drain();
    expect(await emitDueTaskEvents(db)).toBe(0);
    await drain();
    const overdue = (await db.select().from(schema.notifications)).filter((n) => n.type === "task_due");
    expect(overdue.map((n) => n.userId).sort()).toEqual([people.lead, people.pat].sort());
    expect(overdue[0].title).toBe("Task overdue: Return linens");
  });

  it("tells assignees when a task is due within a day, once", async () => {
    const soon = await newTask(
      { title: "Confirm florist", assigneeIds: [people.casey], overseerId: people.lead, dueAt: at(0, "23:59") },
      lead,
    );
    await newTask({ title: "Next week", assigneeIds: [people.casey], dueAt: at(7) }, lead);
    await newTask({ title: "Nobody on it", dueAt: at(0, "23:59") }, lead);
    await drain();
    const emitted = await emitDueSoonTaskEvents(db);
    // 23:59 today may already have passed when the suite runs just before midnight.
    expect(emitted).toBe(Date.parse(soon.dueAt!) > Date.now() ? 1 : 0);
    expect(await emitDueSoonTaskEvents(db)).toBe(0);
    await drain();
    const dueSoon = (await db.select().from(schema.notifications)).filter((n) => n.type === "task_due_soon");
    expect(dueSoon.map((n) => n.userId)).toEqual(emitted ? [people.casey] : []);
  });

  it("AC3: reassigning tells both the old and the new assignees", async () => {
    const task = await newTask(
      { title: "Count chairs", assigneeIds: [people.pat], overseerId: people.lead },
      lead,
    );
    await drain();
    const moved = await lead.send<Task>("PATCH", `/api/tasks/${task.id}`, {
      assigneeIds: [people.casey],
    }, 200);
    expect(ids(moved.assignees)).toEqual([people.casey]);
    await drain();
    expect(await titlesOf("pat")).toEqual(["Task assigned: Count chairs", "Task reassigned: Count chairs"]);
    expect(await titlesOf("casey")).toEqual(["Task assigned: Count chairs"]);
    // Pat no longer sees it.
    expect((await pat.call("GET", `/api/tasks/${task.id}`)).status).toBe(404);
  });
});

describe("FLOW-61 task dashboard", () => {
  it("sorts my tasks into overdue, today and upcoming, and counts match the lists (AC2)", async () => {
    const overdue = await newTask({ title: "Late", assigneeIds: [people.casey], dueAt: at(-2) });
    const later = await newTask({ title: "Later", assigneeIds: [people.casey], dueAt: at(5) });
    const undated = await newTask({ title: "Someday", assigneeIds: [people.casey] });
    const done = await newTask({ title: "Done", assigneeIds: [people.casey], dueAt: at(-2), status: "done" });
    await newTask({ title: "Someone else's", assigneeIds: [people.pat], dueAt: at(-2) });
    const dashboard = await casey.send<TaskDashboard>("GET", "/api/tasks/dashboard");
    expect(ids(dashboard.overdue.tasks)).toEqual(expect.arrayContaining([overdue.id, done.id]));
    expect(ids(dashboard.mine.tasks)).toEqual(expect.arrayContaining([overdue.id, done.id, later.id, undated.id]));
    expect(dashboard.mine.tasks.every((task) => ["overdue", "today", "upcoming"].includes(task.dueBucket))).toBe(true);
    // Soonest due first; no due date last.
    expect(dashboard.upcoming.tasks.map((t) => t.id)).toEqual([later.id, undated.id]);
    expect(dashboard.needsDelegation).toBeNull();
    for (const due of ["overdue", "today", "upcoming"] as const) {
      const section = dashboard[due];
      const listed = await list(casey, `?mine=true&assigneeId=${people.casey}&due=${due}&includeDone=true`);
      expect(section.count, due).toBe(listed.length);
      expect(ids(section.tasks), due).toEqual(ids(listed));
    }
    const overseeing = await list(casey, `?mine=true&overseerId=${people.casey}`);
    expect(dashboard.overseeing.count).toBe(overseeing.length);
  });

  it("FLOW-344: keeps completed tasks for the configured dashboard window", async () => {
    const recent = await newTask({ title: "Recent", assigneeIds: [people.casey], status: "done" });
    const old = await newTask({ title: "Old", assigneeIds: [people.casey], status: "done" });
    await db.update(schema.tasks).set({ completedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(schema.tasks.id, old.id));
    await db.update(schema.tasks).set({ completedAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(schema.tasks.id, recent.id));
    const dashboard = await casey.send<TaskDashboard>("GET", "/api/tasks/dashboard");
    expect(ids(dashboard.mine.tasks)).toContain(recent.id);
    expect(ids(dashboard.mine.tasks)).not.toContain(old.id);
    expect(ids(dashboard.all.tasks)).toContain(recent.id);
    expect(ids(dashboard.all.tasks)).not.toContain(old.id);
  });

  it("AC1: lists unassigned tasks on events in the next 14 days under Needs delegation for managers", async () => {
    const soon = await newEvent("Harvest dinner", addLocalDays(today(), 5));
    const far = await newEvent("Winter ball", addLocalDays(today(), 20));
    const past = await newEvent("Last week's lunch", addLocalDays(today(), -7));
    const kitchen = await newTask({ title: "Prep 80 crab cakes", type: "kitchen", eventId: soon.id });
    const production = await newTask({ title: "Build the bar", type: "production", eventId: soon.id });
    const loose = await newTask({ title: "Order ice", dueAt: at(3) });
    await newTask({ title: "Assigned", eventId: soon.id, assigneeIds: [people.casey] });
    await newTask({ title: "Too far out", eventId: far.id });
    await newTask({ title: "Already happened", eventId: past.id });
    await newTask({ title: "Due next month", dueAt: at(30) });
    await newTask({ title: "Done", eventId: soon.id, status: "done" });
    for (const who of [admin, manager, lead]) {
      const dashboard = await who.send<TaskDashboard>("GET", "/api/tasks/dashboard");
      expect(ids(dashboard.needsDelegation!.tasks)).toEqual(
        [kitchen.id, production.id, loose.id].sort(),
      );
      expect(dashboard.needsDelegation!.count).toBe(3);
    }
    // Staff and salespeople don't get the section.
    expect((await casey.send<TaskDashboard>("GET", "/api/tasks/dashboard")).needsDelegation).toBeNull();
    // Quick-assign takes it off the list.
    await manager.send<Task>("PATCH", `/api/tasks/${kitchen.id}`, { assigneeIds: [people.casey] }, 200);
    const after = await manager.send<TaskDashboard>("GET", "/api/tasks/dashboard");
    expect(after.needsDelegation!.count).toBe(2);
    // The unassigned list holds at least what the section counts (AC2).
    const unassigned = await list(manager, "?unassigned=true");
    expect(ids(unassigned)).toEqual(expect.arrayContaining(ids(after.needsDelegation!.tasks)));
  });
});

const balloonArch = {
  name: "Balloon arch (Large)",
  sopUrl: "https://docs.example/sop/balloon-arch",
  items: [
    { title: "Order balloons", type: "production", offsetDays: -14, time: null, position: "Production Lead" },
    { title: "Inflate and build the frame", type: "production", offsetDays: -1, time: "16:00" },
    { title: "Install the arch", type: "production", offsetDays: 0, time: "10:00" },
  ],
};

describe("FLOW-62 task templates", () => {
  it("carries a library SOP into tasks created from a template (FLOW-139)", async () => {
    const sop = await manager.send<{ id: string }>("POST", "/api/sops", {
      title: "Load vehicles", category: "Production", content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const template = await manager.send<TaskTemplate>("POST", "/api/tasks/templates", {
      ...balloonArch, sopId: sop.id,
    });
    const wedding = await newEvent("Garden wedding", "2026-09-17", "18:00");
    const applied = await manager.send<ApplyTemplateResult>("POST",
      `/api/tasks/templates/${template.id}/apply`, { eventId: wedding.id }, 200);
    expect(applied.created).toHaveLength(3);
    expect(applied.created.every((task) => task.sopId === sop.id)).toBe(true);
    const task = await manager.send<Task>("GET", `/api/tasks/${applied.created[0].id}`);
    expect(task.sopId).toBe(sop.id);
  });
  it("lets managers keep templates and everyone read them", async () => {
    expect((await casey.call("POST", "/api/tasks/templates", balloonArch)).status).toBe(403);
    const template = await manager.send<TaskTemplate>("POST", "/api/tasks/templates", balloonArch);
    expect(template.items.map((item) => [item.title, item.offsetDays, item.time, item.position])).toEqual([
      ["Order balloons", -14, null, "Production Lead"],
      ["Inflate and build the frame", -1, "16:00", null],
      ["Install the arch", 0, "10:00", null],
    ]);
    expect((await casey.send<TaskTemplate[]>("GET", "/api/tasks/templates")).map((t) => t.name)).toEqual([
      "Balloon arch (Large)",
    ]);
    expect((await lead.call("POST", "/api/tasks/templates", balloonArch)).status).toBe(409);
    expect(
      (await lead.call("POST", "/api/tasks/templates", { ...balloonArch, name: "Bad", sopUrl: "javascript:alert(1)" })).status,
    ).toBe(400);
    expect(
      (await lead.call("POST", "/api/tasks/templates", { ...balloonArch, name: "Bad", items: [{ title: "x", offsetDays: 0, time: "25:00" }] })).status,
    ).toBe(400);
    const [audit] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, template.id));
    expect(audit).toMatchObject({ entityType: "task_template", action: "create" });
  });

  it("AC1: applying Balloon arch (Large) to an event on 9/17 creates tasks with the right due dates", async () => {
    const template = await manager.send<TaskTemplate>("POST", "/api/tasks/templates", balloonArch);
    const wedding = await newEvent("Garden wedding", "2026-09-17", "18:00");
    const result = await manager.send<ApplyTemplateResult>(
      "POST",
      `/api/tasks/templates/${template.id}/apply`,
      { eventId: wedding.id },
      200,
    );
    expect(result.skipped).toBe(0);
    expect(
      result.created.map((task) => [task.title, task.dueAt, task.eventId, task.position, task.assignees]),
    ).toEqual([
      // T-14 days at the event's start time (EDT, UTC-4).
      ["Order balloons", "2026-09-03T22:00:00.000Z", wedding.id, "Production Lead", []],
      // The day before at 4:00 PM.
      ["Inflate and build the frame", "2026-09-16T20:00:00.000Z", wedding.id, null, []],
      ["Install the arch", "2026-09-17T14:00:00.000Z", wedding.id, null, []],
    ]);
    const task = await manager.send<Task>("GET", `/api/tasks/${result.created[0].id}`);
    expect(task).toMatchObject({ type: "production", description: `SOP: ${balloonArch.sopUrl}` });
  });

  it("AC2: re-applying adds nothing that exists, even archived, and only what's new", async () => {
    const template = await manager.send<TaskTemplate>("POST", "/api/tasks/templates", balloonArch);
    const wedding = await newEvent("Garden wedding", "2026-09-17");
    const apply = () =>
      manager.send<ApplyTemplateResult>("POST", `/api/tasks/templates/${template.id}/apply`, { eventId: wedding.id }, 200);
    const first = await apply();
    expect(first.created).toHaveLength(3);
    const again = await apply();
    expect(again).toEqual({ created: [], skipped: 3 });
    // Someone removed a task they didn't need: it doesn't come back.
    await manager.call("POST", `/api/tasks/${first.created[2].id}/archive`);
    expect((await apply()).created).toEqual([]);
    // A task added to the template is the only one created.
    await manager.send<TaskTemplate>(
      "PUT",
      `/api/tasks/templates/${template.id}`,
      {
        ...balloonArch,
        items: [
          ...template.items,
          { title: "Pack the pump", type: "truck_load", offsetDays: -1, time: "08:00" },
        ],
      },
      200,
    );
    const added = await apply();
    expect(added.created.map((task) => task.title)).toEqual(["Pack the pump"]);
    expect(added.skipped).toBe(3);
    const onEvent = await db.select().from(schema.tasks).where(eq(schema.tasks.eventId, wedding.id));
    expect(onEvent).toHaveLength(4);
    // Another event gets its own set.
    const brunch = await newEvent("Sunday brunch", "2026-09-20", "10:00");
    const other = await manager.send<ApplyTemplateResult>(
      "POST",
      `/api/tasks/templates/${template.id}/apply`,
      { eventId: brunch.id },
      200,
    );
    expect(other.created).toHaveLength(4);
  });

  it("keeps applying to people who delegate and can open the event", async () => {
    const template = await manager.send<TaskTemplate>("POST", "/api/tasks/templates", balloonArch);
    const wedding = await newEvent("Garden wedding", "2026-09-17");
    expect(
      (await pat.call("POST", `/api/tasks/templates/${template.id}/apply`, { eventId: wedding.id })).status,
    ).toBe(403);
    // A full-time staff member delegates but isn't on this event's roster.
    expect(
      (await casey.call("POST", `/api/tasks/templates/${template.id}/apply`, { eventId: wedding.id })).status,
    ).toBe(404);
    await manager.send(
      "POST",
      `/api/tasks/templates/${template.id}/archive`,
      undefined,
      204,
    );
    expect(
      (await manager.call("POST", `/api/tasks/templates/${template.id}/apply`, { eventId: wedding.id })).status,
    ).toBe(404);
  });
});
