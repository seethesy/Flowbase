import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Job } from "../../shared/api";
import type { Db, DbLike } from "../db/client";
import { jobs, type jobStatuses } from "../db/schema";

// Jobs, cron and domain events (FLOW-27, ADR-09, ADR-10). Every cron run claims a
// small batch so it stays inside the Workers Free 10 ms CPU budget; handlers spend
// their time waiting on I/O, which does not count towards it.
export type JobRow = typeof jobs.$inferSelect;
export type JobStatus = (typeof jobStatuses)[number];

export const JOB_BATCH_SIZE = 10;
export const JOB_MAX_ATTEMPTS = 5;
// A job left "running" this long (the Worker died mid-run) becomes claimable again.
const STALE_LOCK_MS = 10 * 60_000;

// Retry delay after the given number of attempts: 30 s, 1 min, 2 min, … capped at 1 h.
export function backoffMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

export type EnqueueInput = {
  type: string;
  payload: unknown;
  idempotencyKey: string;
  runAt?: Date;
};

// Writes the job with the caller's db or transaction, so it commits or rolls back
// with the change it belongs to (outbox). A duplicate idempotency key is ignored and
// returns undefined.
export async function enqueueJob(
  db: DbLike,
  input: EnqueueInput,
): Promise<JobRow | undefined> {
  const [row] = await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload ?? {},
      idempotencyKey: input.idempotencyKey,
      // Stamp with the app clock, not Postgres now(): claimDueJobs compares
      // against a JS Date (millisecond precision), and a microsecond-precision
      // database timestamp from the same millisecond would not be due yet.
      runAt: input.runAt ?? new Date(),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();
  return row;
}

export type DomainEvent = {
  // "<entity>.<past-tense verb>", e.g. "client.created".
  name: string;
  entityId: string;
  data?: Record<string, unknown>;
  // Defaults to a fresh key: each emitted event runs once.
  idempotencyKey?: string;
};

// Domain events are jobs of type "event:<name>". Call this inside the transaction
// that makes the change; an event from a rolled-back transaction never exists.
export function emitDomainEvent(db: DbLike, event: DomainEvent) {
  return enqueueJob(db, {
    type: `event:${event.name}`,
    payload: { entityId: event.entityId, ...event.data },
    idempotencyKey:
      event.idempotencyKey ?? `event:${event.name}:${crypto.randomUUID()}`,
  });
}

export type JobContext = { db: Db };
export type JobHandler = (job: JobRow, context: JobContext) => Promise<void>;

// Handlers register by job type. Events without a subscriber succeed as no-ops;
// any other job type without a handler fails, so it shows up for an admin.
export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  register(type: string, handler: JobHandler) {
    if (this.handlers.has(type))
      throw new Error(`A handler for ${type} is already registered.`);
    this.handlers.set(type, handler);
    return this;
  }
  get(type: string) {
    return this.handlers.get(type);
  }
}

// Marks up to batchSize due jobs as running and returns them. SKIP LOCKED keeps
// overlapping cron runs from claiming the same job.
export async function claimDueJobs(
  db: DbLike,
  batchSize: number,
  now = new Date(),
): Promise<JobRow[]> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        isNull(jobs.archivedAt),
        or(
          and(eq(jobs.status, "pending"), lte(jobs.runAt, now)),
          and(eq(jobs.status, "running"), lt(jobs.lockedAt, staleBefore)),
        ),
      ),
    )
    .orderBy(asc(jobs.runAt))
    .limit(batchSize)
    .for("update", { skipLocked: true });
  return db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: now,
      attempts: sql`${jobs.attempts} + 1`,
    })
    .where(inArray(jobs.id, due))
    .returning();
}

export type RunOptions = {
  batchSize?: number;
  maxAttempts?: number;
  now?: () => Date;
};
export type RunSummary = {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
};

export async function runDueJobs(
  db: Db,
  registry: JobRegistry,
  options: RunOptions = {},
): Promise<RunSummary> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? JOB_MAX_ATTEMPTS;
  const claimed = await claimDueJobs(
    db,
    options.batchSize ?? JOB_BATCH_SIZE,
    now(),
  );
  const summary = { claimed: claimed.length, succeeded: 0, retried: 0, failed: 0 };
  for (const job of claimed) {
    try {
      const handler = registry.get(job.type);
      if (handler) await handler(job, { db });
      else if (!job.type.startsWith("event:"))
        throw new Error(`No handler is registered for job type ${job.type}.`);
      await db
        .update(jobs)
        .set({
          status: "succeeded",
          lockedAt: null,
          lastError: null,
          completedAt: now(),
        })
        .where(eq(jobs.id, job.id));
      summary.succeeded += 1;
    } catch (error) {
      const lastError = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 1000);
      if (job.attempts >= maxAttempts) {
        await db
          .update(jobs)
          .set({ status: "failed", lockedAt: null, lastError })
          .where(eq(jobs.id, job.id));
        summary.failed += 1;
      } else {
        await db
          .update(jobs)
          .set({
            status: "pending",
            lockedAt: null,
            lastError,
            runAt: new Date(now().getTime() + backoffMs(job.attempts)),
          })
          .where(eq(jobs.id, job.id));
        summary.retried += 1;
      }
    }
  }
  return summary;
}

export const toJob = (row: JobRow): Job => ({
  id: row.id,
  type: row.type,
  status: row.status,
  attempts: row.attempts,
  runAt: row.runAt.toISOString(),
  lastError: row.lastError,
  createdAt: row.createdAt.toISOString(),
});

export async function listJobs(
  db: Db,
  status: JobStatus,
  limit = 50,
): Promise<Job[]> {
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, status), isNull(jobs.archivedAt)))
    .orderBy(desc(jobs.updatedAt))
    .limit(limit);
  return rows.map(toJob);
}

// Puts a failed job back in the queue with a fresh set of attempts. Returns
// undefined when the job doesn't exist or isn't failed.
export async function retryFailedJob(
  db: Db,
  id: string,
  now = new Date(),
): Promise<Job | undefined> {
  const [row] = await db
    .update(jobs)
    .set({
      status: "pending",
      attempts: 0,
      runAt: now,
      lockedAt: null,
      lastError: null,
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, "failed")))
    .returning();
  return row && toJob(row);
}
