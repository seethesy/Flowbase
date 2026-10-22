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
    status: text("status", {
      enum: ["inquiry", "tentative", "booked", "completed", "cancelled"],
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
    // Shelf position in the storage section; count mode lists items in this order
    // (FLOW-82).
    storageOrder: integer("storage_order"),
  },
).enableRLS();

// Bar stock fields (FLOW-90), one row per consumable of subtype bar. Category is
// the item's (Beer, Wine, Liquor); tier is the item's (rail, call, premium); size
// is the consumable's each size and pack size its pack count.
export const inventoryBarDetails = pgTable("inventory_bar_details", {
  ...baseColumns(),
  itemId: itemReference(),
  // Brand or varietal, e.g. Tito's or Pinot Grigio.
  brand: text("brand").notNull().default(""),
  // Wine and liquor only (barSubcategories in shared/inventory.ts).
  subcategory: text("subcategory").notNull().default(""),
  container: text("container", { enum: ["bottle", "can", "keg"] }),
}).enableRLS();

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
    source: text("source", { enum: ["manual", "receiving"] }).notNull(),
  },
  (table) => [index("inventory_cost_history_item_idx").on(table.itemId)],
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
  },
  (table) => [
    uniqueIndex("inventory_stock_item_section_idx").on(
      table.itemId,
      table.sectionId,
    ),
    index("inventory_stock_section_idx").on(table.sectionId),
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
    transferId: uuid("transfer_id"),
    correctsId: uuid("corrects_id").references(
      (): AnyPgColumn => stockMovements.id,
    ),
    // What the movement belongs to. No foreign key: orders and imports don't
    // exist yet (FLOW-86, FLOW-47).
    linkType: text("link_type", { enum: ["event", "order", "import"] }),
    linkId: uuid("link_id"),
  },
  (table) => [
    index("stock_movements_item_idx").on(table.itemId),
    index("stock_movements_corrects_idx").on(table.correctsId),
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
    status: text("status", { enum: ["open", "completed"] })
      .notNull()
      .default("open"),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    uniqueIndex("stock_counts_open_section_idx")
      .on(table.sectionId)
      .where(sql`${table.status} = 'open'`),
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
    recordType: text("record_type", {
      enum: ["lead", "client", "proposal", "event", "beo", "task"],
    }),
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
  ],
).enableRLS();
