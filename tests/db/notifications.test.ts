import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Bindings } from "../../worker/bindings";
import type { EmploymentType, Role } from "../../shared/access";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { EventRoster } from "../../shared/event-staff";
import type {
  NotificationInbox,
  NotificationPreference,
} from "../../shared/notifications";
import type { Task } from "../../shared/tasks";
import { createJobRegistry } from "../../worker/jobs/cron";
import { emitDomainEvent, runDueJobs, type JobRegistry } from "../../worker/jobs/queue";
import { EMAIL_JOB } from "../../worker/notifications/fanout";
import type { EmailMessage, EmailProvider } from "../../worker/notifications/email";

// Notifications (FLOW-43) through the real jobs system and database: fan-out
// from domain events, one notification per recipient even when a job is
// retried (AC1), per-type email preferences (AC2), and email failures retried
// and logged by the jobs system (AC3).

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } } as Bindings;
const cronEnv = { ...env, APP_URL: "https://flowbase.example" } as Bindings;

const people = {
  admin: "c4300000-0000-4000-8000-000000000001",
  manager: "c4300000-0000-4000-8000-000000000002",
  sam: "c4300000-0000-4000-8000-000000000003",
  casey: "c4300000-0000-4000-8000-000000000004",
  drew: "c4300000-0000-4000-8000-000000000005",
  gone: "c4300000-0000-4000-8000-000000000006",
  sue: "c4300000-0000-4000-8000-000000000007",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["casey", "staff", "full_time"],
  ["drew", "staff", "part_time"],
  ["gone", "staff", "full_time"],
  ["sue", "salesperson", "full_time"],
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
    status = method === "POST" && !path.includes("/read") ? 201 : 200,
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
const casey = signedInAs("casey");
const drew = signedInAs("drew");

// A fake email provider: records what it was asked to send, or fails.
const sent: EmailMessage[] = [];
let failSends = false;
const provider: EmailProvider = {
  name: "fake",
  async send(message) {
    if (failSends) throw new Error("Email provider answered 503: try later");
    sent.push(message);
  },
};
let registry: JobRegistry;
// Runs every due job (several batches) at the given time.
const drain = async (now = () => new Date()) => {
  for (let i = 0; i < 20; i += 1)
    if (!(await runDueJobs(db, registry, { now, env: cronEnv })).claimed) return;
};
const notificationsOf = (who: keyof typeof people) =>
  db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, people[who]));
const emailJobs = () =>
  db.select().from(schema.jobs).where(eq(schema.jobs.type, EMAIL_JOB));

const tables = sql`truncate table notifications, notification_preferences, task_comments, task_checklist_items, task_assignees, tasks, settings, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@notify.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255592${i}`,
      status: name === "gone" ? ("deactivated" as const) : ("active" as const),
    })),
  );
  sent.length = 0;
  failSends = false;
  registry = createJobRegistry({ emailProvider: () => provider });
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const newTask = (body: Record<string, unknown>, as = manager) =>
  as.send<Task>("POST", "/api/tasks", body);

describe("fan-out", () => {
  it("notifies each newly assigned person once, not whoever assigned them, with a link to the task", async () => {
    const task = await newTask({
      title: "Prep crudités",
      dueAt: "2026-11-13T20:00:00.000Z",
      assigneeIds: [people.casey, people.drew, people.manager],
    });
    await drain();
    const [forCasey] = await notificationsOf("casey");
    expect(forCasey).toMatchObject({
      type: "task_assigned",
      title: "Task assigned: Prep crudités",
      body: "Due 2026-11-13 15:00",
      link: `/tasks/${task.id}`,
      readAt: null,
    });
    expect(await notificationsOf("drew")).toHaveLength(1);
    expect(await notificationsOf("manager")).toEqual([]);
    // Reassigning tells the person added and the person taken off (FLOW-60
    // AC3), and nobody who stayed.
    await manager.send<Task>("PATCH", `/api/tasks/${task.id}`, {
      assigneeIds: [people.casey, people.sam],
    });
    await drain();
    expect(await notificationsOf("casey")).toHaveLength(1);
    expect(await notificationsOf("sam")).toHaveLength(1);
    const forDrew = await notificationsOf("drew");
    expect(forDrew).toHaveLength(2);
    expect(forDrew.map((n) => n.title)).toContain("Task reassigned: Prep crudités");
  });

  it("emails each notification once through the provider, with a link into the app", async () => {
    const task = await newTask({ title: "Order ice", assigneeIds: [people.casey] });
    await drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "casey@notify.example",
      subject: "Task assigned: Order ice",
    });
    expect(sent[0].text).toContain(`https://flowbase.example/#/tasks/${task.id}`);
    const [row] = await notificationsOf("casey");
    expect(row.emailedAt).not.toBeNull();
    const [job] = await emailJobs();
    expect(job).toMatchObject({ status: "succeeded", idempotencyKey: `${EMAIL_JOB}:${row.id}` });
    expect(sent[0].idempotencyKey).toBe(job.idempotencyKey);
  });

  it("tells a task's assignees and overseer when it comes due", async () => {
    const task = await newTask({
      title: "Confirm rentals",
      dueAt: "2026-11-02T14:00:00.000Z",
      assigneeIds: [people.casey],
      overseerId: people.sam,
    });
    await drain();
    await db.insert(schema.jobs).values({
      type: "event:task.due",
      payload: { entityId: task.id },
      idempotencyKey: `event:task.due:${task.id}:1`,
      runAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await drain();
    const due = (await db.select().from(schema.notifications)).filter((n) => n.type === "task_due");
    expect(due.map((n) => n.userId).sort()).toEqual([people.casey, people.sam].sort());
    expect(due[0]).toMatchObject({ title: "Task overdue: Confirm rentals", link: `/tasks/${task.id}` });
  });

  it("tells a person they were put on an event's staff roster", async () => {
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
    const roster = await sam.send<EventRoster>("POST", `/api/events/${gala.id}/shifts`, {
      kind: "event_day",
      date: "2026-11-14",
      startTime: "16:00",
      endTime: "23:30",
    });
    const shiftId = roster.shifts[0].id;
    const withSlot = await sam.send<EventRoster>("POST", `/api/events/${gala.id}/slots`, {
      shiftId,
      position: "Server",
      department: "service",
    });
    const slotId = withSlot.shifts[0].slots[0].id;
    await sam.send<EventRoster>(
      "PATCH",
      `/api/events/${gala.id}/slots/${slotId}`,
      { assigneeId: people.casey },
    );
    await drain();
    expect(await notificationsOf("casey")).toMatchObject([
      {
        type: "staff_assigned",
        title: "You're on the staff roster: Autumn gala",
        body: "Server · Event day 2026-11-14 16:00–2026-11-14 23:30",
        link: `/events/${gala.id}`,
      },
    ]);
    expect((await casey.call("GET", `/api/events/${gala.id}/roster`)).status).toBe(200);
    await sam.send<EventRoster>("PATCH", `/api/events/${gala.id}/slots/${slotId}`, {
      assigneeId: people.casey,
    });
    await drain();
    expect(await notificationsOf("casey")).toHaveLength(1);
    await manager.send<EventRoster>("PATCH", `/api/events/${gala.id}/slots/${slotId}`, {
      assigneeId: people.drew,
      notifyRemovedStaff: true,
    });
    await drain();
    expect(await notificationsOf("drew")).toMatchObject([{ type: "staff_assigned" }]);
    expect(await notificationsOf("casey")).toHaveLength(2);
    expect((await notificationsOf("casey")).filter((row) => row.type === "staff_unassigned")).toHaveLength(1);
    await manager.send<EventRoster>("PATCH", `/api/events/${gala.id}/slots/${slotId}`, {
      assigneeId: people.casey,
    });
    await drain();
    expect(await notificationsOf("drew")).toHaveLength(1);
    // Retrying the assignment job cannot create another notification.
    const [assignment] = await db.select().from(schema.jobs)
      .where(eq(schema.jobs.type, "event:event.staff_assigned"));
    await registry.get(assignment.type)!(assignment, { db });
    expect(await notificationsOf("casey")).toHaveLength(3);
    await manager.send<EventRoster>("POST", `/api/events/${gala.id}/slots/${slotId}/archive`, {
      notifyRemovedStaff: false,
    }, 200);
    await drain();
    expect(await notificationsOf("casey")).toHaveLength(3);
    const next = await sam.send<EventRoster>("POST", `/api/events/${gala.id}/slots`, {
      shiftId, position: "Server", department: "service",
    });
    const nextSlotId = next.shifts[0].slots[0].id;
    await sam.send<EventRoster>("PATCH", `/api/events/${gala.id}/slots/${nextSlotId}`, {
      assigneeId: people.drew,
    });
    await drain();
    await manager.send<EventRoster>("POST", `/api/events/${gala.id}/slots/${nextSlotId}/archive`, {
      notifyRemovedStaff: true,
    }, 200);
    await drain();
    expect((await notificationsOf("drew")).filter((row) => row.type === "staff_unassigned")).toHaveLength(1);
    const denied = await sam.call("POST", `/api/events/${gala.id}/shifts/${shiftId}/archive`, {
      notifyRemovedStaff: true,
    });
    expect(denied.status).toBe(403);
    const forShift = await sam.send<EventRoster>("POST", `/api/events/${gala.id}/slots`, {
      shiftId, position: "Server", department: "service",
    });
    await sam.send<EventRoster>("PATCH", `/api/events/${gala.id}/slots/${forShift.shifts[0].slots[0].id}`, {
      assigneeId: people.drew,
    });
    await drain();
    await manager.send<EventRoster>("POST", `/api/events/${gala.id}/shifts/${shiftId}/archive`, {
      notifyRemovedStaff: true,
    }, 200);
    await drain();
    expect((await notificationsOf("drew")).filter((row) => row.type === "staff_unassigned")).toHaveLength(2);
  });

  it("notifies only the newly assigned salesperson about a lead", async () => {
    const [lead] = await db.insert(schema.leads).values({
      channel: "manual", source: "Manual", name: "Juniper inquiry",
      createdBy: people.admin, updatedBy: people.admin,
    }).returning();
    await admin.send("POST", `/api/leads/${lead.id}/assign`, {
      assignedSalespersonId: people.sam,
    }, 200);
    await drain();
    expect(await notificationsOf("sam")).toMatchObject([{
      type: "lead_assigned", title: "Lead assigned: Juniper inquiry",
      link: `/leads/${lead.id}`,
    }]);
    await admin.send("POST", `/api/leads/${lead.id}/assign`, {
      assignedSalespersonId: people.sam,
    }, 200);
    await drain();
    expect(await notificationsOf("sam")).toHaveLength(1);
    await admin.send("POST", `/api/leads/${lead.id}/assign`, {
      assignedSalespersonId: people.sue,
    }, 200);
    await drain();
    expect(await notificationsOf("sue")).toHaveLength(1);
    expect(await notificationsOf("sam")).toHaveLength(1);
  });

  it("delivers the generic types from the recipients and message their event names, and skips inactive staff", async () => {
    await db.transaction((tx) =>
      emitDomainEvent(tx, {
        name: "approval.requested",
        entityId: "a7000000-0000-4000-8000-000000000001",
        data: {
          recipientIds: [people.admin, people.manager, people.gone],
          title: "Rental change needs approval",
          body: "Chiavari chairs: 120 → 150",
          link: "/inventory",
        },
      }),
    );
    await drain();
    const rows = await db.select().from(schema.notifications);
    expect(rows.map((row) => row.userId).sort()).toEqual([people.admin, people.manager].sort());
    expect(rows[0]).toMatchObject({
      type: "approval_requested",
      title: "Rental change needs approval",
      link: "/inventory",
    });
  });

  it("fails an event whose payload names no recipients, so it shows up for an admin", async () => {
    await db.transaction((tx) =>
      emitDomainEvent(tx, { name: "payment.overdue", entityId: "p-1", data: { title: "Late" } }),
    );
    await runDueJobs(db, registry, { env: cronEnv });
    const [job] = await db.select().from(schema.jobs);
    expect(job).toMatchObject({ status: "pending", attempts: 1 });
    expect(job.lastError).toContain("no valid notification payload");
    expect(await db.select().from(schema.notifications)).toEqual([]);
  });
});

describe("AC1: exactly one notification per recipient", () => {
  it("creates nothing more when the event's job runs again", async () => {
    await newTask({ title: "Steam linens", assigneeIds: [people.casey, people.drew] });
    const [event] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "event:task.assigned"));
    const handler = registry.get(event.type)!;
    // A retry: the same job runs twice (e.g. the Worker died before marking it).
    await handler(event, { db, env: cronEnv });
    await handler(event, { db, env: cronEnv });
    expect(await notificationsOf("casey")).toHaveLength(1);
    expect(await notificationsOf("drew")).toHaveLength(1);
    expect(await emailJobs()).toHaveLength(2);
    // A crashed run left the job "running": it is reclaimed and still adds nothing.
    await db
      .update(schema.jobs)
      .set({ status: "running", lockedAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(schema.jobs.id, event.id));
    await drain();
    expect(await notificationsOf("casey")).toHaveLength(1);
    expect(sent.filter((message) => message.to === "casey@notify.example")).toHaveLength(1);
  });

  it("keeps notifications from two different events apart", async () => {
    const task = await newTask({ title: "Polish glasses", assigneeIds: [people.casey] });
    await manager.send<Task>("PATCH", `/api/tasks/${task.id}`, { assigneeIds: [] });
    await manager.send<Task>("PATCH", `/api/tasks/${task.id}`, { assigneeIds: [people.casey] });
    await drain();
    // Assigned, taken off (FLOW-60 AC3), assigned again.
    expect((await notificationsOf("casey")).map((n) => n.title).sort()).toEqual([
      "Task assigned: Polish glasses",
      "Task assigned: Polish glasses",
      "Task reassigned: Polish glasses",
    ]);
  });
});

describe("AC2: email preferences", () => {
  it("stops emails for a type turned off, while the in-app notification still appears", async () => {
    const off = await casey.send<NotificationPreference[]>("PUT", "/api/notifications/preferences", {
      email: { task_assigned: false },
    });
    expect(off.find((p) => p.type === "task_assigned")?.email).toBe(false);
    expect(off.find((p) => p.type === "task_due")?.email).toBe(true);
    await newTask({ title: "Fold napkins", assigneeIds: [people.casey, people.drew] });
    await drain();
    expect(await notificationsOf("casey")).toHaveLength(1);
    expect(await notificationsOf("drew")).toHaveLength(1);
    expect(sent.map((message) => message.to)).toEqual(["drew@notify.example"]);
    const inbox = await casey.send<NotificationInbox>("GET", "/api/notifications");
    expect(inbox.unreadCount).toBe(1);
  });

  it("skips an email queued before the person turned that type off", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await newTask({ title: "Count chairs", assigneeIds: [people.casey] });
      // Run the event only: the email job is queued but not sent yet.
      const [event] = await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.type, "event:task.assigned"));
      await registry.get(event.type)!(event, { db, env: cronEnv });
      expect(await emailJobs()).toHaveLength(1);
      await casey.send("PUT", "/api/notifications/preferences", { email: { task_assigned: false } });
      await drain();
      expect(sent).toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"reason":"turned_off"'));
    } finally {
      log.mockRestore();
    }
  });

  it("lists every type with email on by default and the urgent flag from business settings", async () => {
    await admin.send("PUT", "/api/settings/defaults", {
      urgentNotificationTypes: ["collector_failure", "staff_assigned"],
    });
    const preferences = await drew.send<NotificationPreference[]>(
      "GET",
      "/api/notifications/preferences",
    );
    expect(preferences).toHaveLength(16);
    expect(preferences.every((p) => p.email)).toBe(true);
    expect(preferences.filter((p) => p.urgent).map((p) => p.type)).toEqual([
      "staff_assigned",
      "collector_failure",
    ]);
    const invalid = await drew.call("PUT", "/api/notifications/preferences", {
      email: { not_a_type: false },
    });
    expect(invalid.status).toBe(400);
  });
});

describe("AC3: email failures", () => {
  it("retries a failed send through the jobs system, logs it, and sends once it works", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      failSends = true;
      await newTask({ title: "Book the truck", assigneeIds: [people.casey] });
      await drain();
      const [job] = await emailJobs();
      expect(job).toMatchObject({ status: "pending", attempts: 1 });
      expect(job.lastError).toContain("503");
      expect(job.runAt.getTime()).toBeGreaterThan(Date.now());
      const failure = error.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as Record<string, unknown>;
          } catch {
            return {};
          }
        })
        .find((entry) => entry.event === "notification_email_failed");
      expect(failure).toMatchObject({ jobId: job.id, attempt: 1, provider: "fake" });
      expect(JSON.stringify(failure)).not.toContain("casey@notify.example");
      // The in-app notification is there regardless.
      expect(await notificationsOf("casey")).toHaveLength(1);
      failSends = false;
      await drain(() => new Date(Date.now() + 60 * 60_000));
      const [retried] = await emailJobs();
      expect(retried).toMatchObject({ status: "succeeded", attempts: 2, lastError: null });
      expect(sent).toHaveLength(1);
      expect((await notificationsOf("casey"))[0].emailedAt).not.toBeNull();
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  it("leaves email out without failing the job when no provider is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      registry = createJobRegistry({ emailProvider: () => undefined });
      await newTask({ title: "Sweep the dock", assigneeIds: [people.casey] });
      await drain();
      expect((await emailJobs())[0].status).toBe("succeeded");
      expect((await notificationsOf("casey"))[0].emailedAt).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"reason":"not_configured"'));
    } finally {
      log.mockRestore();
    }
  });
});

describe("notification center", () => {
  it("shows a person only their own notifications, with an unread count, and marks them read", async () => {
    // Drain after each task: one batch claims jobs in no particular order, and
    // the inbox order below depends on which notification was created first.
    await newTask({ title: "First", assigneeIds: [people.casey] });
    await drain();
    await newTask({ title: "Second", assigneeIds: [people.casey] });
    await drain();
    await newTask({ title: "Drew's", assigneeIds: [people.drew] });
    await drain();
    const inbox = await casey.send<NotificationInbox>("GET", "/api/notifications");
    expect(inbox.unreadCount).toBe(2);
    expect(inbox.notifications.map((n) => n.title)).toEqual([
      "Task assigned: Second",
      "Task assigned: First",
    ]);
    const read = await casey.send<{ readAt: string | null }>(
      "POST",
      `/api/notifications/${inbox.notifications[0].id}/read`,
      {},
    );
    expect(read.readAt).not.toBeNull();
    expect((await casey.send<NotificationInbox>("GET", "/api/notifications")).unreadCount).toBe(1);
    // Someone else's notification answers 404.
    const [drews] = await notificationsOf("drew");
    expect((await casey.call("POST", `/api/notifications/${drews.id}/read`, {})).status).toBe(404);
    const all = await casey.send<NotificationInbox>("POST", "/api/notifications/read-all", {});
    expect(all.unreadCount).toBe(0);
    expect((await drew.send<NotificationInbox>("GET", "/api/notifications")).unreadCount).toBe(1);
  });
});
