import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { readUsage, refreshUsage, recordGithubUsage, setUsage } from "../../worker/records/usage";
import { createApp } from "../../worker/app";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import type { RunWithDb } from "../../worker/hono";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const clear = sql`truncate table usage_counters, sms_outbox, notifications, ingest_receipts, jobs, settings, users cascade`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(clear);
  await db.insert(schema.users).values({ email: "usage-admin@example.com", name: "Admin",
    role: "admin", employmentType: "full_time", mobile: "2025550100", status: "active" });
  await db.insert(schema.settings).values({ key: "defaults", value: {
    freeTierLimits: { workerRequests: 100, supabaseBytes: 1 }, monthlySmsCap: 10 } });
});
afterAll(async () => { await db.execute(clear); await client.end(); });

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
