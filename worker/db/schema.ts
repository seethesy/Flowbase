import { sql } from "drizzle-orm";
import {
  boolean,
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
} from "drizzle-orm/pg-core";
import { eventStatuses } from "../../shared/core-records";
import { baseColumns, moneyCents, timestamptz } from "./conventions";

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
    status: text("status", { enum: eventStatuses })
      .notNull()
      .default("inquiry"),
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
  (table) => [index("event_status_history_event_idx").on(table.eventId)],
).enableRLS();

// Leads (FLOW-100). One record for every source: collector, webhook, manual entry and
// import. assigned_salesperson_id is a plain uuid until the users table exists
// (FLOW-37). raw_payload is the source's data as received, for debugging (FT+ only).
export const leadChannels = ["collector", "webhook", "manual", "import"] as const;
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
  },
  (table) => [
    index("leads_received_at_idx").on(table.receivedAt),
    index("leads_status_idx").on(table.status),
    index("leads_salesperson_idx").on(table.assignedSalespersonId),
    index("leads_source_idx").on(table.source, table.sourceLeadId),
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

// Inventory (FLOW-69/70/81). Quantities can be fractional (2.5 lb), so they are
// numeric, read as numbers. Units are the codes in shared/units.ts.
const quantity = (name: string) =>
  numeric(name, { precision: 14, scale: 4, mode: "number" });

// Where stock lives (FLOW-70): rental sections (Warehouse, Jamie's, Cafe, Vendor)
// and consumable storage sections.
export const inventorySections = pgTable("inventory_sections", {
  ...baseColumns(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["rental", "consumable"] }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}).enableRLS();

// One row per thing Flowbase tracks or sells (FLOW-69). Kind-specific fields live
// in the *_details tables below, one row per item of that kind.
export const inventoryItems = pgTable(
  "inventory_items",
  {
    ...baseColumns(),
    kind: text("kind", { enum: ["rental", "consumable", "service"] }).notNull(),
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
    ratioBasis: text("ratio_basis", {
      enum: ["per_guest", "per_table", "per_event"],
    }),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    index("inventory_items_kind_idx").on(table.kind, table.subtype),
    uniqueIndex("inventory_items_code_idx")
      .on(table.code)
      .where(sql`${table.code} <> '' and ${table.archivedAt} is null`),
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
}).enableRLS();

export const inventoryServiceDetails = pgTable("inventory_service_details", {
  ...baseColumns(),
  itemId: itemReference(),
  priceCents: moneyCents("price_cents"),
  priceBasis: text("price_basis", {
    enum: ["per_guest", "per_table", "per_event"],
  })
    .notNull()
    .default("per_event"),
}).enableRLS();

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
  },
).enableRLS();

// Current quantity of an item in a section. Changed only together with a
// stock_movements row.
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
  },
  (table) => [
    uniqueIndex("inventory_stock_item_section_idx").on(
      table.itemId,
      table.sectionId,
    ),
    index("inventory_stock_section_idx").on(table.sectionId),
  ],
).enableRLS();

// Every stock change. Only transfers and counted adjustments so far; the stock
// ledger (FLOW-71) adds receipts, usage and the rest.
export const stockMovements = pgTable(
  "stock_movements",
  {
    ...baseColumns(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    type: text("type", { enum: ["transfer", "adjustment"] }).notNull(),
    // A transfer's amount, or an adjustment's signed change.
    quantity: quantity("quantity").notNull(),
    fromSectionId: uuid("from_section_id").references(
      () => inventorySections.id,
    ),
    toSectionId: uuid("to_section_id").references(() => inventorySections.id),
    note: text("note").notNull().default(""),
  },
  (table) => [index("stock_movements_item_idx").on(table.itemId)],
).enableRLS();
