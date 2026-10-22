import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { jobs } from "../../worker/db/schema";
import {
  JobRegistry,
  backoffMs,
  emitDomainEvent,
  enqueueJob,
  retryFailedJob,
  runDueJobs,
  type JobHandler,
} from "../../worker/jobs/queue";

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

it("never runs a domain event emitted inside a rolled-back transaction", async () => {
  const handler = vi.fn<JobHandler>(async () => {});
  const registry = new JobRegistry().register("event:client.created", handler);
  await expect(
    db.transaction(async (tx) => {
      await emitDomainEvent(tx, { name: "client.created", entityId: "c-1" });
      throw new Error("rollback fixture");
    }),
  ).rejects.toThrow("rollback fixture");
  expect(await db.select().from(jobs)).toEqual([]);
  expect((await runDueJobs(db, registry)).claimed).toBe(0);
  expect(handler).not.toHaveBeenCalled();
});

it("runs a committed domain event once with its payload", async () => {
  const handler = vi.fn<JobHandler>(async () => {});
  const registry = new JobRegistry().register("event:client.created", handler);
  await db.transaction(async (tx) => {
    await emitDomainEvent(tx, {
      name: "client.created",
      entityId: "c-1",
      data: { by: "test" },
    });
  });
  expect(await runDueJobs(db, registry)).toMatchObject({
    claimed: 1,
    succeeded: 1,
  });
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler.mock.calls[0][0].payload).toEqual({
    entityId: "c-1",
    by: "test",
  });
  const [row] = await db.select().from(jobs);
  expect(row.status).toBe("succeeded");
  expect((await runDueJobs(db, registry)).claimed).toBe(0);
});

it("retries a throwing handler with backoff, then marks it failed", async () => {
  let clock = new Date("2026-10-22T08:00:00.000Z");
  const now = () => clock;
  const handler = vi.fn<JobHandler>(async () => {
    throw new Error("vendor API down");
  });
  const registry = new JobRegistry().register("flaky", handler);
  const options = { maxAttempts: 3, now };
  await enqueueJob(db, {
    type: "flaky",
    payload: {},
    idempotencyKey: "flaky-1",
    runAt: clock,
  });

  expect(await runDueJobs(db, registry, options)).toMatchObject({ retried: 1 });
  let [row] = await db.select().from(jobs);
  expect(row).toMatchObject({
    status: "pending",
    attempts: 1,
    lastError: "vendor API down",
    lockedAt: null,
  });
  expect(row.runAt.getTime()).toBe(clock.getTime() + backoffMs(1));
  // Not due again until the backoff has passed.
  expect((await runDueJobs(db, registry, options)).claimed).toBe(0);

  clock = row.runAt;
  expect(await runDueJobs(db, registry, options)).toMatchObject({ retried: 1 });
  [row] = await db.select().from(jobs);
  expect(row.attempts).toBe(2);
  expect(row.runAt.getTime()).toBe(clock.getTime() + backoffMs(2));

  clock = row.runAt;
  expect(await runDueJobs(db, registry, options)).toMatchObject({ failed: 1 });
  [row] = await db.select().from(jobs);
  expect(row).toMatchObject({ status: "failed", attempts: 3 });
  expect(handler).toHaveBeenCalledTimes(3);

  clock = new Date(clock.getTime() + 24 * 60 * 60_000);
  expect((await runDueJobs(db, registry, options)).claimed).toBe(0);

  // An admin retry gives it a fresh set of attempts.
  expect(await retryFailedJob(db, row.id, clock)).toMatchObject({
    status: "pending",
    attempts: 0,
    lastError: null,
  });
  expect(await retryFailedJob(db, row.id, clock)).toBeUndefined();
});

it("fails a job type that has no handler", async () => {
  await enqueueJob(db, { type: "unknown", payload: {}, idempotencyKey: "u-1" });
  await runDueJobs(db, new JobRegistry(), { maxAttempts: 1 });
  const [row] = await db.select().from(jobs);
  expect(row).toMatchObject({ status: "failed" });
  expect(row.lastError).toContain("No handler");
});

it("runs two jobs with the same idempotency key once", async () => {
  const handler = vi.fn<JobHandler>(async () => {});
  const registry = new JobRegistry().register("send", handler);
  const first = await enqueueJob(db, {
    type: "send",
    payload: { n: 1 },
    idempotencyKey: "send-1",
  });
  const second = await enqueueJob(db, {
    type: "send",
    payload: { n: 2 },
    idempotencyKey: "send-1",
  });
  expect(first?.id).toBeDefined();
  expect(second).toBeUndefined();
  await runDueJobs(db, registry);
  await runDueJobs(db, registry);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(await db.select().from(jobs)).toHaveLength(1);
});

it("processes at most the batch size per run", async () => {
  const handler = vi.fn<JobHandler>(async () => {});
  const registry = new JobRegistry().register("noop", handler);
  for (let index = 0; index < 15; index += 1)
    await enqueueJob(db, {
      type: "noop",
      payload: {},
      idempotencyKey: `noop-${index}`,
    });
  expect(await runDueJobs(db, registry, { batchSize: 10 })).toMatchObject({
    claimed: 10,
    succeeded: 10,
  });
  expect(handler).toHaveBeenCalledTimes(10);
  expect(await runDueJobs(db, registry, { batchSize: 10 })).toMatchObject({
    claimed: 5,
  });
});

it("reclaims a job whose run died while it was locked", async () => {
  const handler = vi.fn<JobHandler>(async () => {});
  const registry = new JobRegistry().register("noop", handler);
  const job = await enqueueJob(db, {
    type: "noop",
    payload: {},
    idempotencyKey: "stuck-1",
  });
  const lockedAt = new Date(Date.now() - 11 * 60_000);
  await db.execute(
    sql`update jobs set status = 'running', locked_at = ${lockedAt.toISOString()}::timestamptz where id = ${job?.id}`,
  );
  expect((await runDueJobs(db, registry)).succeeded).toBe(1);
});
