import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, timestamptz } from "./conventions";

// Every table: spread baseColumns() and finish with .enableRLS() (see conventions.ts).
// CI fails if a migrated table in the public schema lacks RLS.

// Proves reads and writes through Hyperdrive. Served only where DB_CHECK_ROUTE is
// enabled (the dev environment); holds no business data.
export const connectionChecks = pgTable("connection_checks", {
  ...baseColumns(),
  note: text("note").notNull(),
}).enableRLS();

// Outbox and work queue (FLOW-27). Domain events and background work are rows here,
// written in the same transaction as the change they describe, and run by the cron.
export const jobStatuses = ["pending", "running", "succeeded", "failed"] as const;
export const jobs = pgTable(
  "jobs",
  {
    ...baseColumns(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    runAt: timestamptz("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    status: text("status", { enum: jobStatuses }).notNull().default("pending"),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    lockedAt: timestamptz("locked_at"),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [index("jobs_status_run_at_idx").on(table.status, table.runAt)],
).enableRLS();

// Raw payloads pushed by outside systems (FLOW-28). One row per source record;
// processing happens in the job named by job_id.
export const ingestReceipts = pgTable(
  "ingest_receipts",
  {
    ...baseColumns(),
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    body: text("body").notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    processedAt: timestamptz("processed_at"),
  },
  (table) => [
    uniqueIndex("ingest_receipts_source_record_idx").on(
      table.source,
      table.sourceRecordId,
    ),
  ],
).enableRLS();
