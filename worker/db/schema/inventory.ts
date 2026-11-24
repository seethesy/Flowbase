// Vendors, the three inventory tables and their details, stock, counts, orders, reservations and allocations.
import { getViewSelectedFields, sql, type SQL } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, pgView, text, uniqueIndex, uuid, type AnyPgColumn, type ExtraConfigColumn } from "drizzle-orm/pg-core";
import { roles } from "../../../shared/access";
import { type z } from "zod";
import { pullOwners, type includedItemSchema } from "../../../shared/inventory";
import { vendorTypes } from "../../../shared/vendors";
import { approvalStatuses, type ProposedChange } from "../../../shared/approvals";
import { requirementBases } from "../../../shared/allocation";
import { orderListStatuses, vendorOrderStatuses, type OrderLine, type VendorOrderLine, type VendorOrderReceipt } from "../../../shared/order-lists";
import { conflictStates, holdStatuses, issueKinds, type ConflictResolution } from "../../../shared/reservations";
import { baseColumns, moneyCents, oneOf, timestamptz } from "../conventions";
import { anyItemReference, quantity, trigram } from "./common";
import { events } from "./events";

const locationKinds = ["location", "storage"] as const;
const itemKinds = ["rental", "consumable", "service"] as const;
const containers = ["bottle", "can", "keg"] as const;
const costSources = ["manual", "receiving"] as const;
const linkTypes = ["event", "order", "import"] as const;
const countStatuses = ["open", "completed"] as const;
const priceBases = ["per_guest", "per_table", "per_event"] as const;
// Vendor and distributor directory (FLOW-84). There is no password column:
// Flowbase never stores portal passwords. Contacts and the account number are
// FT+ only (shared/visibility.ts).
export const vendors = pgTable(
  "vendors",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    type: text("type", { enum: vendorTypes }).notNull(),
    portalUrl: text("portal_url").notNull().default(""),
    accountNumber: text("account_number").notNull().default(""),
    orderCutoff: text("order_cutoff").notNull().default(""),
    deliveryDays: jsonb("delivery_days").$type<string[]>().notNull().default([]),
    minimumOrderCents: moneyCents("minimum_order_cents"),
    leadTimeDays: integer("lead_time_days"),
    orderingInstructions: text("ordering_instructions").notNull().default(""),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    // One live vendor per name, so imports find "Imperio" instead of adding it twice.
    uniqueIndex("vendors_name_idx")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    trigram("vendors_name_trgm_idx", table.name),
    oneOf("vendors_type_check", table.type, vendorTypes),
  ],
).enableRLS();
export const vendorContacts = pgTable(
  "vendor_contacts",
  {
    ...baseColumns(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    name: text("name").notNull(),
    role: text("role").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("vendor_contacts_vendor_idx").on(table.vendorId)],
).enableRLS();
// Where stock lives (FLOW-289; replaced the FLOW-70 sections). Locations hold
// Master and Bar stock: an Admin-editable list seeded with Warehouse, Storage Box,
// Jamie's three floors, Cozy Cafe and Vendor. Kitchen ingredients keep their own
// storage list (Fridge, Freezer, Pantry), kind "storage". Code still calls a
// location a section (sectionId) where the API shape predates FLOW-289.
export const inventoryLocations = pgTable(
  "inventory_locations",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    kind: text("kind", { enum: locationKinds }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [oneOf("inventory_locations_kind_check", table.kind, locationKinds)],
).enableRLS();
// FLOW-262: configurable classification, separate from the legacy free-text
// category used by imported Bar sheets and ratio defaults.
export const inventoryCategories = pgTable("inventory_categories", {
  ...baseColumns(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("inventory_categories_kind_name_idx").on(table.kind, sql`lower(${table.name})`).where(sql`${table.archivedAt} is null`),
]).enableRLS();
export const inventoryTypes = pgTable("inventory_types", {
  ...baseColumns(),
  categoryId: uuid("category_id").notNull().references(() => inventoryCategories.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("inventory_types_category_name_idx").on(table.categoryId, sql`lower(${table.name})`).where(sql`${table.archivedAt} is null`),
]).enableRLS();
// The three inventory lists (FLOW-289), one table each, sharing the item columns
// of the FLOW-69 model so the all_inventory_items view can read them as one:
// - Master Inventory: rentals, services and supplies (consumable/supply). Every
//   one is shown as "Rental"; kind is its internal stock tracking (returned after
//   events, used up at events, not stocked).
// - Bar Inventory: drinks (consumable/bar).
// - Kitchen Ingredients: consumable/ingredient, shown only under Kitchen.
// A CHECK on each table keeps an item in its own list (FLOW-289 AC2).
// Kind-specific fields live in the *_details tables below.
const itemColumns = () => ({
  ...baseColumns(),
  kind: text("kind", { enum: itemKinds }).notNull(),
  // Rental: equipment, furniture, linen, tableware, glassware, bar, decor.
  // Consumable: ingredient, bar, supply. Services have none.
  subtype: text("subtype"),
  code: text("code").notNull().default(""),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  categoryId: uuid("category_id").references(() => inventoryCategories.id),
  typeId: uuid("type_id").references(() => inventoryTypes.id),
  description: text("description").notNull().default(""),
  unit: text("unit").notNull().default("each"),
  group: text("group").notNull().default(""),
  // Source-sheet second level, who pulls it by default, and the follow-ups an
  // import left on it (FLOW-165).
  subcategory: text("subcategory").notNull().default(""),
  pullOwner: text("pull_owner", { enum: pullOwners }),
  flags: jsonb("flags").$type<string[]>().notNull().default([]),
  color: text("color").notNull().default(""),
  tier: text("tier").notNull().default(""),
  ratioQuantity: quantity("ratio_quantity"),
  ratioBasis: text("ratio_basis", { enum: priceBases }),
  active: boolean("active").notNull().default(true),
});
type ItemTableColumns = {
  kind: ExtraConfigColumn; subtype: ExtraConfigColumn; code: ExtraConfigColumn;
  name: ExtraConfigColumn; archivedAt: ExtraConfigColumn; ratioBasis: ExtraConfigColumn;
  pullOwner: ExtraConfigColumn;
};
const itemTableConfig = (prefix: string, list: SQL) => (table: ItemTableColumns) => [
  index(`${prefix}_kind_idx`).on(table.kind, table.subtype),
  uniqueIndex(`${prefix}_code_idx`)
    .on(table.code)
    .where(sql`${table.code} <> '' and ${table.archivedAt} is null`),
  trigram(`${prefix}_name_trgm_idx`, table.name),
  oneOf(`${prefix}_kind_check`, table.kind, itemKinds),
  oneOf(`${prefix}_ratio_basis_check`, table.ratioBasis, priceBases),
  oneOf(`${prefix}_pull_owner_check`, table.pullOwner, pullOwners),
  check(`${prefix}_list_check`, list),
];
export const masterInventoryItems = pgTable(
  "master_inventory_items",
  itemColumns(),
  itemTableConfig(
    "master_inventory_items",
    sql`kind <> 'consumable' or subtype = 'supply'`,
  ),
).enableRLS();
export const barInventoryItems = pgTable(
  "bar_inventory_items",
  itemColumns(),
  itemTableConfig(
    "bar_inventory_items",
    sql`kind = 'consumable' and subtype = 'bar'`,
  ),
).enableRLS();
export const kitchenIngredients = pgTable(
  "kitchen_ingredients",
  itemColumns(),
  itemTableConfig(
    "kitchen_ingredients",
    sql`kind = 'consumable' and subtype = 'ingredient'`,
  ),
).enableRLS();
// Every item of the three lists, read-only (FLOW-289). Reads that don't care
// which list an item is in (an item's page, the ledger, counts, search) use it;
// writes go to the list's own table (worker/records/inventory-lists.ts).
export const allInventoryItems = pgView("all_inventory_items", itemColumns())
  .with({ securityInvoker: true })
  .as(
    sql`select * from ${masterInventoryItems} union all select * from ${barInventoryItems} union all select * from ${kitchenIngredients}`,
  );
// The view's columns, for a select that nests an item: `{ item: allInventoryItemFields }`.
export const allInventoryItemFields = getViewSelectedFields(allInventoryItems);
const itemReference = (table: () => AnyPgColumn) =>
  uuid("item_id").notNull().unique().references(table);
export const inventoryRentalDetails = pgTable("inventory_rental_details", {
  ...baseColumns(),
  itemId: itemReference(() => masterInventoryItems.id),
  priceCents: moneyCents("price_cents"),
  internalCostCents: moneyCents("internal_cost_cents"),
  replacementCostCents: moneyCents("replacement_cost_cents"),
  dimensions: text("dimensions").notNull().default(""),
  colors: jsonb("colors").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  assemblyNotes: text("assembly_notes").notNull().default(""),
  bufferDaysBefore: integer("buffer_days_before").notNull().default(1),
  bufferDaysAfter: integer("buffer_days_after").notNull().default(1),
  // Sub-rental (FLOW-75): the vendor it's rented from, what they charge for one,
  // and the notice they need.
  vendorId: uuid("vendor_id").references(() => vendors.id),
  vendorCostCents: moneyCents("vendor_cost_cents"),
  leadTimeDays: integer("lead_time_days"),
  // Where an owned item is bought from (FLOW-165); not a sub-rental.
  supplierId: uuid("supplier_id").references(() => vendors.id),
  components: jsonb("components")
    .$type<{ itemId: string; quantity: number }[]>()
    .notNull()
    .default([]),
}).enableRLS();
export const inventoryServiceDetails = pgTable(
  "inventory_service_details",
  {
    ...baseColumns(),
    itemId: itemReference(() => masterInventoryItems.id),
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
    // A supply, a drink or an ingredient: any list's item.
    itemId: anyItemReference().unique(),
    purchaseUnit: text("purchase_unit").notNull(),
    packCount: integer("pack_count"),
    eachSizeQuantity: quantity("each_size_quantity"),
    eachSizeUnit: text("each_size_unit"),
    recipeUnit: text("recipe_unit"),
    // Cost of one purchase unit; FT+ only (F-01-04).
    unitCostCents: moneyCents("unit_cost_cents"),
    preferredVendor: text("preferred_vendor").notNull().default(""),
    // The directory vendor (FLOW-84); preferredVendor then holds its name.
    preferredVendorId: uuid("preferred_vendor_id").references(() => vendors.id),
    parLevel: quantity("par_level"),
    allergens: jsonb("allergens").$type<string[]>().notNull().default([]),
    storageSectionId: uuid("storage_section_id").references(
      () => inventoryLocations.id,
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
    itemId: itemReference(() => barInventoryItems.id),
    // Brand or varietal, e.g. Tito's or Pinot Grigio.
    brand: text("brand").notNull().default(""),
    // Wine and liquor only (barSubcategories in shared/inventory.ts).
    subcategory: text("subcategory").notNull().default(""),
    container: text("container", { enum: containers }),
    // Reordered when its tier runs short (FLOW-170).
    housePick: boolean("house_pick").notNull().default(false),
  },
  (table) => [oneOf("inventory_bar_details_container_check", table.container, containers)],
).enableRLS();
// Every unit-cost change of a consumable (FLOW-83): by hand from the item, or from
// receiving (FLOW-88).
export const inventoryCostHistory = pgTable(
  "inventory_cost_history",
  {
    ...baseColumns(),
    itemId: anyItemReference(),
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
    itemId: anyItemReference(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => inventoryLocations.id),
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
    itemId: anyItemReference(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => inventoryLocations.id),
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
      .references(() => inventoryLocations.id),
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
    itemId: anyItemReference(),
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
// Approval requests (FLOW-44): one table for every module's approvals. The
// subject type is the requesting module's own name, registered with the engine
// in worker/records/inventory/approvals.ts, so it has no CHECK list here.
export const approvalRequests = pgTable(
  "approval_requests",
  {
    ...baseColumns(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    summary: text("summary").notNull(),
    link: text("link"),
    // Field -> { from, to }; null when the request approves the subject itself.
    proposedChange: jsonb("proposed_change").$type<ProposedChange>(),
    requesterId: uuid("requester_id"),
    approverRole: text("approver_role", { enum: roles }).notNull(),
    status: text("status", { enum: approvalStatuses })
      .notNull()
      .default("pending"),
    comment: text("comment").notNull().default(""),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamptz("decided_at"),
  },
  (table) => [
    index("approval_requests_queue_idx").on(
      table.status,
      table.approverRole,
      table.createdAt,
    ),
    index("approval_requests_subject_idx").on(table.subjectType, table.subjectId),
    index("approval_requests_requester_idx").on(table.requesterId, table.createdAt),
    oneOf("approval_requests_approver_role_check", table.approverRole, roles),
    oneOf("approval_requests_status_check", table.status, approvalStatuses),
  ],
).enableRLS();
export const orderLists = pgTable(
  "order_lists",
  {
    ...baseColumns(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    status: text("status", { enum: orderListStatuses })
      .notNull().default("draft"),
    lines: jsonb("lines").$type<OrderLine[]>().notNull().default([]),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    // List-level notes, edited inline on the Purchasing tab (FLOW-300).
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    index("order_lists_status_idx").on(table.status, table.createdAt),
    oneOf("order_lists_status_check", table.status, orderListStatuses),
  ],
).enableRLS();
// One vendor's order from an approved order list (FLOW-87): placed by hand on the
// vendor's portal, then recorded here so projected stock counts it from the
// expected delivery date. Receiving (FLOW-88) adds to each line's received
// quantity and appends the delivery to receipts. At most one order per vendor
// that isn't cancelled.
export const vendorOrders = pgTable(
  "vendor_orders",
  {
    ...baseColumns(),
    orderListId: uuid("order_list_id").notNull().references(() => orderLists.id),
    vendorId: uuid("vendor_id").references(() => vendors.id),
    // The list's vendor group; "Unassigned vendor" when the items had none.
    vendorName: text("vendor_name").notNull(),
    status: text("status", { enum: vendorOrderStatuses }).notNull().default("ordered"),
    portalOrderNumber: text("portal_order_number").notNull(),
    orderedOn: date("ordered_on", { mode: "string" }).notNull(),
    expectedDelivery: date("expected_delivery", { mode: "string" }).notNull(),
    totalCents: moneyCents("total_cents"),
    notes: text("notes").notNull().default(""),
    lines: jsonb("lines").$type<VendorOrderLine[]>().notNull().default([]),
    receipts: jsonb("receipts").$type<VendorOrderReceipt[]>().notNull().default([]),
  },
  (table) => [
    index("vendor_orders_list_idx").on(table.orderListId),
    index("vendor_orders_open_idx").on(table.status),
    uniqueIndex("vendor_orders_active_vendor_idx").on(table.orderListId, table.vendorName)
      .where(sql`${table.status} <> 'cancelled'`),
    oneOf("vendor_orders_status_check", table.status, vendorOrderStatuses),
  ],
).enableRLS();
// Reservations (FLOW-76): a hold on a rental item for an event over a window of
// New York calendar dates. Status follows the event (shared/reservations.ts).
export const reservations = pgTable(
  "reservations",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => masterInventoryItems.id),
    quantity: quantity("quantity").notNull(),
    status: text("status", { enum: holdStatuses }).notNull().default("tentative"),
    windowStart: date("window_start", { mode: "string" }).notNull(),
    windowEnd: date("window_end", { mode: "string" }).notNull(),
    // A kit's hold holds each of its rental parts in a hold of its own that points
    // back to it (FLOW-212); the parts follow the kit's hold and aren't edited.
    kitReservationId: uuid("kit_reservation_id").references(
      (): AnyPgColumn => reservations.id,
    ),
  },
  (table) => [
    // One live hold per event and item; releasing keeps the row for its history.
    uniqueIndex("reservations_event_item_idx")
      .on(table.eventId, table.itemId)
      .where(sql`${table.archivedAt} is null and ${table.kitReservationId} is null`),
    // One live part hold per kit hold and part.
    uniqueIndex("reservations_kit_item_idx")
      .on(table.kitReservationId, table.itemId)
      .where(sql`${table.archivedAt} is null and ${table.kitReservationId} is not null`),
    index("reservations_item_window_idx").on(
      table.itemId,
      table.windowStart,
      table.windowEnd,
    ),
    oneOf("reservations_status_check", table.status, holdStatuses),
    check("reservations_quantity_check", sql`${table.quantity} > 0`),
    check("reservations_window_check", sql`${table.windowEnd} >= ${table.windowStart}`),
  ],
).enableRLS();
// Conflict detection (FLOW-77): a hold that can't get its full quantity. One live
// row per hold; resolving or clearing it keeps the row as history. `signature`
// describes the situation, so a notification repeats only when it changes.
export const reservationConflicts = pgTable(
  "reservation_conflicts",
  {
    ...baseColumns(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => masterInventoryItems.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: text("kind", { enum: issueKinds }).notNull(),
    state: text("state", { enum: conflictStates }).notNull().default("open"),
    quantity: quantity("quantity").notNull(),
    allocated: quantity("allocated").notNull(),
    shortfall: quantity("shortfall").notNull(),
    signature: text("signature").notNull(),
    notifiedSignature: text("notified_signature"),
    resolution: jsonb("resolution").$type<ConflictResolution>(),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamptz("resolved_at"),
  },
  (table) => [
    uniqueIndex("reservation_conflicts_live_idx")
      .on(table.reservationId)
      .where(sql`${table.state} <> 'resolved' and ${table.archivedAt} is null`),
    index("reservation_conflicts_item_idx").on(table.itemId, table.state),
    index("reservation_conflicts_event_idx").on(table.eventId, table.state),
    oneOf("reservation_conflicts_kind_check", table.kind, issueKinds),
    oneOf("reservation_conflicts_state_check", table.state, conflictStates),
  ],
).enableRLS();
// What an event needs of a consumable (FLOW-85). Menu, bar and supply planning
// (FLOW-135, FLOW-170, FLOW-214) write their own `source`; people enter `manual` ones.
export const eventRequirements = pgTable(
  "event_requirements",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    // A consumable of any list.
    itemId: anyItemReference(),
    basis: text("basis", { enum: requirementBases }).notNull().default("fixed"),
    quantity: quantity("quantity").notNull(),
    source: text("source").notNull().default("manual"),
  },
  (table) => [
    uniqueIndex("event_requirements_line_idx")
      .on(table.eventId, table.itemId, table.source)
      .where(sql`${table.archivedAt} is null`),
    index("event_requirements_item_idx").on(table.itemId),
    oneOf("event_requirements_basis_check", table.basis, requirementBases),
    check("event_requirements_quantity_check", sql`${table.quantity} >= 0`),
  ],
).enableRLS();
// Bar quantities an event plans by tier ("12 bottles of rail vodka", FLOW-170),
// with what the last recompute of the tier's pool decided. Bar quantities planned
// by item are event_requirements with source "bar".
const barTiers = ["rail", "mid", "high", "premium"] as const;
export const eventBarTiers = pgTable(
  "event_bar_tiers",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    category: text("category").notNull(),
    // Empty: any subcategory of the category.
    subcategory: text("subcategory").notNull().default(""),
    tier: text("tier", { enum: barTiers }).notNull(),
    basis: text("basis", { enum: requirementBases }).notNull().default("fixed"),
    quantity: quantity("quantity").notNull(),
    allocated: quantity("allocated"),
    shortage: quantity("shortage"),
    orderBy: date("order_by", { mode: "string" }),
    reorderItemId: uuid("reorder_item_id").references(() => barInventoryItems.id),
    computedAt: timestamptz("computed_at"),
  },
  (table) => [
    uniqueIndex("event_bar_tiers_line_idx")
      .on(table.eventId, table.category, table.subcategory, table.tier)
      .where(sql`${table.archivedAt} is null`),
    index("event_bar_tiers_pool_idx").on(table.category, table.tier),
    oneOf("event_bar_tiers_tier_check", table.tier, barTiers),
    oneOf("event_bar_tiers_basis_check", table.basis, requirementBases),
    check("event_bar_tiers_quantity_check", sql`${table.quantity} >= 0`),
  ],
).enableRLS();
// The result of the last recompute for one event and consumable (FLOW-85), read by
// the order list (FLOW-86) and planning screens. Rewritten by the allocation job.
export const consumableAllocations = pgTable(
  "consumable_allocations",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    // A consumable of any list.
    itemId: anyItemReference(),
    required: quantity("required").notNull(),
    allocated: quantity("allocated").notNull(),
    shortage: quantity("shortage").notNull(),
    projectedStock: quantity("projected_stock").notNull(),
    orderBy: date("order_by", { mode: "string" }),
    computedAt: timestamptz("computed_at").notNull(),
  },
  (table) => [
    uniqueIndex("consumable_allocations_event_item_idx").on(
      table.eventId,
      table.itemId,
    ),
    index("consumable_allocations_item_idx").on(table.itemId),
  ],
).enableRLS();
