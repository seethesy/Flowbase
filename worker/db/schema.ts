import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type ExtraConfigColumn,
} from "drizzle-orm/pg-core";
import { eventStatuses } from "../../shared/core-records";
import { roles, employmentTypes } from "../../shared/access";
import { userStatuses } from "../../shared/users";
import { recipeCategories } from "../../shared/recipes";
import { listKeys, settingKeys } from "../../shared/settings";
import type { z } from "zod";
import type { includedItemSchema } from "../../shared/inventory";
import { importStatuses } from "../../shared/imports";
import { baseColumns, moneyCents, oneOf, timestamptz } from "./conventions";

// Values of enum-like text columns that have no shared name elsewhere; each
// column also gets a oneOf() CHECK constraint (FLOW-187).
const clientKinds = ["person", "organization"] as const;
const clientContactRoles = [
  "primary_poc",
  "billing",
  "venue_manager",
  "event_coordinator",
] as const;
const jurisdictions = ["DC", "MD", "VA"] as const;
const venueContactRoles = ["manager", "coordinator"] as const;
const attachmentStatuses = ["pending", "ready"] as const;
const sectionKinds = ["rental", "consumable"] as const;
const itemKinds = ["rental", "consumable", "service"] as const;
const containers = ["bottle", "can", "keg"] as const;
const costSources = ["manual", "receiving"] as const;
const linkTypes = ["event", "order", "import"] as const;
const countStatuses = ["open", "completed"] as const;
const activityRecordTypes = ["lead", "client", "proposal", "event", "beo", "task"] as const;
const priceBases = ["per_guest", "per_table", "per_event"] as const;

// Every table: spread baseColumns() and finish with .enableRLS() (see conventions.ts).
// CI fails if a migrated table in the public schema lacks RLS.

// Allowlist and durable staff identity. Never delete on deactivation: assignments
// and audit entries continue to refer to this id and stored Google display name.
export const users = pgTable(
  "users",
  {
    ...baseColumns(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    authId: uuid("auth_id").unique(),
    role: text("role", { enum: roles }).notNull(),
    employmentType: text("employment_type", {
      enum: employmentTypes,
    }).notNull(),
    mobile: text("mobile").notNull(),
    status: text("status", { enum: userStatuses }).notNull().default("pending"),
    invitedAt: timestamptz("invited_at").notNull().defaultNow(),
    activatedAt: timestamptz("activated_at"),
    // Staff directory (FLOW-40): Admin's notes, the positions this person can work
    // (staff_position list labels) and when they opted in to SMS (null: not opted in).
    notes: text("notes").notNull().default(""),
    positions: jsonb("positions").$type<string[]>().notNull().default([]),
    smsConsentAt: timestamptz("sms_consent_at"),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(sql`lower(${table.email})`),
    oneOf("users_role_check", table.role, roles),
    oneOf("users_employment_type_check", table.employmentType, employmentTypes),
    oneOf("users_status_check", table.status, userStatuses),
  ],
).enableRLS();

// Business settings (FLOW-45): one row per settings group (company profile,
// defaults), its value validated by shared/settings.ts. A missing row means the
// built-in defaults.
export const settings = pgTable(
  "settings",
  {
    ...baseColumns(),
    key: text("key", { enum: settingKeys }).notNull().unique(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [oneOf("settings_key_check", table.key, settingKeys)],
).enableRLS();

// Configurable lists (FLOW-45): event types, positions, vehicles, categories...
// Archived values stay on old records and are not offered for new ones. Labels are
// unique per list among active values.
export const listValues = pgTable(
  "list_values",
  {
    ...baseColumns(),
    listKey: text("list_key", { enum: listKeys }).notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("list_values_list_idx").on(table.listKey, table.sortOrder),
    uniqueIndex("list_values_label_idx")
      .on(table.listKey, sql`lower(${table.label})`)
      .where(sql`${table.archivedAt} is null`),
    oneOf("list_values_list_key_check", table.listKey, listKeys),
  ],
).enableRLS();

// Trigram index for global search (FLOW-46): fuzzy name matching with pg_trgm.
const trigram = (name: string, column: ExtraConfigColumn) =>
  index(name).using("gin", column.op("gin_trgm_ops"));

// Proves reads and writes through Hyperdrive. Served only where DB_CHECK_ROUTE is
// enabled (the dev environment); holds no business data.
export const connectionChecks = pgTable("connection_checks", {
  ...baseColumns(),
  note: text("note").notNull(),
}).enableRLS();

// Outbox and work queue (FLOW-27). Domain events and background work are rows here,
// written in the same transaction as the change they describe, and run by the cron.
export const jobStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
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
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
    oneOf("jobs_status_check", table.status, jobStatuses),
  ],
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
// Leads) retain stable staff ids, including assignments made before sign-in shipped.
export const clients = pgTable(
  "clients",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    kind: text("kind", { enum: clientKinds }).notNull(),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // Set when a salesperson created a client matching one they can't see.
    possibleDuplicateOfId: uuid("possible_duplicate_of_id").references(
      (): AnyPgColumn => clients.id,
    ),
  },
  (table) => [
    index("clients_salesperson_idx").on(table.assignedSalespersonId),
    trigram("clients_name_trgm_idx", table.name),
    oneOf("clients_kind_check", table.kind, clientKinds),
  ],
).enableRLS();

export const clientContacts = pgTable(
  "client_contacts",
  {
    ...baseColumns(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    name: text("name").notNull(),
    role: text("role", { enum: clientContactRoles }).notNull(),
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
    trigram("client_contacts_name_trgm_idx", table.name),
    oneOf("client_contacts_role_check", table.role, clientContactRoles),
  ],
).enableRLS();

export const venues = pgTable(
  "venues",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    // Stored for future tax use.
    jurisdiction: text("jurisdiction", { enum: jurisdictions }),
    loadInNotes: text("load_in_notes").notNull().default(""),
    parkingNotes: text("parking_notes").notNull().default(""),
  },
  (table) => [
    trigram("venues_name_trgm_idx", table.name),
    oneOf("venues_jurisdiction_check", table.jurisdiction, jurisdictions),
  ],
).enableRLS();

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
    role: text("role", { enum: venueContactRoles }).notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("venue_contacts_venue_idx").on(table.venueId),
    oneOf("venue_contacts_role_check", table.role, venueContactRoles),
  ],
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
    status: text("status", { enum: eventStatuses })
      .notNull()
      .default("inquiry"),
    // When the client signed the event's first DocuSign contract (FLOW-4). Set only
    // by recording that contract, never by a status change.
    bookedAt: timestamptz("booked_at"),
  },
  (table) => [
    index("events_starts_at_idx").on(table.startsAt),
    index("events_client_idx").on(table.clientId),
    index("events_venue_idx").on(table.venueId),
    index("events_salesperson_idx").on(table.assignedSalespersonId),
    trigram("events_title_trgm_idx", table.title),
    oneOf("events_status_check", table.status, eventStatuses),
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
    oneOf("audit_log_action_check", table.action, auditActions),
  ],
).enableRLS();

// Data imports (FLOW-47): one log row per import run of a module importer: who
// (created_by), when (created_at), the file and the row counts. Stock movements
// that set imported starting quantities link here (link_type "import").
export const importLogs = pgTable(
  "import_logs",
  {
    ...baseColumns(),
    module: text("module").notNull(),
    fileName: text("file_name").notNull(),
    status: text("status", { enum: importStatuses })
      .notNull()
      .default("running"),
    rowCount: integer("row_count").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    index("import_logs_module_idx").on(table.module, table.createdAt),
    oneOf("import_logs_status_check", table.status, importStatuses),
  ],
).enableRLS();

// The record each external key imported to, per module (FLOW-47 AC1): a re-run
// updates that record instead of creating another. record_id has no foreign key
// because each module imports into its own table.
export const importKeys = pgTable(
  "import_keys",
  {
    ...baseColumns(),
    module: text("module").notNull(),
    externalKey: text("external_key").notNull(),
    recordId: uuid("record_id").notNull(),
    // The import that last wrote the record.
    importId: uuid("import_id")
      .notNull()
      .references(() => importLogs.id),
  },
  (table) => [
    uniqueIndex("import_keys_module_key_idx").on(table.module, table.externalKey),
  ],
).enableRLS();

// Status history (FLOW-56): one row per status change of an event: who
// (created_by; null for the system), when (created_at), from and to, and why.
export const eventStatusHistory = pgTable(
  "event_status_history",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    // null for the status the event was created with.
    fromStatus: text("from_status", { enum: eventStatuses }),
    toStatus: text("to_status", { enum: eventStatuses }).notNull(),
    reason: text("reason").notNull().default(""),
    // false when the system moved the event along the forward chain.
    manual: boolean("manual").notNull().default(true),
  },
  (table) => [
    index("event_status_history_event_idx").on(table.eventId),
    oneOf("event_status_history_from_status_check", table.fromStatus, eventStatuses),
    oneOf("event_status_history_to_status_check", table.toStatus, eventStatuses),
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
export const leadStatuses = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "lost",
] as const;
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
    budgetCents: moneyCents("budget_cents"),
    message: text("message").notNull().default(""),
    rawPayload: jsonb("raw_payload"),
    status: text("status", { enum: leadStatuses }).notNull().default("new"),
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
    status: text("status", { enum: attachmentStatuses })
      .notNull()
      .default("pending"),
    variants: jsonb("variants").$type<AttachmentVariant[]>().notNull(),
  },
  (table) => [
    index("attachments_record_idx").on(table.recordType, table.recordId),
    oneOf("attachments_status_check", table.status, attachmentStatuses),
  ],
).enableRLS();

// Inventory (FLOW-69/70/81). Quantities can be fractional (2.5 lb), so they are
// numeric, read as numbers. Units are the codes in shared/units.ts.
const quantity = (name: string) =>
  numeric(name, { precision: 14, scale: 4, mode: "number" });

// Where stock lives (FLOW-70): rental sections (Warehouse, Jamie's, Cafe, Vendor)
// and consumable storage sections.
export const inventorySections = pgTable(
  "inventory_sections",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    kind: text("kind", { enum: sectionKinds }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [oneOf("inventory_sections_kind_check", table.kind, sectionKinds)],
).enableRLS();

// One row per thing Flowbase tracks or sells (FLOW-69). Kind-specific fields live
// in the *_details tables below, one row per item of that kind.
export const inventoryItems = pgTable(
  "inventory_items",
  {
    ...baseColumns(),
    kind: text("kind", { enum: itemKinds }).notNull(),
    // Rental: equipment, furniture, linen, tableware, glassware, bar, decor.
    // Consumable: ingredient, bar, supply. Services have none.
    subtype: text("subtype"),
    code: text("code").notNull().default(""),
    name: text("name").notNull(),
    category: text("category").notNull().default(""),
    description: text("description").notNull().default(""),
    unit: text("unit").notNull().default("each"),
    group: text("group").notNull().default(""),
    color: text("color").notNull().default(""),
    tier: text("tier").notNull().default(""),
    ratioQuantity: quantity("ratio_quantity"),
    ratioBasis: text("ratio_basis", { enum: priceBases }),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("inventory_items_kind_idx").on(table.kind, table.subtype),
    uniqueIndex("inventory_items_code_idx")
      .on(table.code)
      .where(sql`${table.code} <> '' and ${table.archivedAt} is null`),
    trigram("inventory_items_name_trgm_idx", table.name),
    oneOf("inventory_items_kind_check", table.kind, itemKinds),
    oneOf("inventory_items_ratio_basis_check", table.ratioBasis, priceBases),
  ],
).enableRLS();

const itemReference = () =>
  uuid("item_id")
    .notNull()
    .unique()
    .references(() => inventoryItems.id);

export const inventoryRentalDetails = pgTable("inventory_rental_details", {
  ...baseColumns(),
  itemId: itemReference(),
  priceCents: moneyCents("price_cents"),
  internalCostCents: moneyCents("internal_cost_cents"),
  replacementCostCents: moneyCents("replacement_cost_cents"),
  dimensions: text("dimensions").notNull().default(""),
  colors: jsonb("colors").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  assemblyNotes: text("assembly_notes").notNull().default(""),
  bufferDaysBefore: integer("buffer_days_before").notNull().default(1),
  bufferDaysAfter: integer("buffer_days_after").notNull().default(1),
  components: jsonb("components")
    .$type<{ itemId: string; quantity: number }[]>()
    .notNull()
    .default([]),
}).enableRLS();

export const inventoryServiceDetails = pgTable(
  "inventory_service_details",
  {
    ...baseColumns(),
    itemId: itemReference(),
    priceCents: moneyCents("price_cents"),
    priceBasis: text("price_basis", { enum: priceBases })
      .notNull()
      .default("per_event"),
    pricedByQuote: boolean("priced_by_quote").notNull().default(false),
    includes: jsonb("includes")
      .$type<z.infer<typeof includedItemSchema>[]>()
      .notNull()
      .default([]),
    addons: jsonb("addons")
      .$type<{ name: string; priceCents: number }[]>()
      .notNull()
      .default([]),
  },
  (table) => [
    oneOf(
      "inventory_service_details_price_basis_check",
      table.priceBasis,
      priceBases,
    ),
  ],
).enableRLS();

export const inventoryConsumableDetails = pgTable(
  "inventory_consumable_details",
  {
    ...baseColumns(),
    itemId: itemReference(),
    purchaseUnit: text("purchase_unit").notNull(),
    packCount: integer("pack_count"),
    eachSizeQuantity: quantity("each_size_quantity"),
    eachSizeUnit: text("each_size_unit"),
    recipeUnit: text("recipe_unit"),
    // Cost of one purchase unit; FT+ only (F-01-04).
    unitCostCents: moneyCents("unit_cost_cents"),
    preferredVendor: text("preferred_vendor").notNull().default(""),
    parLevel: quantity("par_level"),
    allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
    storageSectionId: uuid("storage_section_id").references(
      () => inventorySections.id,
    ),
    // Shelf position in the storage section; count mode lists items in this order
    // (FLOW-82).
    storageOrder: integer("storage_order"),
  },
).enableRLS();

// Bar stock fields (FLOW-90), one row per consumable of subtype bar. Category is
// the item's (Beer, Wine, Liquor); tier is the item's (rail, call, premium); size
// is the consumable's each size and pack size its pack count.
export const inventoryBarDetails = pgTable(
  "inventory_bar_details",
  {
    ...baseColumns(),
    itemId: itemReference(),
    // Brand or varietal, e.g. Tito's or Pinot Grigio.
    brand: text("brand").notNull().default(""),
    // Wine and liquor only (barSubcategories in shared/inventory.ts).
    subcategory: text("subcategory").notNull().default(""),
    container: text("container", { enum: containers }),
  },
  (table) => [oneOf("inventory_bar_details_container_check", table.container, containers)],
).enableRLS();

// Every unit-cost change of a consumable (FLOW-83): by hand from the item, or from
// receiving (FLOW-88).
export const inventoryCostHistory = pgTable(
  "inventory_cost_history",
  {
    ...baseColumns(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    previousCents: moneyCents("previous_cents"),
    unitCostCents: moneyCents("unit_cost_cents"),
    source: text("source", { enum: costSources }).notNull(),
  },
  (table) => [
    index("inventory_cost_history_item_idx").on(table.itemId),
    oneOf("inventory_cost_history_source_check", table.source, costSources),
  ],
).enableRLS();

// Current quantity of an item in a section: a cache of the sum of its
// stock_movements, written in the same transaction as each movement (FLOW-71).
export const inventoryStock = pgTable(
  "inventory_stock",
  {
    ...baseColumns(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => inventorySections.id),
    quantity: quantity("quantity").notNull().default(0),
    color: text("color").notNull().default(""),
  },
  (table) => [
    uniqueIndex("inventory_stock_item_section_idx").on(
      table.itemId,
      table.sectionId,
      table.color,
    ),
    index("inventory_stock_section_idx").on(table.sectionId),
    // Stock never goes below zero (FLOW-187); the code checks first, this is the
    // backstop.
    check("inventory_stock_quantity_check", sql`${table.quantity} >= 0`),
  ],
).enableRLS();

export const movementTypes = [
  "receive",
  "adjust",
  "count",
  "transfer",
  "pull",
  "return",
  "damage_loss",
  "consume",
] as const;

// The stock ledger (FLOW-71): one row per change to one item in one section, with
// a signed quantity. Append-only (a trigger rejects updates and deletes); a
// correction is a new row pointing at the one it corrects. A transfer is two rows
// sharing a transfer_id.
export const stockMovements = pgTable(
  "stock_movements",
  {
    ...baseColumns(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => inventorySections.id),
    type: text("type", { enum: movementTypes }).notNull(),
    quantity: quantity("quantity").notNull(),
    reason: text("reason").notNull().default(""),
    color: text("color").notNull().default(""),
    transferId: uuid("transfer_id"),
    correctsId: uuid("corrects_id").references(
      (): AnyPgColumn => stockMovements.id,
    ),
    // What the movement belongs to: an event, an order or an import_logs row. No
    // foreign key, since it points at a different table per type (orders: FLOW-86).
    linkType: text("link_type", { enum: linkTypes }),
    linkId: uuid("link_id"),
  },
  (table) => [
    index("stock_movements_item_idx").on(table.itemId),
    index("stock_movements_corrects_idx").on(table.correctsId),
    oneOf("stock_movements_type_check", table.type, movementTypes),
    oneOf("stock_movements_link_type_check", table.linkType, linkTypes),
  ],
).enableRLS();

// Count mode (FLOW-82): one count of one storage section, saved line by line so it
// can be resumed. At most one open count per section.
export const stockCounts = pgTable(
  "stock_counts",
  {
    ...baseColumns(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => inventorySections.id),
    status: text("status", { enum: countStatuses })
      .notNull()
      .default("open"),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    uniqueIndex("stock_counts_open_section_idx")
      .on(table.sectionId)
      .where(sql`${table.status} = 'open'`),
    oneOf("stock_counts_status_check", table.status, countStatuses),
  ],
).enableRLS();

// The latest counted quantity of an item in a count, and the count movement it
// wrote.
export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    ...baseColumns(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: quantity("quantity").notNull(),
    reason: text("reason").notNull().default(""),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => stockMovements.id),
  },
  (table) => [
    uniqueIndex("stock_count_lines_item_idx").on(table.countId, table.itemId),
  ],
).enableRLS();

// Recipe book (FLOW-93): one row per dish. Yield is optional (a dish with no
// yield can't be scaled, FLOW-98). Allergens and dietary tags are set on the
// dish, not on its ingredients (FLOW-95). Steps are the numbered method lines, in
// order.
export const recipes = pgTable(
  "recipes",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    category: text("category", { enum: recipeCategories }).notNull(),
    description: text("description").notNull().default(""),
    steps: jsonb("steps").$type<string[]>().notNull().default([]),
    finishingNote: text("finishing_note").notNull().default(""),
    yieldServings: quantity("yield_servings"),
    portionSize: text("portion_size").notNull().default(""),
    allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
    dietaryTags: jsonb("dietary_tags").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("recipes_name_idx").on(table.category, sql`lower(${table.name})`),
    oneOf("recipes_category_check", table.category, recipeCategories),
  ],
).enableRLS();

// One ingredient line of a recipe (FLOW-93). Quantity and unit are optional
// ("Italian Seasoning"). entered_cost_cents is the typed line cost, used when the
// cost can't be calculated from the ingredient (FLOW-94); FT+ only.
export const recipeLines = pgTable(
  "recipe_lines",
  {
    ...baseColumns(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    quantity: quantity("quantity"),
    unit: text("unit"),
    prepNote: text("prep_note").notNull().default(""),
    enteredCostCents: moneyCents("entered_cost_cents"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("recipe_lines_recipe_idx").on(table.recipeId),
    index("recipe_lines_item_idx").on(table.itemId),
  ],
).enableRLS();

// Automatic activity time tracking (FLOW-119): one row per stretch of active time on
// one screen. The browser picks client_session_id and resends an open session with a
// later end, so (user_id, client_session_id) is unique. user_id has no foreign key
// until the users table exists (FLOW-37).
export const activitySessions = pgTable(
  "activity_sessions",
  {
    ...baseColumns(),
    userId: uuid("user_id").notNull(),
    clientSessionId: uuid("client_session_id").notNull(),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at").notNull(),
    recordType: text("record_type", { enum: activityRecordTypes }),
    recordId: uuid("record_id"),
    activity: text("activity").notNull(),
  },
  (table) => [
    uniqueIndex("activity_sessions_client_session_idx").on(
      table.userId,
      table.clientSessionId,
    ),
    index("activity_sessions_started_idx").on(table.startedAt),
    index("activity_sessions_record_idx").on(table.recordType, table.recordId),
    oneOf("activity_sessions_record_type_check", table.recordType, activityRecordTypes),
  ],
).enableRLS();
