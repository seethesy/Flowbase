import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { ingestReceipts, jobs } from "../../worker/db/schema";
import {
  JobRegistry,
  completeUnsubscribedEvents,
  runDueJobs,
  type JobHandler,
} from "../../worker/jobs/queue";
import {
  clearProcessedReceiptBodies,
  cleanupJobs,
  pruneSucceededJobs,
} from "../../worker/jobs/cleanup";
import {
  registerIngestProcessing,
  storeReceipt,
  type IngestProcessor,
} from "../../worker/ingest/receipts";

// Domain events nobody subscribes to, and retention for jobs and ingest bodies
// (FLOW-184).
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table ingest_receipts, jobs`);
});
afterAll(async () => {
  await client.end();
});

const NOW = new Date("2026-11-08T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000);
const clock = { now: () => NOW };

const addJob = async (
  key: string,
  values: Partial<typeof jobs.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(jobs)
    .values({
      type: "event:noop.happened",
      payload: {},
      idempotencyKey: key,
      runAt: daysAgo(1),
      ...values,
    })
    .returning();
  return row;
};

it("processes the ingest job even with 300 due events nobody subscribes to", async () => {
  await db.insert(jobs).values(
    Array.from({ length: 300 }, (_, index) => ({
      type: "event:inventory.counted",
      payload: { entityId: String(index) },
      idempotencyKey: `event:inventory.counted:${index}`,
      runAt: daysAgo(1),
    })),
  );
  const processor = vi.fn<IngestProcessor>(async () => {});
  const registry = registerIngestProcessing(
    new JobRegistry(),
    new Map([["leads", processor]]),
  );
  await storeReceipt(db, { source: "leads", sourceRecordId: "bark-1", body: "{}" });
  // The receipt's job is newer than every event, so it would wait 30 batches.
  await db.update(jobs).set({ runAt: NOW }).where(eq(jobs.type, "ingest.process"));

  const summary = await runDueJobs(db, registry, clock);

  expect(summary).toMatchObject({ skipped: 300, claimed: 1, succeeded: 1 });
  expect(processor).toHaveBeenCalledTimes(1);
  const events = await db
    .select()
    .from(jobs)
    .where(eq(jobs.type, "event:inventory.counted"));
  expect(events).toHaveLength(300);
  expect(events.every((job) => job.status === "succeeded" && job.completedAt)).toBe(true);
});

it("still runs events that have a subscriber, and leaves future and non-event jobs alone", async () => {
  const handler = vi.fn<JobHandler>(async () => {});
  const registry = new JobRegistry().register("event:task.due", handler);
  await addJob("subscribed", { type: "event:task.due" });
  await addJob("unsubscribed", { type: "event:task.created" });
  await addJob("future", { type: "event:task.created", runAt: new Date(NOW.getTime() + 60_000) });
  await addJob("other", { type: "notification.email" });

  expect(await completeUnsubscribedEvents(db, registry, NOW)).toBe(1);
  const byKey = Object.fromEntries(
    (await db.select().from(jobs)).map((job) => [job.idempotencyKey, job.status]),
  );
  expect(byKey).toEqual({
    subscribed: "pending",
    unsubscribed: "succeeded",
    future: "pending",
    other: "pending",
  });

  expect(await runDueJobs(db, registry, clock)).toMatchObject({ skipped: 0, claimed: 1 });
  expect(handler).toHaveBeenCalledTimes(1);
});

it("completes every due event when nothing is registered", async () => {
  await addJob("a");
  await addJob("b", { type: "event:other.happened" });
  expect(await completeUnsubscribedEvents(db, new JobRegistry(), NOW)).toBe(2);
});

it("deletes succeeded jobs older than 30 days and keeps the rest", async () => {
  await addJob("old-done", { status: "succeeded", completedAt: daysAgo(31) });
  await addJob("recent-done", { status: "succeeded", completedAt: daysAgo(29) });
  await addJob("old-pending", { status: "pending", createdAt: daysAgo(60) });
  await addJob("old-running", { status: "running", lockedAt: daysAgo(40) });
  await addJob("old-failed", { status: "failed", lastError: "boom" });

  expect(await pruneSucceededJobs(db, NOW)).toBe(1);

  const left = (await db.select().from(jobs)).map((job) => job.idempotencyKey).sort();
  expect(left).toEqual(["old-failed", "old-pending", "old-running", "recent-done"]);
});

it("detaches a pruned job from its processed receipt but keeps jobs an unprocessed receipt needs", async () => {
  const processedJob = await addJob("ingest:1", {
    type: "ingest.process",
    status: "succeeded",
    completedAt: daysAgo(40),
  });
  const waitingJob = await addJob("ingest:2", {
    type: "ingest.process",
    status: "succeeded",
    completedAt: daysAgo(40),
  });
  await db.insert(ingestReceipts).values([
    { source: "leads", sourceRecordId: "done", body: "{}", jobId: processedJob.id, processedAt: daysAgo(39) },
    { source: "leads", sourceRecordId: "waiting", body: "{}", jobId: waitingJob.id },
  ]);

  expect(await pruneSucceededJobs(db, NOW)).toBe(1);

  const receipts = await db.select().from(ingestReceipts);
  expect(receipts.find((r) => r.sourceRecordId === "done")?.jobId).toBeNull();
  expect(receipts.find((r) => r.sourceRecordId === "waiting")?.jobId).toBe(waitingJob.id);
  expect((await db.select().from(jobs)).map((job) => job.id)).toEqual([waitingJob.id]);
});

it("empties receipt bodies 90 days after processing and still recognises the record", async () => {
  await db.insert(ingestReceipts).values([
    { source: "leads", sourceRecordId: "old", body: '{"email":"a@example.com"}', processedAt: daysAgo(91) },
    { source: "leads", sourceRecordId: "recent", body: '{"email":"b@example.com"}', processedAt: daysAgo(89) },
    { source: "leads", sourceRecordId: "unprocessed", body: '{"email":"c@example.com"}' },
  ]);

  expect(await clearProcessedReceiptBodies(db, NOW)).toBe(1);

  const bodies = Object.fromEntries(
    (await db.select().from(ingestReceipts)).map((r) => [r.sourceRecordId, r.body]),
  );
  expect(bodies).toEqual({
    old: "",
    recent: '{"email":"b@example.com"}',
    unprocessed: '{"email":"c@example.com"}',
  });
  // Clearing again finds nothing new.
  expect(await clearProcessedReceiptBodies(db, NOW)).toBe(0);

  const again = await storeReceipt(db, {
    source: "leads",
    sourceRecordId: "old",
    body: '{"email":"a@example.com"}',
  });
  expect(again.duplicate).toBe(true);
  expect(await db.select().from(ingestReceipts)).toHaveLength(3);
});

it("reports what a cleanup run removed", async () => {
  await addJob("old-done", { status: "succeeded", completedAt: daysAgo(31) });
  await db.insert(ingestReceipts).values({
    source: "leads",
    sourceRecordId: "old",
    body: "{}",
    processedAt: daysAgo(100),
  });
  expect(await cleanupJobs(db, NOW)).toEqual({ jobsPruned: 1, receiptBodiesCleared: 1 });
  expect(await cleanupJobs(db, NOW)).toEqual({ jobsPruned: 0, receiptBodiesCleared: 0 });
});
