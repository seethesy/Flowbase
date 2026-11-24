import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as s from "../../worker/db/schema";
import { scanProductionAlerts, SCAN_BATCH_SIZE } from "../../worker/records/production-alerts";
import { getProductionList, getProductionLists } from "../../worker/records/production";
import { enqueueJob } from "../../worker/jobs/queue";
import { productionScanJob, SCAN_BUCKET_MS } from "../../worker/jobs/production-scan";
import { businessTimeToUtc } from "../../shared/time";
import type { Actor } from "../../shared/access";

// FLOW-307: coalesced scan jobs and a scan with a fixed number of queries per batch.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const statements: string[] = [];
const client = postgres(url, { max: 1, debug: (_connection, query) => { statements.push(String(query)); } });
const db = drizzle(client, { schema: s });
const lead = "c3070000-0000-4000-8000-000000000001";
const manager = "c3070000-0000-4000-8000-000000000002";
const clientId = "c3070000-0000-4000-8000-000000000003";
const admin: Actor = { userId: lead, role: "admin" };
const now = new Date("2026-11-12T16:00:00.000Z");
const clear = sql`truncate table readiness_responses, sms_outbox, notifications, notification_preferences, task_assignees, tasks, event_staff_slots, event_shifts, truck_assignments, pull_list_lines, pull_lists, kitchen_menu_lines, kitchen_menus, reservation_conflicts, consumable_allocations, beos, payment_schedule_items, payments, vendor_orders, order_lists, events, clients, jobs, users cascade`;
const eventIdFor = (n: number) => `e3070000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const taskIdFor = (n: number) => `a3070000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Events from two to fourteen days after `now` (never tomorrow, so no offline
// reminders), each with one overdue production task for the lead and one
// unassigned one.
async function addEvents(from: number, to: number) {
  for (let n = from; n <= to; n++) {
    const day = String(14 + (n % 13)).padStart(2, "0");
    await db.insert(s.events).values({ id: eventIdFor(n), title: `Event ${n}`, clientId, productionLeadId: lead,
      startsAt: businessTimeToUtc(`2026-11-${day}`, "18:00"), guestCount: 50 + n });
    await db.insert(s.tasks).values([
      { id: taskIdFor(n * 2), eventId: eventIdFor(n), type: "production", title: `Build ${n}`,
        status: "todo", dueAt: businessTimeToUtc("2026-11-10", "09:00") },
      { id: taskIdFor(n * 2 + 1), eventId: eventIdFor(n), type: "production", title: `Load ${n}`,
        status: "todo", dueAt: businessTimeToUtc(`2026-11-${day}`, "09:00") },
    ]);
    await db.insert(s.taskAssignees).values({ taskId: taskIdFor(n * 2), userId: lead });
  }
}
const counted = async <T>(task: () => Promise<T>) => {
  statements.length = 0;
  const result = await task();
  return { result, queries: statements.length };
};

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(clear);
  await db.insert(s.users).values([
    { id: lead, email: "scan-lead@example.test", name: "Lead", role: "staff", status: "active", mobile: "2025550101" },
    { id: manager, email: "scan-manager@example.test", name: "Manager", role: "sales_manager", status: "active", mobile: "2025550102" },
  ]);
  await db.insert(s.clients).values({ id: clientId, name: "Sample client", kind: "organization" });
});
afterAll(async () => { await db.execute(clear); await client.end(); });

it("queues one production scan for ten edits to one event inside one tick (AC3)", async () => {
  await addEvents(1, 1);
  const bucketStart = Math.floor(now.getTime() / SCAN_BUCKET_MS) * SCAN_BUCKET_MS;
  for (let i = 0; i < 10; i++)
    await enqueueJob(db, productionScanJob(eventIdFor(1), new Date(bucketStart + i * 25_000)));
  let queued = await db.select().from(s.jobs).where(eq(s.jobs.type, "production.scan"));
  expect(queued).toHaveLength(1);
  // It waits for the next tick, so a late tick can't run it before the last edit.
  expect(queued[0].runAt.getTime()).toBe(bucketStart + SCAN_BUCKET_MS);
  expect(queued[0].payload).toEqual({ eventId: eventIdFor(1) });
  // An edit after the tick queues the next scan.
  await enqueueJob(db, productionScanJob(eventIdFor(1), new Date(bucketStart + SCAN_BUCKET_MS)));
  queued = await db.select().from(s.jobs).where(eq(s.jobs.type, "production.scan"));
  expect(queued).toHaveLength(2);
});

it("builds the same production lists in a batch as one event at a time", async () => {
  await addEvents(1, 4);
  const ids = [1, 2, 3, 4].map(eventIdFor);
  const batched = await getProductionLists(db, admin, ids, now);
  for (const id of ids) expect(batched.get(id)).toEqual(await getProductionList(db, admin, id, now));
  // Missing or archived events are left out of a batch.
  await db.update(s.events).set({ archivedAt: now }).where(eq(s.events.id, ids[0]));
  expect([...(await getProductionLists(db, admin, ids, now)).keys()].sort()).toEqual(ids.slice(1).sort());
});

it("scans with a fixed number of queries per batch (AC4)", async () => {
  await addEvents(1, 10);
  const first10 = await counted(() => scanProductionAlerts(db, now));
  expect(first10.result).toBeGreaterThan(0);
  const quiet10 = await counted(() => scanProductionAlerts(db, now));
  expect(quiet10.result).toBe(0);
  await addEvents(11, 20);
  await scanProductionAlerts(db, now);
  const quiet20 = await counted(() => scanProductionAlerts(db, now));
  expect(quiet20.result).toBe(0);
  // Twenty events fit one batch: the quiet scan costs the same as for ten.
  expect(20).toBeLessThanOrEqual(SCAN_BATCH_SIZE);
  expect(quiet20.queries).toBe(quiet10.queries);
  // Before FLOW-307 a quiet scan ran about ten queries per event, plus one
  // insert attempt per alert it had already raised.
  expect(quiet10.queries).toBeLessThan(10 * 10);
  console.log(JSON.stringify({ event: "scan_query_count", events: 10, first: first10.queries,
    quiet: quiet10.queries, quiet20: quiet20.queries }));
});

it("splits a larger window into batches with the same alerts", async () => {
  await addEvents(1, SCAN_BATCH_SIZE + 3);
  expect(await scanProductionAlerts(db, now)).toBeGreaterThan(0);
  const digests = await db.select().from(s.jobs).where(sql`${s.jobs.idempotencyKey} like 'production:list:%'`);
  // Every event is within two weeks, so each has its digest, whichever batch it was in.
  expect(digests).toHaveLength(SCAN_BATCH_SIZE + 3);
  expect(await scanProductionAlerts(db, now)).toBe(0);
});
