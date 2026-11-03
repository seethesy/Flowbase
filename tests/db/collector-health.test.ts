import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { registerCollectorSite, scanCollectorHealth } from "../../worker/records/collector-health";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const clear = sql`truncate table collector_sites, collector_runs, notifications, jobs, users`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(clear);
  await db.insert(schema.users).values({ email: "collector-admin@example.com", name: "Admin",
    role: "admin", employmentType: "full_time", mobile: "2025550100", status: "active" });
});
afterAll(async () => { await db.execute(clear); await client.end(); });

it("deduplicates login alerts until the site recovers", async () => {
  await registerCollectorSite(db, "bark");
  const at = new Date("2026-11-03T15:00:00Z");
  await db.insert(schema.collectorRuns).values({ runId: crypto.randomUUID(), site: "bark",
    startedAt: at, finishedAt: at, leadsFound: 0, status: "needs_login", message: "Expired session" });
  await scanCollectorHealth(db, at);
  await scanCollectorHealth(db, at);
  expect(await db.select().from(schema.jobs)).toHaveLength(1);
  const next = new Date("2026-11-03T16:00:00Z");
  await db.insert(schema.collectorRuns).values({ runId: crypto.randomUUID(), site: "bark",
    startedAt: next, finishedAt: next, leadsFound: 1, status: "ok" });
  await scanCollectorHealth(db, next);
  const again = new Date("2026-11-03T17:00:00Z");
  await db.insert(schema.collectorRuns).values({ runId: crypto.randomUUID(), site: "bark",
    startedAt: again, finishedAt: again, leadsFound: 0, status: "needs_login" });
  await scanCollectorHealth(db, again);
  expect(await db.select().from(schema.jobs)).toHaveLength(2);
});

it("sends one missing-run alert at 2pm ET and none before the window", async () => {
  await registerCollectorSite(db, "bark");
  await scanCollectorHealth(db, new Date("2026-11-03T13:00:00Z"));
  expect(await db.select().from(schema.jobs)).toHaveLength(0);
  await scanCollectorHealth(db, new Date("2026-11-03T19:00:00Z"));
  await scanCollectorHealth(db, new Date("2026-11-03T19:05:00Z"));
  expect(await db.select().from(schema.jobs)).toHaveLength(1);
});
