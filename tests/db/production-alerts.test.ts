import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as s from "../../worker/db/schema";
import { scanProductionAlerts } from "../../worker/records/production-alerts";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import { businessTimeToUtc } from "../../shared/time";
import { getReadiness, respondToReadiness } from "../../worker/records/readiness";
import { getProductionList } from "../../worker/records/production";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema: s });
const lead = "c1530000-0000-4000-8000-000000000001";
const manager = "c1530000-0000-4000-8000-000000000002";
const eventId = "e1530000-0000-4000-8000-000000000001";
const taskId = "a1530000-0000-4000-8000-000000000001";
const now = new Date("2026-11-12T16:00:00.000Z");
const clear = sql`truncate table readiness_responses, sms_outbox, notifications, notification_preferences, task_assignees, tasks, event_staff_slots, event_shifts, truck_assignments, pull_list_lines, pull_lists, kitchen_menu_lines, kitchen_menus, reservation_conflicts, consumable_allocations, beos, payment_schedule_items, payments, events, clients, jobs, users cascade`;

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(clear);
  await db.insert(s.users).values([
    { id: lead, email: "lead@example.test", name: "Lead", role: "staff", employmentType: "full_time", status: "active", mobile: "2025550101", smsConsentAt: now },
    { id: manager, email: "manager@example.test", name: "Manager", role: "sales_manager", employmentType: "full_time", status: "active", mobile: "2025550102", smsConsentAt: now },
  ]);
  const clientId = "c1530000-0000-4000-8000-000000000003";
  await db.insert(s.clients).values({ id: clientId, name: "Sample client", kind: "organization" });
  await db.insert(s.events).values({ id: eventId, title: "Autumn event", clientId, productionLeadId: lead,
    startsAt: businessTimeToUtc("2026-11-14", "18:00"), guestCount: 120 });
  await db.insert(s.tasks).values({ id: taskId, eventId, type: "production", title: "Build arch",
    status: "todo", dueAt: businessTimeToUtc("2026-11-10", "09:00") });
  await db.insert(s.taskAssignees).values({ taskId, userId: lead });
});
afterAll(async () => { await db.execute(clear); await client.end(); });

it("alerts the lead, escalates after the delay, deduplicates, and records urgent SMS", async () => {
  expect(await scanProductionAlerts(db, now)).toBeGreaterThanOrEqual(1);
  expect(await scanProductionAlerts(db, now)).toBe(0);
  const registry = createJobRegistry({ emailProvider: () => undefined });
  for (let i = 0; i < 20; i++) {
    const result = await runDueJobs(db, registry, { now: () => new Date(Date.now() + 60_000) });
    if (!result.claimed) break;
  }
  expect((await db.select().from(s.notifications).where(eq(s.notifications.type, "production_urgent"))).map((row) => row.userId)).toEqual([lead]);
  const afterDelay = new Date(now.getTime() + 25 * 60 * 60_000);
  expect(await scanProductionAlerts(db, afterDelay)).toBeGreaterThan(0);
  for (let i = 0; i < 20; i++) {
    const result = await runDueJobs(db, registry, { now: () => new Date(Date.now() + 60_000) });
    if (!result.claimed) break;
  }
  const notifications = await db.select().from(s.notifications).where(eq(s.notifications.type, "production_urgent"));
  expect(notifications.map((row) => row.userId).sort()).toEqual([lead, manager].sort());
  const sms = await db.select().from(s.smsOutbox);
  expect(sms.map((row) => row.userId).sort()).toEqual([lead, manager].sort());
  await db.update(s.tasks).set({ status: "done" }).where(eq(s.tasks.id, taskId));
  expect(await scanProductionAlerts(db, afterDelay)).toBe(0);
});

it("reminds each assigned person to open the BEO offline once the day before", async () => {
  const dayBefore = new Date("2026-11-13T16:00:00.000Z");
  await scanProductionAlerts(db, dayBefore);
  await scanProductionAlerts(db, dayBefore);
  const jobs = await db.select().from(s.jobs).where(eq(s.jobs.type, "event:event.offline_reminder"));
  expect(jobs).toHaveLength(1);
  expect(jobs[0].idempotencyKey).toContain(`${eventId}:2026-11-14:${lead}`);
});

it("records a readiness answer and reopens it when the source changes", async () => {
  const actor = { userId: lead, role: "staff" as const, employmentType: "full_time" as const };
  const [pull] = await db.insert(s.pullLists).values({ eventId }).returning();
  const [check] = await getReadiness(db, actor, eventId, now);
  expect(check.question).toBe("What day and time are items being pulled from inventory?");
  const answered = await respondToReadiness(db, actor, eventId, check.key,
    { signature: check.signature, state: "answered", response: "Sam will pull at 9am." }, now);
  expect(answered[0]).toMatchObject({ state: "answered", response: "Sam will pull at 9am.", respondedBy: lead });
  await db.update(s.pullLists).set({ scheduledAt: businessTimeToUtc("2026-11-13", "09:00") }).where(eq(s.pullLists.id, pull.id));
  expect(await getReadiness(db, actor, eventId, now)).toEqual([]);
  await db.update(s.pullLists).set({ scheduledAt: null, updatedAt: new Date(now.getTime() + 3_600_000) }).where(eq(s.pullLists.id, pull.id));
  expect((await getReadiness(db, actor, eventId, now))[0].state).toBe("open");
});

it("lets a primary lead and Sales Manager see every event list while staff see assigned work only", async () => {
  const otherId = "e1530000-0000-4000-8000-000000000002";
  const clientId = "c1530000-0000-4000-8000-000000000003";
  await db.insert(s.events).values({ id: otherId, title: "Second event", clientId,
    startsAt: businessTimeToUtc("2026-11-15", "18:00") });
  const [assignedTask] = await db.insert(s.tasks).values({ eventId: otherId, type: "production", title: "Set tables",
    dueAt: businessTimeToUtc("2026-11-14", "10:00") }).returning();
  await db.insert(s.tasks).values({ eventId: otherId, type: "production", title: "Build dais",
    dueAt: businessTimeToUtc("2026-11-14", "11:00") });
  const leadActor = { userId: lead, role: "staff" as const, employmentType: "full_time" as const };
  const managerActor = { userId: manager, role: "sales_manager" as const, employmentType: "full_time" as const };
  expect((await getProductionList(db, leadActor, otherId, now)).items.some((item) => item.title === "Set tables")).toBe(true);
  expect((await getProductionList(db, managerActor, otherId, now)).items.some((item) => item.title === "Set tables")).toBe(true);
  const staffId = "c1530000-0000-4000-8000-000000000004";
  await db.insert(s.users).values({ id: staffId, email: "staff@example.test", name: "Staff", role: "staff",
    employmentType: "part_time", status: "active" });
  await expect(getProductionList(db, { userId: staffId, role: "staff", employmentType: "part_time" }, otherId, now)).rejects.toMatchObject({ status: 404 });
  const [shift] = await db.insert(s.eventShifts).values({ eventId: otherId, kind: "event_day",
    startsAt: businessTimeToUtc("2026-11-15", "12:00"), endsAt: businessTimeToUtc("2026-11-15", "22:00") }).returning();
  await db.insert(s.eventStaffSlots).values({ shiftId: shift.id, position: "Server", department: "service", assigneeId: staffId });
  await db.insert(s.taskAssignees).values({ taskId: assignedTask.id, userId: staffId });
  const staffList = await getProductionList(db, { userId: staffId, role: "staff", employmentType: "part_time" }, otherId, now);
  expect(staffList.items.some((item) => item.title === "Set tables")).toBe(true);
  expect(staffList.items.some((item) => item.title === "Build dais")).toBe(false);
});
