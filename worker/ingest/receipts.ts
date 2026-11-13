import { and, desc, eq, gte, isNull, like, sql } from "drizzle-orm";
import type { IngestReceipt } from "../../shared/api";
import type { Db, DbLike } from "../db/client";
import { ingestReceipts, jobs } from "../db/schema";
import { enqueueJob, type JobContext, type JobRegistry } from "../jobs/queue";
import { ingestProcessors } from "./processors";

export const INGEST_JOB_TYPE = "ingest.process";
export type ReceiptRow = typeof ingestReceipts.$inferSelect;

// Stores the raw payload once per source record and queues its processing job in
// the same transaction. A repeat of the same record returns the first receipt.
export function storeReceipt(
  db: Db,
  input: { source: string; sourceRecordId: string; body: string },
): Promise<{ receiptId: string; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(ingestReceipts)
      .values(input)
      .onConflictDoNothing({
        target: [ingestReceipts.source, ingestReceipts.sourceRecordId],
      })
      .returning({ id: ingestReceipts.id });
    if (!created) {
      const [existing] = await tx
        .select({ id: ingestReceipts.id })
        .from(ingestReceipts)
        .where(
          and(
            eq(ingestReceipts.source, input.source),
            eq(ingestReceipts.sourceRecordId, input.sourceRecordId),
          ),
        );
      return { receiptId: existing.id, duplicate: true };
    }
    const job = await enqueueJob(tx, {
      type: INGEST_JOB_TYPE,
      payload: { receiptId: created.id },
      idempotencyKey: `ingest:${created.id}`,
    });
    await tx
      .update(ingestReceipts)
      .set({ jobId: job?.id })
      .where(eq(ingestReceipts.id, created.id));
    return { receiptId: created.id, duplicate: false };
  });
}

// How many receipts a public source stored in the window: all, and those from one
// client (its hashed key sits in the stored body as "clientKey"). The rate limit
// of a public form (FLOW-109) reads this before storing the next submission.
export async function recentReceiptCounts(
  db: Db,
  input: { source: string; clientKey: string; windowSeconds: number },
): Promise<{ total: number; client: number }> {
  const since = new Date(Date.now() - input.windowSeconds * 1000);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      client: sql<number>`count(*) filter (where ${like(
        ingestReceipts.body,
        `%"clientKey":"${input.clientKey}"%`,
      )})::int`,
    })
    .from(ingestReceipts)
    .where(
      and(
        eq(ingestReceipts.source, input.source),
        gte(ingestReceipts.createdAt, since),
      ),
    );
  return row;
}

// Turns a stored receipt into Flowbase records. Each source's ticket adds its own
// to ingestProcessors (worker/ingest/processors.ts); a receipt without one stays
// unprocessed.
export type IngestProcessor = (
  receipt: ReceiptRow,
  context: JobContext,
) => Promise<void>;

export function registerIngestProcessing(
  registry: JobRegistry,
  processors: Map<string, IngestProcessor> = ingestProcessors,
) {
  registry.register(INGEST_JOB_TYPE, async (job, context) => {
    const { receiptId } = job.payload as { receiptId: string };
    const [receipt] = await context.db
      .select()
      .from(ingestReceipts)
      .where(eq(ingestReceipts.id, receiptId));
    if (!receipt) throw new Error(`Ingest receipt ${receiptId} was not found.`);
    const processor = processors.get(receipt.source);
    if (receipt.processedAt || !processor) return;
    await processor(receipt, context);
    await context.db
      .update(ingestReceipts)
      .set({ processedAt: new Date() })
      .where(eq(ingestReceipts.id, receipt.id));
  });
  return registry;
}

const receiptColumns = {
  receipt: ingestReceipts,
  jobStatus: jobs.status,
  lastError: jobs.lastError,
};
type ReceiptListRow = {
  receipt: ReceiptRow;
  jobStatus: IngestReceipt["jobStatus"];
  lastError: string | null;
};
const toReceipt = ({ receipt, jobStatus, lastError }: ReceiptListRow) => ({
  id: receipt.id,
  source: receipt.source,
  sourceRecordId: receipt.sourceRecordId,
  jobId: receipt.jobId,
  jobStatus,
  lastError,
  processedAt: receipt.processedAt?.toISOString() ?? null,
  createdAt: receipt.createdAt.toISOString(),
});

export async function listReceipts(
  db: Db,
  filter: { source?: string; status?: "all" | "failed" | "unprocessed" },
  limit = 50,
): Promise<IngestReceipt[]> {
  const rows = await db
    .select(receiptColumns)
    .from(ingestReceipts)
    .leftJoin(jobs, eq(ingestReceipts.jobId, jobs.id))
    .where(
      and(
        isNull(ingestReceipts.archivedAt),
        filter.source ? eq(ingestReceipts.source, filter.source) : undefined,
        filter.status === "failed" ? eq(jobs.status, "failed") : undefined,
        filter.status === "unprocessed" ? isNull(ingestReceipts.processedAt) : undefined,
      ),
    )
    .orderBy(desc(ingestReceipts.createdAt))
    .limit(limit);
  return rows.map(toReceipt);
}

async function getReceipt(db: DbLike, id: string) {
  const [row] = await db
    .select(receiptColumns)
    .from(ingestReceipts)
    .leftJoin(jobs, eq(ingestReceipts.jobId, jobs.id))
    .where(eq(ingestReceipts.id, id));
  return row;
}

// A receipt with a failed job, or one that succeeded before its source had a
// processor, can be queued again.
export async function replayReceipt(
  db: Db,
  id: string,
): Promise<IngestReceipt | undefined> {
  const queued = await db.transaction(async (tx) => {
    await tx.select({ id: ingestReceipts.id }).from(ingestReceipts)
      .where(eq(ingestReceipts.id, id)).for("update");
    const current = await getReceipt(tx, id);
    if (!current || current.receipt.processedAt ||
      (current.jobStatus !== "failed" && current.jobStatus !== "succeeded")) return false;
    const job = await enqueueJob(tx, {
      type: INGEST_JOB_TYPE,
      payload: { receiptId: id },
      idempotencyKey: `ingest:${id}:replay:${crypto.randomUUID()}`,
    });
    await tx
      .update(ingestReceipts)
      .set({ jobId: job?.id })
      .where(eq(ingestReceipts.id, id));
    return true;
  });
  if (!queued) return undefined;
  const replayed = await getReceipt(db, id);
  return replayed && toReceipt(replayed);
}
