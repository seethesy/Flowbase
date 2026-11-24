// Leads, the lead collector and lead duplicates.
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { pipelineStatuses } from "../../../shared/pipeline";
import { type JSONContent } from "@tiptap/core";
import { baseColumns, moneyCents, oneOf, timestamptz } from "../conventions";
import { trigram } from "./common";
import { events } from "./events";
import { jobs } from "./platform";
import { clients } from "./sales";

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
// Leads (FLOW-100). One record for every source: collector, webhook, manual entry and
// import. assigned_salesperson_id is a plain uuid until the users table exists
// (FLOW-37). raw_payload is the source's data as received, for debugging (FT+ only).
export const leadChannels = [
  "collector",
  "webhook",
  "manual",
  "import",
] as const;
export const leadStatuses = pipelineStatuses;
export const leads = pgTable(
  "leads",
  {
    ...baseColumns(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    channel: text("channel", { enum: leadChannels }).notNull(),
    source: text("source").notNull(),
    sourceLeadId: text("source_lead_id").notNull().default(""),
    sourceLeadUrl: text("source_lead_url").notNull().default(""),
    purchased: boolean("purchased").notNull().default(false),
    name: text("name").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    // Digits only, for search and duplicate matching.
    phoneDigits: text("phone_digits").notNull().default(""),
    eventDate: date("event_date", { mode: "string" }),
    guestCount: integer("guest_count"),
    location: text("location").notNull().default(""),
    eventType: text("event_type").notNull().default(""),
    eventName: text("event_name").notNull().default(""),
    notes: jsonb("notes").$type<JSONContent>(),
    budgetCents: moneyCents("budget_cents"),
    message: text("message").notNull().default(""),
    rawPayload: jsonb("raw_payload"),
    status: text("status", { enum: leadStatuses }).notNull().default("inquiry"),
    lostReason: text("lost_reason").notNull().default(""),
    firstRespondedAt: timestamptz("first_responded_at"),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    convertedClientId: uuid("converted_client_id").references(() => clients.id),
    convertedEventId: uuid("converted_event_id").references(() => events.id),
    // Set when this lead was merged into another (FLOW-110). The merged lead is
    // archived but kept, with its source record and raw payload.
    mergedIntoLeadId: uuid("merged_into_lead_id").references(
      (): AnyPgColumn => leads.id,
    ),
    mergedAt: timestamptz("merged_at"),
    mergedBy: uuid("merged_by"),
  },
  (table) => [
    index("leads_received_at_idx").on(table.receivedAt),
    index("leads_status_idx").on(table.status),
    index("leads_salesperson_idx").on(table.assignedSalespersonId),
    index("leads_source_idx").on(table.source, table.sourceLeadId),
    index("leads_email_idx").on(table.email),
    index("leads_email_lower_idx").on(sql`lower(${table.email})`),
    index("leads_phone_idx").on(table.phoneDigits),
    trigram("leads_name_trgm_idx", table.name),
    oneOf("leads_channel_check", table.channel, leadChannels),
    oneOf("leads_status_check", table.status, leadStatuses),
  ],
).enableRLS();
// Lead collector runs (FLOW-102): one row per site per run, posted by the collector.
// FLOW-107 builds collector health and alerts on these.
export const collectorRunStatuses = [
  "ok",
  "needs_login",
  "blocked",
  "error",
] as const;
export const collectorRuns = pgTable(
  "collector_runs",
  {
    ...baseColumns(),
    runId: uuid("run_id").notNull(),
    site: text("site").notNull(),
    startedAt: timestamptz("started_at").notNull(),
    finishedAt: timestamptz("finished_at").notNull(),
    leadsFound: integer("leads_found").notNull().default(0),
    status: text("status", { enum: collectorRunStatuses }).notNull(),
    message: text("message").notNull().default(""),
  },
  (table) => [
    uniqueIndex("collector_runs_run_site_idx").on(table.runId, table.site),
    index("collector_runs_site_started_idx").on(table.site, table.startedAt),
    oneOf("collector_runs_status_check", table.status, collectorRunStatuses),
  ],
).enableRLS();
export const collectorSites = pgTable(
  "collector_sites",
  {
    ...baseColumns(),
    site: text("site").notNull().unique(),
    noLeadsGapHours: integer("no_leads_gap_hours").notNull().default(48),
    failureThreshold: integer("failure_threshold").notNull().default(3),
    alertState: text("alert_state").notNull().default("ok"),
  },
).enableRLS();
// Possible duplicates (FLOW-110): a lead matched to an earlier lead, or to a client,
// by email or phone, or by name and event date. Open until someone merges the
// leads or dismisses the match.
export const leadDuplicateReasons = [
  "email",
  "phone",
  "name_event_date",
] as const;
export const leadDuplicateStatuses = ["open", "merged", "dismissed"] as const;
export const leadDuplicates = pgTable(
  "lead_duplicates",
  {
    ...baseColumns(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    matchedLeadId: uuid("matched_lead_id").references(() => leads.id),
    matchedClientId: uuid("matched_client_id").references(() => clients.id),
    reason: text("reason", { enum: leadDuplicateReasons }).notNull(),
    status: text("status", { enum: leadDuplicateStatuses })
      .notNull()
      .default("open"),
    resolvedAt: timestamptz("resolved_at"),
    resolvedBy: uuid("resolved_by"),
  },
  (table) => [
    index("lead_duplicates_lead_idx").on(table.leadId),
    index("lead_duplicates_matched_lead_idx").on(table.matchedLeadId),
    index("lead_duplicates_status_idx").on(table.status),
    uniqueIndex("lead_duplicates_lead_pair_idx")
      .on(table.leadId, table.matchedLeadId)
      .where(sql`${table.matchedLeadId} is not null`),
    uniqueIndex("lead_duplicates_client_pair_idx")
      .on(table.leadId, table.matchedClientId)
      .where(sql`${table.matchedClientId} is not null`),
    oneOf("lead_duplicates_reason_check", table.reason, leadDuplicateReasons),
    oneOf("lead_duplicates_status_check", table.status, leadDuplicateStatuses),
  ],
).enableRLS();
