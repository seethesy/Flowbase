import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { ingestReceipts, jobs } from "../db/schema";

// Retention for the jobs outbox and ingest bodies (FLOW-184), so they don't fill
// Supabase Free's 500 MB. Each run handles one bounded batch; the cron's next run
// continues where it stopped.
export const JOB_RETENTION_DAYS = 30;
// Raw payloads hold client contact details: long enough to debug a bad import,
// short enough to limit stored personal data (Q1 answer).
export const RECEIPT_BODY_RETENTION_DAYS = 90;
export const CLEANUP_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60_000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

export type JobCleanupSummary = {
  jobsPruned: number;
  receiptBodiesCleared: number;
};

// Deletes succeeded jobs that finished more than JOB_RETENTION_DAYS ago. Pending,
// running and failed jobs stay. Idempotency keys that outlive this (the task due
// scan looks back only 7 days) are not at risk.
//
// A receipt points at its processing job, so the pointer is cleared first. A job
// whose receipt is still unprocessed is kept: replaying that receipt needs it.
export async function pruneSucceededJobs(db: Db, now = new Date()): Promise<number> {
  const cutoff = daysBefore(now, JOB_RETENTION_DAYS);
  return db.transaction(async (tx) => {
    const old = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "succeeded"),
          lt(jobs.completedAt, cutoff),
          sql`not exists (
            select 1 from ${ingestReceipts}
            where ${ingestReceipts.jobId} = ${jobs.id}
              and ${ingestReceipts.processedAt} is null
          )`,
        ),
      )
      .limit(CLEANUP_BATCH_SIZE);
    if (!old.length) return 0;
    const ids = old.map((row) => row.id);
    await tx
      .update(ingestReceipts)
      .set({ jobId: null })
      .where(inArray(ingestReceipts.jobId, ids));
    await tx.delete(jobs).where(inArray(jobs.id, ids));
    return ids.length;
  });
}

// Empties the raw body of receipts processed more than RECEIPT_BODY_RETENTION_DAYS
// ago. The row (source, record id, timestamps) stays, so the same record posted
// again is still recognised as a duplicate.
export async function clearProcessedReceiptBodies(
  db: Db,
  now = new Date(),
): Promise<number> {
  const cutoff = daysBefore(now, RECEIPT_BODY_RETENTION_DAYS);
  const cleared = await db
    .update(ingestReceipts)
    .set({ body: "" })
    .where(
      inArray(
        ingestReceipts.id,
        db
          .select({ id: ingestReceipts.id })
          .from(ingestReceipts)
          .where(
            and(
              isNotNull(ingestReceipts.processedAt),
              lt(ingestReceipts.processedAt, cutoff),
              ne(ingestReceipts.body, ""),
            ),
          )
          .limit(CLEANUP_BATCH_SIZE),
      ),
    )
    .returning({ id: ingestReceipts.id });
  return cleared.length;
}

export async function cleanupJobs(db: Db, now = new Date()): Promise<JobCleanupSummary> {
  return {
    jobsPruned: await pruneSucceededJobs(db, now),
    receiptBodiesCleared: await clearProcessedReceiptBodies(db, now),
  };
}
