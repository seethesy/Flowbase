import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { collectorRuns, ingestReceipts, leads } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { JobRegistry, runDueJobs } from "../../worker/jobs/queue";
import { registerIngestProcessing } from "../../worker/ingest/receipts";
import type { CollectedLead, CollectorRun } from "../../shared/collector";

// Lead intake through the ingestion endpoints into leads (FLOW-102 collector,
// FLOW-108 Thumbtack), with the processors the Worker registers.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const app = createApp({ withDb });
const env = {
  ASSETS: { fetch },
  INGEST_TOKEN_LEADS: "collector-token",
  INGEST_TOKEN_THUMBTACK: "thumbtack-token-0123456789",
};
const registry = registerIngestProcessing(new JobRegistry());
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers }, env);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/thumbtack/${name}.json`, "utf8"));
const fixtureFile = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/website/${name}.json`, "utf8"));
const thumbtack = (body: unknown) =>
  post("/api/ingest/thumbtack/thumbtack-token-0123456789", body);
const collector = (path: string, body: unknown) =>
  post(path, body, { Authorization: "Bearer collector-token" });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table collector_runs, lead_duplicates, leads, client_contacts, clients, ingest_receipts, jobs cascade`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("Thumbtack webhook intake (FLOW-108)", () => {
  it("creates one lead from the sample payload, and nothing more when it is posted again (AC1)", async () => {
    expect((await thumbtack(fixture("lead"))).status).toBe(202);
    await runDueJobs(db, registry);
    expect((await thumbtack(fixture("lead"))).status).toBe(200);
    await runDueJobs(db, registry);
    const rows = await db.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "webhook",
      source: "Thumbtack",
      sourceLeadId: "500000000000000001",
      name: "Sample Customer",
      eventDate: "2026-11-14",
      guestCount: 80,
      budgetCents: 1_200_000,
      status: "new",
    });
    expect(rows[0].rawPayload).toEqual(fixture("lead"));
  });

  it("updates the existing lead on a status update instead of creating another (AC2)", async () => {
    await thumbtack(fixture("lead"));
    await runDueJobs(db, registry);
    await thumbtack(fixture("status-update"));
    await runDueJobs(db, registry);
    const rows = await db.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guestCount: 95, email: "sample.customer@example.com" });
    expect(await db.select().from(ingestReceipts)).toHaveLength(2);
  });

  it("stores nothing for a request without the token (AC3)", async () => {
    expect((await post("/api/ingest/thumbtack", fixture("lead"))).status).toBe(401);
    expect(await db.select().from(ingestReceipts)).toEqual([]);
  });
});

describe("lead collector intake (FLOW-102)", () => {
  const lead: CollectedLead = {
    site: "bark",
    source: "Bark",
    sourceLeadId: "bark-9",
    sourceRecordId: "bark:bark-9:0123456789abcdef",
    name: "Sample Person",
    email: "sample.person@example.com",
    eventDate: "2026-11-14",
    raw: { page: "bark-9" },
  };

  it("turns a posted lead into a collector lead with its raw payload", async () => {
    expect((await collector("/api/ingest/leads", lead)).status).toBe(202);
    await runDueJobs(db, registry);
    const [row] = await db.select().from(leads);
    expect(row).toMatchObject({
      channel: "collector",
      source: "Bark",
      sourceLeadId: "bark-9",
      name: "Sample Person",
      rawPayload: { site: "bark", sourceRecordId: lead.sourceRecordId, page: "bark-9" },
    });
    // A changed version of the same lead updates it.
    await collector("/api/ingest/leads", {
      ...lead,
      sourceRecordId: "bark:bark-9:fedcba9876543210",
      guestCount: 60,
    });
    await runDueJobs(db, registry);
    expect(await db.select().from(leads)).toEqual([expect.objectContaining({ guestCount: 60 })]);
  });

  it("stores each site's run result once", async () => {
    const run: CollectorRun = {
      sourceRecordId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54:bark",
      runId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
      site: "bark",
      startedAt: "2026-10-23T12:00:00.000Z",
      finishedAt: "2026-10-23T12:02:00.000Z",
      leadsFound: 3,
      status: "blocked",
      message: "The site showed a CAPTCHA.",
    };
    expect((await collector("/api/ingest/collector-runs", run)).status).toBe(202);
    expect((await collector("/api/ingest/collector-runs", run)).status).toBe(200);
    await runDueJobs(db, registry);
    expect(await db.select().from(collectorRuns)).toEqual([
      expect.objectContaining({ site: "bark", status: "blocked", leadsFound: 3 }),
    ]);
  });

  it("fails the processing job for a malformed lead so it can be replayed", async () => {
    await collector("/api/ingest/leads", { sourceRecordId: "bark:x", site: "bark" });
    await runDueJobs(db, registry, { maxAttempts: 1 });
    const [receipt] = await db.select().from(ingestReceipts);
    expect(receipt.processedAt).toBeNull();
    expect(await db.select().from(leads)).toEqual([]);
  });
});

describe("website inquiry intake (FLOW-109)", () => {
  const inquiry = (overrides: Record<string, unknown> = {}) => ({
    ...(fixtureFile("inquiry") as object),
    ...overrides,
  });
  const submit = (body: unknown, ip = "203.0.113.7") =>
    post("/api/ingest/website", body, { "CF-Connecting-IP": ip });

  it("creates a Website lead from a valid submission (AC1)", async () => {
    expect((await submit(inquiry())).status).toBe(202);
    await runDueJobs(db, registry);
    const [lead] = await db.select().from(leads);
    expect(lead).toMatchObject({
      channel: "webhook",
      source: "Website",
      name: "Jordan Example",
      email: "jordan.example@example.test",
      eventDate: "2027-06-12",
      guestCount: 85,
      eventType: "Wedding",
      status: "new",
    });
  });

  it("stores nothing for a filled honeypot (AC1)", async () => {
    expect((await submit(fixtureFile("spam"))).status).toBe(202);
    await runDueJobs(db, registry);
    expect(await db.select().from(ingestReceipts)).toHaveLength(0);
    expect(await db.select().from(leads)).toHaveLength(0);
  });

  it("stores nothing over the per-client rate limit; other clients are unaffected (AC1)", async () => {
    for (let n = 0; n < 5; n += 1)
      expect((await submit(inquiry({ submissionId: `submission-${n}-abcdef` }))).status).toBe(202);
    const limited = await submit(inquiry({ submissionId: "submission-6-abcdef" }));
    expect(limited.status).toBe(429);
    expect(await db.select().from(ingestReceipts)).toHaveLength(5);
    expect(
      (await submit(inquiry({ submissionId: "other-client-abcdef" }), "198.51.100.9")).status,
    ).toBe(202);
  });

  it("stops accepting once the total limit is reached, even from new clients", async () => {
    for (let n = 0; n < 100; n += 1)
      await db.insert(ingestReceipts).values({
        source: "website",
        sourceRecordId: `seeded-${n}`,
        body: JSON.stringify({ clientKey: `key-${n}` }),
      });
    expect((await submit(inquiry({ submissionId: "one-too-many-abc" }))).status).toBe(429);
  });

  it("creates nothing new when the same submission is delivered again (AC2)", async () => {
    expect((await submit(inquiry())).status).toBe(202);
    await runDueJobs(db, registry);
    expect((await submit(inquiry())).status).toBe(200);
    await runDueJobs(db, registry);
    expect(await db.select().from(ingestReceipts)).toHaveLength(1);
    expect(await db.select().from(leads)).toHaveLength(1);
  });

  it("does not count submissions older than the window", async () => {
    for (let n = 0; n < 5; n += 1)
      await db.insert(ingestReceipts).values({
        source: "website",
        sourceRecordId: `old-${n}`,
        body: JSON.stringify({ clientKey: "x" }),
        createdAt: new Date(Date.now() - 3_600_000),
      });
    expect((await submit(inquiry())).status).toBe(202);
  });
});
