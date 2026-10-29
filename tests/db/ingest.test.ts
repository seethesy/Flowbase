import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { ingestReceipts, jobs } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { JobRegistry, runDueJobs } from "../../worker/jobs/queue";
import {
  INGEST_JOB_TYPE,
  registerIngestProcessing,
  type IngestProcessor,
} from "../../worker/ingest/receipts";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const admin: Actor = {
  userId: "3f0b8d2c-7a41-4c69-8e1f-5d2a9b6c0e17",
  role: "admin",
  employmentType: "full_time",
};
const app = createApp({ withDb, resolveActor: async () => admin });
const env = { ASSETS: { fetch }, INGEST_TOKEN_LEADS: "lead-token" };
const postLead = (body: object, token = "lead-token") =>
  app.request(
    "/api/ingest/leads",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}` },
    },
    env,
  );

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table ingest_receipts, jobs`);
});
afterAll(async () => {
  await client.end();
});

it("stores nothing for a request with an invalid token", async () => {
  const response = await postLead({ sourceRecordId: "bark-1" }, "guessed");
  expect(response.status).toBe(401);
  expect(await db.select().from(ingestReceipts)).toEqual([]);
  expect(await db.select().from(jobs)).toEqual([]);
});
it("keeps expression indexes for case-insensitive duplicate email matching", async () => {
  const indexes = await db.execute<{ indexname: string; indexdef: string }>(sql`
    select indexname, indexdef from pg_indexes where schemaname = 'public'
      and indexname in ('client_contacts_email_lower_idx', 'leads_email_lower_idx')`);
  expect(indexes.map((row) => row.indexname).sort()).toEqual([
    "client_contacts_email_lower_idx", "leads_email_lower_idx",
  ]);
  expect(indexes.every((row) => row.indexdef.includes("lower(email)"))).toBe(true);
});

it("creates one receipt and one job when the same record is posted twice", async () => {
  const first = await postLead({ sourceRecordId: "bark-1", name: "Jo" });
  expect(first.status).toBe(202);
  const second = await postLead({ sourceRecordId: "bark-1", name: "Jo" });
  expect(second.status).toBe(200);
  const [a, b] = [await first.json(), await second.json()];
  expect(b).toEqual({ receiptId: a.receiptId, duplicate: true });

  const receipts = await db.select().from(ingestReceipts);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({
    source: "leads",
    sourceRecordId: "bark-1",
    body: JSON.stringify({ sourceRecordId: "bark-1", name: "Jo" }),
  });
  const queued = await db.select().from(jobs);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    id: receipts[0].jobId,
    type: INGEST_JOB_TYPE,
    payload: { receiptId: a.receiptId },
  });
});

it("replays a failed processing job from the admin API", async () => {
  let broken = true;
  const processed: string[] = [];
  const processor: IngestProcessor = async (receipt) => {
    if (broken) throw new Error("mapping failed");
    processed.push(receipt.sourceRecordId);
  };
  const registry = registerIngestProcessing(
    new JobRegistry(),
    new Map([["leads", processor]]),
  );
  const { receiptId } = await (
    await postLead({ sourceRecordId: "bark-2" })
  ).json();
  await runDueJobs(db, registry, { maxAttempts: 1 });

  const failed = await app.request(
    "/api/admin/ingest-receipts?status=failed",
    {},
    env,
  );
  expect(failed.status).toBe(200);
  const [listed] = await failed.json();
  expect(listed).toMatchObject({
    id: receiptId,
    jobStatus: "failed",
    lastError: "mapping failed",
    processedAt: null,
  });
  const failedJobs = await (await app.request("/api/admin/jobs", {}, env)).json();
  expect(failedJobs).toHaveLength(1);

  broken = false;
  const replay = await app.request(
    `/api/admin/ingest-receipts/${receiptId}/replay`,
    { method: "POST" },
    env,
  );
  expect(replay.status).toBe(200);
  const replayed = await replay.json();
  expect(replayed).toMatchObject({ jobStatus: "pending", lastError: null });
  expect(replayed.jobId).not.toBe(listed.jobId);

  await runDueJobs(db, registry);
  expect(processed).toEqual(["bark-2"]);
  const [receipt] = await db.select().from(ingestReceipts);
  expect(receipt.processedAt).toBeInstanceOf(Date);

  const again = await app.request(
    `/api/admin/ingest-receipts/${receiptId}/replay`,
    { method: "POST" },
    env,
  );
  expect(again.status).toBe(404);
});
it("lists and replays a receipt left unprocessed before its processor existed", async () => {
  const { receiptId } = await (await postLead({ sourceRecordId: "late-source" })).json();
  await runDueJobs(db, registerIngestProcessing(new JobRegistry(), new Map()));
  const listed = await (await app.request("/api/admin/ingest-receipts?status=unprocessed", {}, env)).json();
  expect(listed).toEqual([expect.objectContaining({ id: receiptId, jobStatus: "succeeded", processedAt: null })]);
  const replay = await app.request(`/api/admin/ingest-receipts/${receiptId}/replay`, { method: "POST" }, env);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ id: receiptId, jobStatus: "pending" });
  const processed: string[] = [];
  await runDueJobs(db, registerIngestProcessing(new JobRegistry(), new Map([
    ["leads", async (receipt) => { processed.push(receipt.sourceRecordId); }],
  ])));
  expect(processed).toEqual(["late-source"]);
  expect((await db.select().from(ingestReceipts))[0].processedAt).toBeInstanceOf(Date);
});

it("retries a failed job from the admin API", async () => {
  await postLead({ sourceRecordId: "bark-3" });
  const registry = registerIngestProcessing(
    new JobRegistry(),
    new Map<string, IngestProcessor>([
      [
        "leads",
        async () => {
          throw new Error("mapping failed");
        },
      ],
    ]),
  );
  await runDueJobs(db, registry, { maxAttempts: 1 });
  const [job] = await (await app.request("/api/admin/jobs", {}, env)).json();
  const retried = await app.request(
    `/api/admin/jobs/${job.id}/retry`,
    { method: "POST" },
    env,
  );
  expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ status: "pending", attempts: 0 });
});
