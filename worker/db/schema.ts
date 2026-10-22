import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
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

// Core records (FLOW-53/54/55). People columns (assigned salesperson, Production
// Leads) hold user ids without a foreign key until the users table exists (FLOW-37).
export const clients = pgTable(
  "clients",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["person", "organization"] }).notNull(),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // Set when a salesperson created a client matching one they can't see.
    possibleDuplicateOfId: uuid("possible_duplicate_of_id").references(
      (): AnyPgColumn => clients.id,
    ),
  },
  (table) => [index("clients_salesperson_idx").on(table.assignedSalespersonId)],
).enableRLS();

export const clientContacts = pgTable(
  "client_contacts",
  {
    ...baseColumns(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    name: text("name").notNull(),
    role: text("role", {
      enum: ["primary_poc", "billing", "venue_manager", "event_coordinator"],
    }).notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    // Digits only, for duplicate matching.
    phoneDigits: text("phone_digits").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("client_contacts_client_idx").on(table.clientId),
    index("client_contacts_email_idx").on(table.email),
    index("client_contacts_phone_idx").on(table.phoneDigits),
  ],
).enableRLS();

export const venues = pgTable("venues", {
  ...baseColumns(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  // Stored for future tax use.
  jurisdiction: text("jurisdiction", { enum: ["DC", "MD", "VA"] }),
  loadInNotes: text("load_in_notes").notNull().default(""),
  parkingNotes: text("parking_notes").notNull().default(""),
}).enableRLS();

export const venueAreas = pgTable(
  "venue_areas",
  {
    ...baseColumns(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("venue_areas_venue_idx").on(table.venueId)],
).enableRLS();

export const venueContacts = pgTable(
  "venue_contacts",
  {
    ...baseColumns(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    role: text("role", { enum: ["manager", "coordinator"] }).notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("venue_contacts_venue_idx").on(table.venueId)],
).enableRLS();

export const events = pgTable(
  "events",
  {
    ...baseColumns(),
    title: text("title").notNull(),
    eventType: text("event_type").notNull().default(""),
    serviceType: text("service_type").notNull().default(""),
    foodServiceStyle: text("food_service_style").notNull().default(""),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at"),
    venueId: uuid("venue_id").references(() => venues.id),
    address: text("address").notNull().default(""),
    guestCount: integer("guest_count"),
    servingsCount: integer("servings_count"),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    pocContactId: uuid("poc_contact_id").references(() => clientContacts.id),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    productionLeadId: uuid("production_lead_id"),
    assistantLeadIds: jsonb("assistant_lead_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    dressCode: text("dress_code").notNull().default(""),
    transportationNotes: text("transportation_notes").notNull().default(""),
    internalNotes: text("internal_notes").notNull().default(""),
    status: text("status", {
      enum: ["tentative", "booked", "completed", "cancelled"],
    })
      .notNull()
      .default("tentative"),
    bookedAt: timestamptz("booked_at"),
  },
  (table) => [
    index("events_starts_at_idx").on(table.startsAt),
    index("events_client_idx").on(table.clientId),
    index("events_venue_idx").on(table.venueId),
    index("events_salesperson_idx").on(table.assignedSalespersonId),
  ],
).enableRLS();

// Areas used for this event's layouts: copied from the venue, or added per event.
export const eventAreas = pgTable(
  "event_areas",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("event_areas_event_idx").on(table.eventId)],
).enableRLS();

// Audit log (FLOW-41): one append-only row per create, update, archive or restore
// of a core record, written in the same transaction as the change. changes holds
// only the fields that changed, keyed by their API name. The API never updates or
// deletes these rows; created_by is the actor.
export const auditActions = ["create", "update", "archive", "restore"] as const;
export type AuditChanges = Record<string, { before: unknown; after: unknown }>;
export const auditLog = pgTable(
  "audit_log",
  {
    ...baseColumns(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action", { enum: auditActions }).notNull(),
    changes: jsonb("changes").$type<AuditChanges>().notNull(),
  },
  (table) => [
    index("audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
).enableRLS();

// Attachments (FLOW-42): file metadata linked to any record; the bytes live in R2.
// variants lists the stored objects: a photo's "thumb" and "display" sizes, or a
// document's "original".
export type AttachmentVariant = {
  name: "thumb" | "display" | "original";
  key: string;
  contentType: string;
  size: number;
};
export const attachments = pgTable(
  "attachments",
  {
    ...baseColumns(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    group: text("group").notNull().default(""),
    fileName: text("file_name").notNull(),
    caption: text("caption").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status", { enum: ["pending", "ready"] })
      .notNull()
      .default("pending"),
    variants: jsonb("variants").$type<AttachmentVariant[]>().notNull(),
  },
  (table) => [
    index("attachments_record_idx").on(table.recordType, table.recordId),
  ],
).enableRLS();
