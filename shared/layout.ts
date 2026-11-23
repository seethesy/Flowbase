import { z } from "zod";
import { roleSchema, roles } from "./access";
import { fieldDef, fieldRegistry, isSourceKey, sourceKeys, type SourceKey } from "./fields";
import { styleContrastOk } from "./contrast";

// Saved page layouts (FLOW-253): one LayoutDoc per page, shared by everyone, live
// on Save through the same live-edit session as wording (FLOW-240). Table column
// sets (FLOW-254), field boxes and free-text boxes (FLOW-255) and custom cards
// (FLOW-256) are parts of the same document. With no saved document a page
// renders exactly as its code lays it out.

export const LAYOUT_VERSION = 1;
export const GRID_COLUMNS = 12;
// Raised from 20 for pages with many sections (FLOW-278).
export const MAX_BLOCKS = 40;
export const MAX_CARDS = 12;
export const MAX_CARD_ROWS = 100;

// A page key, e.g. "leads.detail"; a block, table or box id, e.g. "lead-facts".
export const layoutKeySchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/, "Use a key such as leads.detail.");
const blockId = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use an id such as lead-facts.");

// Layout-only lifecycle: record values never live in these tombstones.
export const deletionSchema = z.object({
  at: z.string().datetime(), by: z.string().min(1).max(200), name: z.string().min(1).max(200),
}).strict();
export const lifecycleShape = { deleted: deletionSchema.optional(), removed: z.literal(true).optional() };
export type LayoutLifecycle = { deleted?: z.infer<typeof deletionSchema>; removed?: true };
export const layoutItemGone = (item: LayoutLifecycle) => Boolean(item.deleted || item.removed);

// Only 6-digit hex colors, never raw CSS.
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a color such as #327459.")
  .transform((value) => value.toLowerCase());
// A block's or box's look (FLOW-253, more options in FLOW-278). Every option is
// optional; absent means the page's default look.
export const radiusOptions = ["none", "small", "large"] as const;
export const paddingOptions = ["compact", "normal", "roomy"] as const;
export const titleSizeOptions = ["small", "normal", "large"] as const;
export const styleSchema = z
  .object({
    text: hexColorSchema.optional(),
    background: hexColorSchema.optional(),
    // A border color, or "none" to drop the card's border.
    border: z.union([hexColorSchema, z.literal("none")]).optional(),
    radius: z.enum(radiusOptions).optional(),
    padding: z.enum(paddingOptions).optional(),
    // The card's own title bar (its heading) shown or hidden.
    titleHidden: z.boolean().optional(),
    titleSize: z.enum(titleSizeOptions).optional(),
    // A colored stripe along the card's left edge.
    accent: hexColorSchema.optional(),
  })
  .strict();
export type BlockStyle = z.infer<typeof styleSchema>;

// The roles a dashboard or custom card is limited to (FLOW-269); absent means
// every role. A card still hides from a role that can't read its source area.
export const visibleToSchema = roleSchema.array().max(roles.length);

// Admin-entered text is plain text: rendered as text, never as HTML.
const plainText = (max: number) => z.string().max(max);

const position = {
  x: z.number().int().min(0).max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(200),
};
const insideGrid = (value: { x: number; w: number }) => value.x + value.w <= GRID_COLUMNS;
const gridMessage = { message: "A block must fit inside the 12 columns." };

// A box inside a card's inner grid: a field (label + value) or plain text.
export const textVariants = ["heading", "text", "note"] as const;
export const boxSchema = z
  .object({
    id: blockId,
    kind: z.enum(["field", "heading", "text", "note"]),
    field: z.string().max(60).optional(),
    text: plainText(2000).optional(),
    ...position,
    style: styleSchema.optional(),
    ...lifecycleShape,
  })
  .strict()
  .refine(insideGrid, gridMessage)
  .refine((box) => (box.kind === "field" ? Boolean(box.field) : box.text !== undefined), {
    message: "A field box names a field; a text box has text.",
  });
export type LayoutBox = z.infer<typeof boxSchema>;

export const columnSchema = z
  .object({ key: z.string().max(60), width: z.number().int().min(40).max(1200).optional() })
  .strict();
export type ColumnConfig = z.infer<typeof columnSchema>;
// A table's visible columns in order (FLOW-254).
export const tableConfigSchema = z.object({ columns: columnSchema.array().max(60), ...lifecycleShape }).strict();
export type TableConfig = z.infer<typeof tableConfigSchema>;
// A record card's field boxes and free-text boxes (FLOW-255).
export const fieldBoxesSchema = z.object({ boxes: boxSchema.array().max(60) }).strict();
export type FieldBoxesConfig = z.infer<typeof fieldBoxesSchema>;

// Custom cards (FLOW-256).
export const filterOperators = [
  "is",
  "is_not",
  "contains",
  "before",
  "after",
  "within_days",
  "is_me",
  "is_empty",
] as const;
export type FilterOperator = (typeof filterOperators)[number];
export const cardFilterSchema = z
  .object({
    field: z.string().max(60),
    op: z.enum(filterOperators),
    value: z.union([z.string().max(200), z.number()]).optional(),
  })
  .strict();
export type CardFilter = z.infer<typeof cardFilterSchema>;
export const cardSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record") }).strict(),
  z.object({ type: z.literal("related"), relation: z.string().max(40) }).strict(),
  z.object({ type: z.literal("list"), list: z.enum(sourceKeys) }).strict(),
]);
export type CardSource = z.infer<typeof cardSourceSchema>;
export const cardDisplaySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("table"), columns: columnSchema.array().min(1).max(30) }).strict(),
  z.object({ type: z.literal("boxes"), boxes: boxSchema.array().max(30) }).strict(),
]);
export const cardConfigSchema = z
  .object({
    title: plainText(120),
    source: cardSourceSchema,
    filters: cardFilterSchema.array().max(10).default([]),
    sort: z.object({ field: z.string().max(60), dir: z.enum(["asc", "desc"]) }).strict().optional(),
    limit: z.number().int().min(1).max(MAX_CARD_ROWS).default(10),
    display: cardDisplaySchema,
  })
  .strict();
export type CardConfig = z.infer<typeof cardConfigSchema>;

// Options every block has (FLOW-278): its look, "Fit content" (its height
// follows its content instead of its row count) and "Hide on phone".
const blockOptions = {
  ...lifecycleShape,
  style: styleSchema.optional(),
  fit: z.boolean().optional(),
  hidePhone: z.boolean().optional(),
};

// A built-in card's data override (FLOW-279): the card builder's settings
// without title or source, which stay the card's own.
export const builtinDataSchema = z
  .object({
    filters: cardFilterSchema.array().max(10).default([]),
    sort: z.object({ field: z.string().max(60), dir: z.enum(["asc", "desc"]) }).strict().optional(),
    limit: z.number().int().min(1).max(MAX_CARD_ROWS).default(10),
    display: cardDisplaySchema,
  })
  .strict();
export type BuiltinData = z.infer<typeof builtinDataSchema>;

// A page block: one of the page's built-in sections, a custom card or a
// free-text box. Built-ins retain tombstones until Reset page layout.
export const blockSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("builtin"),
        id: blockId,
        ...position,
        ...blockOptions,
        hidden: z.boolean().optional(),
        visibleTo: visibleToSchema.optional(),
        // What a built-in card shows (FLOW-279): its fields, filters, sort and
        // rows, over its code default. Absent: the card as its code renders it.
        data: builtinDataSchema.optional(),
      })
      .strict(),
    z.object({ kind: z.literal("card"), id: blockId, ...position, ...blockOptions, visibleTo: visibleToSchema.optional(), card: cardConfigSchema }).strict(),
    z
      .object({
        kind: z.literal("text"),
        id: blockId,
        ...position,
        ...blockOptions,
        variant: z.enum(textVariants),
        text: plainText(2000),
      })
      .strict(),
  ])
  .refine(insideGrid, gridMessage);
export type LayoutBlock = z.infer<typeof blockSchema>;

export const layoutDocSchema = z
  .object({
    version: z.literal(LAYOUT_VERSION),
    // Empty: the page keeps its code order for built-in blocks.
    blocks: blockSchema.array().max(400).refine((blocks) => blocks.filter((b) => !layoutItemGone(b)).length <= MAX_BLOCKS, `A page holds at most ${MAX_BLOCKS} blocks.`).default([]),
    tables: z.record(layoutKeySchema, tableConfigSchema).default({}),
    fieldBoxes: z.record(layoutKeySchema, fieldBoxesSchema).default({}),
    headers: z.record(layoutKeySchema, z.object({ ...lifecycleShape }).strict()).optional(),
  })
  .strict();
export type LayoutDoc = z.infer<typeof layoutDocSchema>;
export type LayoutDocInput = z.input<typeof layoutDocSchema>;
export const emptyLayout = (): LayoutDoc => ({ version: LAYOUT_VERSION, blocks: [], tables: {}, fieldBoxes: {} });

// GET /api/layout/:pageKey: the saved document, or null for the code default.
export const savedLayoutSchema = z
  .object({ pageKey: layoutKeySchema, layout: layoutDocSchema, updatedAt: z.string(), updatedBy: z.string().nullable() })
  .nullable();
export type SavedLayout = z.infer<typeof savedLayoutSchema>;

// ---- Where tables and field-box cards take their fields from ----------------

// Each layout-aware table names its source, the columns that can't be hidden
// or moved, and the columns its code renders that aren't registry fields
// (kept by key, e.g. Leads Notes and BEO). A table whose rows aren't records of
// one source (source null, FLOW-296) keeps only its code's columns, which the
// Admin resizes; a saved key its code no longer has is dropped when shown.
export type LayoutTable = { source: SourceKey | null; locked: string[]; code: string[] };
export const layoutTables: Record<string, LayoutTable> = {
  "leads.inbox.table": { source: "leads", locked: [], code: ["notes", "latestBeo"] },
  "events.event-table": { source: "events", locked: [], code: ["when", "guests"] },
  "clients.client-list": { source: "clients", locked: [], code: ["contact", "email", "phone", "tags"] },
  "venues.venue-list": { source: "venues", locked: [], code: ["areas"] },
  "vendors.vendor-list": { source: "vendors", locked: [], code: ["leadTime"] },
  "staff.staff-directory": { source: "staff", locked: [], code: [] },
  "inventory-lists.inventory-list": { source: "inventory", locked: [], code: ["variant", "quantity", "categoryId", "typeId"] },
  // FLOW-279: the inventory pages' other tables.
  "inventory-master.master-inventory": { source: "inventory", locked: [], code: ["quantity", "location", "price", "ratio", "status"] },
  "inventory-lists.ingredient-list": {
    source: "inventory",
    locked: [],
    code: ["categoryId", "typeId", "purchase", "recipeUnit", "cost", "vendor", "storage", "onHand"],
  },
  "inventory-lists.bar-list": {
    source: "inventory",
    locked: [],
    code: ["brand", "categoryId", "typeId", "container", "pack", "distributor", "cost", "onHand"],
  },
  "stock-counts.low-stock-list": { source: "inventory", locked: [], code: ["onHand", "par", "short", "storage", "vendor"] },
  // FLOW-296: every other data table, so an Admin can resize its columns.
  "tasks.dashboard.table": { source: "tasks", locked: [], code: [] },
  // Owner and Updated are Staffing › SOPs columns from code (FLOW-270).
  "sops.library": { source: "sops", locked: [], code: ["owner", "updated"] },
  "recipes.recipe-list": { source: "recipes", locked: [], code: ["yield", "dietary", "perServing", "updated", "flags"] },
  "documents.library": { source: "documents", locked: [], code: ["file", "linked", "uploaded", "size"] },
  "lead-dashboard.by-source": { source: null, locked: [], code: [] },
  "lead-dashboard.by-channel": { source: null, locked: [], code: [] },
  "lead-dashboard.by-salesperson": { source: null, locked: [], code: [] },
  "time-tracking.by-event": { source: null, locked: [], code: [] },
  "time-tracking.by-proposal": { source: null, locked: [], code: [] },
  "time-tracking.workload": { source: null, locked: [], code: [] },
  "beo-list.table": { source: null, locked: [], code: [] },
  "purchasing.table": { source: null, locked: [], code: [] },
};
// Pseudo-columns a table renders that aren't registry fields (locked controls).
export const controlColumns = new Set(["actions"]);

// Record pages: the page's record source ("This record" for cards) and its
// field-box cards.
export const recordPages: Record<string, { source: SourceKey; fieldCards: string[] }> = {
  "leads.detail": { source: "leads", fieldCards: ["lead-facts"] },
  "events.detail": { source: "events", fieldCards: ["event-facts"] },
  "clients.detail": { source: "clients", fieldCards: ["client-facts"] },
  "venues.detail": { source: "venues", fieldCards: ["venue-facts"] },
  "vendors.detail": { source: "vendors", fieldCards: ["vendor-facts"] },
  "staff.detail": { source: "staff", fieldCards: ["staff-facts"] },
  "inventory.detail": { source: "inventory", fieldCards: ["item-facts"] },
  "proposals.detail": { source: "proposals", fieldCards: ["proposal-facts"] },
};

// Built-in cards whose values the Admin can edit (FLOW-279), keyed
// "<pageKey>/<blockId>": the card's code default as a card config, which the
// card builder starts from with the source locked. A saved `data` override on
// the builtin block renders the card through the custom-card path (fields=
// projection) instead of its code. Cards that aren't record lists (notes,
// files, photos, planning) have no entry and keep Style, Hide and move only.
export const builtinCards: Record<string, CardConfig> = {
  "dashboard.home/working-staff": {"title": "Working Staff", "source": {"type": "list", "list": "working-staff"}, "filters": [], "sort": {"field": "since", "dir": "asc"}, "limit": 20, "display": {"type": "table", "columns": [{"key": "name"}, {"key": "position"}, {"key": "since"}]}},
  "clients.detail/proposal-tracker": {"title": "Proposal tracker", "source": {"type": "related", "relation": "proposals"}, "filters": [], "sort": {"field": "title", "dir": "asc"}, "limit": 20, "display": {"type": "table", "columns": [{"key": "title"}, {"key": "stage"}, {"key": "currentVersion"}]}},
  "vendors.detail/vendor-items": {"title": "Items they supply", "source": {"type": "related", "relation": "items"}, "filters": [], "sort": {"field": "name", "dir": "asc"}, "limit": 20, "display": {"type": "table", "columns": [{"key": "name"}, {"key": "code"}, {"key": "kind"}, {"key": "subtype"}]}},
  "venues.detail/event-history": {"title": "Event history", "source": {"type": "related", "relation": "events"}, "filters": [], "sort": {"field": "date", "dir": "asc"}, "limit": 20, "display": {"type": "table", "columns": [{"key": "title"}, {"key": "date"}, {"key": "status"}, {"key": "guestCount"}]}},

  "dashboard.home/my-leads": {
    title: "My Leads",
    source: { type: "list", list: "leads" },
    filters: [{ field: "assignedSalespersonId", op: "is_me" }],
    sort: { field: "eventDate", dir: "asc" },
    limit: 10,
    display: { type: "table", columns: [{ key: "name" }, { key: "eventName" }, { key: "eventDate" }, { key: "status" }] },
  },
  "dashboard.home/upcoming-events": {
    title: "Upcoming Events",
    source: { type: "list", list: "events" },
    filters: [{ field: "date", op: "within_days", value: 30 }],
    sort: { field: "date", dir: "asc" },
    limit: 10,
    display: { type: "table", columns: [{ key: "date" }, { key: "title" }, { key: "venue" }, { key: "guestCount" }] },
  },
  "clients.detail/events": {
    title: "Events",
    source: { type: "related", relation: "events" },
    filters: [],
    sort: { field: "date", dir: "desc" },
    limit: 20,
    display: { type: "table", columns: [{ key: "title" }, { key: "date" }, { key: "status" }, { key: "guestCount" }] },
  },
};
export const builtinCardKey = (pageKey: string, blockId: string) => `${pageKey}/${blockId}`;
// A built-in card with its saved override applied: the card's own title and
// source, the override's filters, sort, rows and fields.
export function builtinCard(pageKey: string, blockId: string, data: BuiltinData | undefined): CardConfig | null {
  const base = builtinCards[builtinCardKey(pageKey, blockId)];
  if (!base) return null;
  return data ? { ...base, filters: data.filters, sort: data.sort, limit: data.limit, display: data.display } : base;
}

// ---- Contrast: shared/contrast.ts -------------------------------------------

export { contrastRatio, DEFAULT_BACKGROUND, DEFAULT_TEXT, MIN_CONTRAST, styleContrastOk } from "./contrast";

// ---- Server-side validation beyond the schema ----------------------------------

export type LayoutProblem = { path: string; message: string };

function checkBoxes(boxes: LayoutBox[], source: SourceKey | null, path: string, problems: LayoutProblem[]) {
  boxes.forEach((box, index) => {
    if (!styleContrastOk(box.style))
      problems.push({ path: `${path}.${index}.style`, message: "Text and background colors are too close." });
    if (box.kind !== "field") return;
    if (!source || !fieldDef(source, box.field!))
      problems.push({ path: `${path}.${index}.field`, message: `Unknown field "${box.field}".` });
  });
}

// Rejects unknown fields, sources, relations and operators, low-contrast
// colors, duplicate ids and too many cards. The page key says which record a
// "This record" or related-list card reads.
export function layoutProblems(pageKey: string, doc: LayoutDoc): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const recordSource = recordPages[pageKey]?.source ?? null;
  const ids = new Set<string>();
  let cards = 0;
  const checkCard = (card: CardConfig, path: string) => {
    let source: SourceKey | null = null;
    if (card.source.type === "list") source = card.source.list;
    else if (card.source.type === "record") {
      source = recordSource;
      if (!source) problems.push({ path: `${path}.source`, message: "This page has no record." });
    } else {
      const relation = recordSource
        ? fieldRegistry[recordSource].relations?.find((r) => r.key === (card.source as { relation: string }).relation)
        : undefined;
      if (!relation) problems.push({ path: `${path}.source`, message: "Unknown related list." });
      else source = relation.source;
    }
    if (!source) return;
    for (const [i, filter] of card.filters.entries()) {
      const def = fieldDef(source, filter.field);
      if (!def?.filterable) problems.push({ path: `${path}.filters.${i}`, message: `Can't filter on "${filter.field}".` });
      else if (!operatorsFor(def.type).includes(filter.op))
        problems.push({ path: `${path}.filters.${i}.op`, message: `"${filter.op}" doesn't apply to ${def.label}.` });
    }
    if (card.sort && !fieldDef(source, card.sort.field)?.sortable)
      problems.push({ path: `${path}.sort`, message: `Can't sort on "${card.sort.field}".` });
    if (card.display.type === "table")
      card.display.columns.forEach((column, i) => {
        if (!fieldDef(source!, column.key))
          problems.push({ path: `${path}.display.columns.${i}`, message: `Unknown field "${column.key}".` });
      });
    else checkBoxes(card.display.boxes, source, `${path}.display.boxes`, problems);
  };
  // Validate lifecycle combinations even for direct callers, not only HTTP parsing.
  const lifecycle = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    const state = value as LayoutLifecycle;
    if (state.deleted && (!deletionSchema.safeParse(state.deleted).success || state.removed))
      problems.push({ path, message: "Invalid deleted state: use valid metadata or a permanent tombstone, not both." });
    if (state.removed !== undefined && state.removed !== true)
      problems.push({ path, message: "Invalid permanent removal state." });
    for (const [key, child] of Object.entries(value)) if (key !== "deleted") lifecycle(child, `${path}.${key}`);
  };
  lifecycle(doc, "layout");
  doc.blocks.forEach((block, index) => {
    const path = `blocks.${index}`;
    if (ids.has(block.id)) problems.push({ path: `${path}.id`, message: `Two blocks are named "${block.id}".` });
    ids.add(block.id);
    if (!styleContrastOk(block.style))
      problems.push({ path: `${path}.style`, message: "Text and background colors are too close." });
    if (block.kind === "builtin") {
      if (!block.data) return;
      const card = builtinCard(pageKey, block.id, block.data);
      if (!card) problems.push({ path: `${path}.data`, message: "This block's values can't be edited." });
      else checkCard(card, `${path}.data`);
      return;
    }
    if (block.kind !== "card") return;
    if (!layoutItemGone(block)) cards += 1;
    checkCard(block.card, `${path}.card`);
  });
  if (cards > MAX_CARDS) problems.push({ path: "blocks", message: `A page holds at most ${MAX_CARDS} custom cards.` });
  for (const [key, table] of Object.entries(doc.tables)) {
    const target = layoutTables[key];
    if (!target) {
      problems.push({ path: `tables.${key}`, message: `Unknown table "${key}".` });
      continue;
    }
    table.columns.forEach((column, i) => {
      if (target.source && !controlColumns.has(column.key) && !target.code.includes(column.key) && !fieldDef(target.source, column.key))
        problems.push({ path: `tables.${key}.columns.${i}`, message: `Unknown field "${column.key}".` });
    });
    const keys = table.columns.map((column) => column.key);
    if (new Set(keys).size !== keys.length) problems.push({ path: `tables.${key}`, message: "A column is listed twice." });
    for (const locked of target.locked)
      if (!table.columns.some((column) => column.key === locked))
        problems.push({ path: `tables.${key}`, message: `The "${locked}" column can't be hidden.` });
    for (const field of target.source ? fieldRegistry[target.source].fields.filter((f) => f.required) : [])
      if (!keys.includes(field.key))
        problems.push({ path: `tables.${key}`, message: `${field.label} can't be hidden.` });
  }
  for (const [key, boxes] of Object.entries(doc.fieldBoxes)) {
    if (!recordSource || !recordPages[pageKey].fieldCards.includes(key)) {
      problems.push({ path: `fieldBoxes.${key}`, message: `Unknown field card "${key}".` });
      continue;
    }
    checkBoxes(boxes.boxes, recordSource, `fieldBoxes.${key}.boxes`, problems);
    // Required fields can't be hidden (FLOW-255 AC2).
    for (const field of fieldRegistry[recordSource].fields.filter((f) => f.required))
      if (!boxes.boxes.some((box) => box.kind === "field" && box.field === field.key))
        problems.push({ path: `fieldBoxes.${key}`, message: `${field.label} can't be hidden.` });
  }
  return problems;
}

// Filter operators per field type (FLOW-256).
export function operatorsFor(type: string): FilterOperator[] {
  switch (type) {
    case "date":
    case "datetime":
      return ["before", "after", "within_days", "is_empty"];
    case "number":
    case "money":
      return ["is", "is_not", "before", "after", "is_empty"];
    case "person":
      return ["is", "is_not", "is_me", "is_empty"];
    case "status":
    case "boolean":
      return ["is", "is_not", "is_empty"];
    default:
      return ["is", "is_not", "contains", "is_empty"];
  }
}

export const isLayoutSource = isSourceKey;
