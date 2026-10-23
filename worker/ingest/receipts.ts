import { and, desc, eq, isNull } from "drizzle-orm";
import type { IngestReceipt } from "../../shared/api";
import type { Db } from "../db/client";
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
  filter: { source?: string; failedOnly?: boolean },
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
        filter.failedOnly ? eq(jobs.status, "failed") : undefined,
      ),
    )
    .orderBy(desc(ingestReceipts.createdAt))
    .limit(limit);
  return rows.map(toReceipt);
}

async function getReceipt(db: Db, id: string) {
  const [row] = await db
    .select(receiptColumns)
    .from(ingestReceipts)
    .leftJoin(jobs, eq(ingestReceipts.jobId, jobs.id))
    .where(eq(ingestReceipts.id, id));
  return row;
}

// Queues a new processing job for a receipt whose job failed. Returns undefined
// when the receipt doesn't exist or its job hasn't failed.
export async function replayReceipt(
  db: Db,
  id: string,
): Promise<IngestReceipt | undefined> {
  const current = await getReceipt(db, id);
  if (!current || current.jobStatus !== "failed") return undefined;
  await db.transaction(async (tx) => {
    const job = await enqueueJob(tx, {
      type: INGEST_JOB_TYPE,
      payload: { receiptId: id },
      idempotencyKey: `ingest:${id}:replay:${crypto.randomUUID()}`,
    });
    await tx
      .update(ingestReceipts)
      .set({ jobId: job?.id })
      .where(eq(ingestReceipts.id, id));
  });
  const replayed = await getReceipt(db, id);
  return replayed && toReceipt(replayed);
}
