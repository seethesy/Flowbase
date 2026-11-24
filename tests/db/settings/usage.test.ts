import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { countUsage, flushUsage, readUsage, refreshUsage, recordGithubUsage, resetPendingUsage, setUsage } from "../../../worker/records/settings/usage";
import { createApp } from "../../../worker/app";
import { createJobRegistry, runScheduledJobs } from "../../../worker/jobs/cron";
import { runDueJobs } from "../../../worker/jobs/queue";
import type { RunWithDb } from "../../../worker/hono";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const clear = sql`truncate table usage_counters, sms_outbox, notifications, ingest_receipts, jobs, settings, users cascade`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(clear);
  await db.insert(schema.users).values({ email: "usage-admin@example.com", name: "Admin",
    role: "admin", mobile: "2025550100", status: "active" });
  await db.insert(schema.settings).values({ key: "defaults", value: {
    freeTierLimits: { workerRequests: 100, supabaseBytes: 1 }, monthlySmsCap: 10 } });
});
afterAll(async () => { await db.execute(clear); await client.end(); await counting.end(); });

// A second client that logs its statements (FLOW-305).
const statements: string[] = [];
const counting = postgres(url, { max: 1, debug: (_connection, query) => { statements.push(String(query)); } });
const countedDb = drizzle(counting, { schema });
const usageWrites = () => statements.filter((query) => /insert into "usage_counters"/i.test(query)).length;

it("shows usage and queues one email per threshold per period", async () => {
  const now = new Date();
  await setUsage(db, "worker_requests", 70, now);
  let rows = await refreshUsage(db, now);
  expect(rows.find((row) => row.metric === "worker_requests")).toMatchObject({ value: 70, limit: 100, percent: 70 });
  await refreshUsage(db, now);
  let alerts = await db.select().from(schema.notifications).where(eq(schema.notifications.type, "production_alert"));
  expect(alerts.filter((row) => row.title.startsWith("Worker API"))).toHaveLength(1);
  await setUsage(db, "worker_requests", 90, now);
  rows = await refreshUsage(db, now);
  expect(rows.find((row) => row.metric === "worker_requests")?.percent).toBe(90);
  alerts = await db.select().from(schema.notifications).where(eq(schema.notifications.type, "production_alert"));
  expect(alerts.filter((row) => row.title.startsWith("Worker API"))).toHaveLength(2);
  expect((await db.select().from(schema.jobs).where(eq(schema.jobs.type, "notification.email")))
    .filter((job) => alerts.some((row) => (job.payload as { notificationId?: string }).notificationId === row.id)))
    .toHaveLength(alerts.length);
});

it("keeps account-wide Actions minutes monotonic for repeated reports", async () => {
  await recordGithubUsage(db, "2026-11", 125);
  await recordGithubUsage(db, "2026-11", 100);
  const rows = await readUsage(db, new Date("2026-11-10T12:00:00Z"));
  expect(rows.find((row) => row.metric === "github_minutes")?.value).toBe(125);
});

it("authenticates and ingests an account-wide Actions report", async () => {
  const app = createApp({ withDb: ((_env, run) => run(db)) as RunWithDb });
  const body = JSON.stringify({ sourceRecordId: "2026-11:125", period: "2026-11", minutes: 125 });
  const env = { INGEST_TOKEN_LEADS: "test-token", ASSETS: { fetch } };
  const post = (token: string) => app.request("/api/ingest/actions-usage", { method: "POST",
    headers: { Authorization: `Bearer ${token}` }, body }, env);
  expect((await post("wrong")).status).toBe(401);
  expect((await post("test-token")).status).toBe(202);
  const registry = createJobRegistry();
  await runDueJobs(db, registry, { now: () => new Date(Date.now() + 1000) });
  const rows = await readUsage(db, new Date("2026-11-10T12:00:00Z"));
  expect(rows.find((row) => row.metric === "github_minutes")?.value).toBe(125);
});

it("adds many requests' counts to the day's total in one upsert per minute per isolate (FLOW-305 AC3)", async () => {
  resetPendingUsage();
  const now = new Date();
  await setUsage(db, "worker_requests", 5, now);
  const app = createApp({ withDb: ((_env, run) => run(countedDb)) as RunWithDb });
  const env = { ASSETS: { fetch }, HYPERDRIVE: { connectionString: "postgres://unused" } };
  statements.length = 0;
  for (let i = 0; i < 10; i++) expect((await app.request("/api/health", {}, env)).status).toBe(200);
  // The first request found the isolate due a flush; the other nine wait for the next.
  expect(usageWrites()).toBe(1);
  expect((await readUsage(db, now)).find((row) => row.metric === "worker_requests")?.value).toBe(6);
  await flushUsage(countedDb);
  expect(usageWrites()).toBe(2);
  const rows = await readUsage(db, now);
  expect(rows.find((row) => row.metric === "worker_requests")).toMatchObject({ value: 15, source: "estimate" });
});

it("stores today's requests and queries from Cloudflare in the hourly sweep (FLOW-305 AC2)", async () => {
  resetPendingUsage();
  const now = new Date();
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const fetcher = async () => Response.json({ data: { viewer: { accounts: [{
    workers: [{ sum: { requests: 4167 } }], hyperdrive: [{ count: 32968 }] }] } }, errors: null });
  await runScheduledJobs({ ASSETS: { fetch }, HYPERDRIVE: { connectionString: "postgres://unused" },
    CF_ANALYTICS_TOKEN: "analytics-token", CF_ACCOUNT_ID: "account-id", CF_HYPERDRIVE_ID: "hyperdrive-id" },
  createJobRegistry({ emailProvider: () => undefined }), { withDb: ((_env, run) => run(db)) as RunWithDb,
    scheduledTime: hour.getTime(), now: () => now, fetch: fetcher as unknown as typeof fetch });
  const rows = await readUsage(db, now, { provider: true });
  expect(rows.find((row) => row.metric === "worker_requests")).toMatchObject({ value: 4167, source: "cloudflare" });
  expect(rows.find((row) => row.metric === "db_queries")).toMatchObject({ value: 32968, source: "cloudflare" });
  // Each read replaces the day's figure rather than adding to it.
  await runScheduledJobs({ ASSETS: { fetch }, HYPERDRIVE: { connectionString: "postgres://unused" },
    CF_ANALYTICS_TOKEN: "analytics-token", CF_ACCOUNT_ID: "account-id", CF_HYPERDRIVE_ID: "hyperdrive-id" },
  createJobRegistry({ emailProvider: () => undefined }), { withDb: ((_env, run) => run(db)) as RunWithDb,
    scheduledTime: hour.getTime(), now: () => now, fetch: fetcher as unknown as typeof fetch });
  expect((await readUsage(db, now)).find((row) => row.metric === "worker_requests")?.value).toBe(4167);
});

it("still raises the 70% and 90% alerts from counts the isolate flushed (FLOW-305 AC4)", async () => {
  resetPendingUsage();
  const now = new Date();
  await setUsage(db, "worker_requests", 69, now);
  countUsage("worker_requests", 1, now);
  await flushUsage(db);
  await refreshUsage(db, now);
  countUsage("worker_requests", 20, now);
  await flushUsage(db);
  await refreshUsage(db, now);
  const alerts = await db.select().from(schema.notifications).where(eq(schema.notifications.type, "production_alert"));
  expect(alerts.filter((row) => row.title.startsWith("Worker API")).map((row) => row.title).sort())
    .toEqual(["Worker API requests reached 70%", "Worker API requests reached 90%"]);
});
