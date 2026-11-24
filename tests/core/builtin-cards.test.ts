import { describe, expect, it } from "vitest";
import {
  builtinCard,
  builtinCards,
  cardConfigSchema,
  layoutDocSchema,
  layoutProblems,
  layoutTables,
  type CardConfig,
} from "../../shared/layout";
import { switchCardSource } from "../../src/app/live-edit/card-builder";

// FLOW-279: editing what built-in cards show, the inventory tables made
// layout-aware, and a source switch that keeps shared fields. Blocks are placed
// as a saved version 1 document, read as a page grid (FLOW-319).

const doc = (blocks: unknown[], tables: Record<string, unknown> = {}) =>
  layoutDocSchema.parse({ version: 1, blocks, tables });
const myLeads = (data: unknown) => ({ kind: "builtin", id: "my-leads", x: 0, y: 0, w: 6, h: 12, data });

describe("built-in cards (AC1, AC2)", () => {
  it("declares valid defaults for every editable card", () => {
    for (const [key, card] of Object.entries(builtinCards)) {
      expect(cardConfigSchema.safeParse(card).success, key).toBe(true);
      const [pageKey, id] = key.split("/");
      const data = { filters: card.filters, sort: card.sort, limit: card.limit, display: card.display };
      expect(layoutProblems(pageKey, doc([{ kind: "builtin", id, x: 0, y: 0, w: 6, h: 8, data }])), key).toEqual([]);
    }
  });

  it("applies a saved override over the card's own title and source", () => {
    const data = {
      filters: [{ field: "status", op: "is_not" as const, value: "lost" }],
      sort: { field: "name", dir: "desc" as const },
      limit: 5,
      display: { type: "table" as const, columns: [{ key: "name" }, { key: "guestCount" }] },
    };
    expect(builtinCard("dashboard.home", "my-leads", data)).toEqual({
      title: "My Leads",
      source: { type: "list", list: "leads" },
      ...data,
    });
    expect(builtinCard("dashboard.home", "my-leads", undefined)).toBe(builtinCards["dashboard.home/my-leads"]);
    expect(builtinCard("dashboard.home", "my-tasks", data)).toBeNull();
  });

  it("refuses an override on a card that can't be edited, or with unknown fields", () => {
    const data = { filters: [], limit: 10, display: { type: "table", columns: [{ key: "name" }] } };
    expect(layoutProblems("dashboard.home", doc([{ ...myLeads(data), id: "my-tasks" }])).map((p) => p.path)).toEqual(["blocks.0.data"]);
    expect(
      layoutProblems("dashboard.home", doc([myLeads({ ...data, display: { type: "table", columns: [{ key: "nope" }] } })])).map((p) => p.path),
    ).toEqual(["blocks.0.data.display.columns.0"]);
    expect(
      layoutProblems("dashboard.home", doc([myLeads({ ...data, filters: [{ field: "message", op: "is_me" }] })])).length,
    ).toBeGreaterThan(0);
    // A client's Events reads the client's related events.
    expect(
      layoutProblems("clients.detail", doc([{ kind: "builtin", id: "events", x: 0, y: 0, w: 12, h: 12, data: { ...data, display: { type: "table", columns: [{ key: "venue" }] } } }])),
    ).toEqual([]);
  });
});

describe("the inventory tables are layout-aware (AC3)", () => {
  const tables = {
    "inventory-lists.inventory-list": ["name", "kind", "categoryId", "typeId", "quantity", "par", "stock", "storage", "vendor", "cost", "purchase", "packCount", "lastCounted", "lastCountedBy"],
    "inventory-lists.ingredient-list": ["name", "categoryId", "typeId", "category", "purchase", "recipeUnit", "cost", "vendor", "storage", "onHand"],
    "inventory-lists.bar-list": ["name", "brand", "categoryId", "typeId", "category", "subcategory", "tier", "container", "pack", "distributor", "cost", "onHand"],
  };
  for (const [key, columns] of Object.entries(tables))
    it(`${key}: saves its own columns reordered, plus a registry field, with widths`, () => {
      expect(layoutTables[key]?.source).toBe("inventory");
      const saved = [{ key: "unit", width: 120 }, ...[...columns].reverse().map((column) => ({ key: column }))];
      expect(layoutProblems("inventory.any", doc([], { [key]: { columns: saved } }))).toEqual([]);
      expect(layoutProblems("inventory.any", doc([], { [key]: { columns: [{ key: "name" }, { key: "nope" }] } })).map((p) => p.path)).toEqual([
        `tables.${key}.columns.1`,
      ]);
    });
});

describe("switching a card's source (AC5)", () => {
  const card: CardConfig = {
    title: "Mine",
    source: { type: "list", list: "leads" },
    filters: [
      { field: "assignedSalespersonId", op: "is_me" },
      { field: "message", op: "contains", value: "wedding" },
    ],
    sort: { field: "guestCount", dir: "desc" },
    limit: 10,
    display: { type: "table", columns: [{ key: "status" }, { key: "eventName" }, { key: "guestCount", width: 90 }] },
  };

  it("keeps fields the new source has and names the dropped ones", () => {
    const { card: next, dropped } = switchCardSource(card, { type: "list", list: "events" }, null);
    expect(next.source).toEqual({ type: "list", list: "events" });
    expect(next.filters).toEqual([{ field: "assignedSalespersonId", op: "is_me" }]);
    expect(next.sort).toEqual({ field: "guestCount", dir: "desc" });
    expect(next.display).toEqual({ type: "table", columns: [{ key: "status" }, { key: "guestCount", width: 90 }] });
    expect(dropped).toEqual(["Message", "Event"]);
  });

  it("keeps field boxes and text boxes the same way", () => {
    const boxes: CardConfig = {
      ...card,
      display: {
        type: "boxes",
        boxes: [
          { id: "f1", kind: "field", field: "guestCount", x: 0, y: 0, w: 6, h: 2 },
          { id: "f2", kind: "field", field: "budgetCents", x: 6, y: 0, w: 6, h: 2 },
          { id: "t1", kind: "note", text: "Hi", x: 0, y: 2, w: 12, h: 2 },
        ],
      },
    };
    const { card: next, dropped } = switchCardSource(boxes, { type: "list", list: "events" }, null);
    expect(next.display.type === "boxes" && next.display.boxes.map((box) => box.id)).toEqual(["f1", "t1"]);
    expect(dropped).toContain("Budget");
  });
});

// FLOW-281: both new table registries accept widths and reordered columns.
for (const [table, source, fields] of [
  ["recipes.recipe-list", "recipes", ["name", "category", "allergens", "dietaryTags", "updatedAt"]],
  ["sops.library", "sops", ["title", "category", "version", "updatedAt"]],
] as const) {
  it(`${table}: validates chosen columns, order and width`, () => {
    expect(layoutTables[table].source).toBe(source);
    const columns = [...fields].reverse().map((key) => ({ key, width: 180 }));
    const saved = doc([], { [table]: { columns } });
    expect(saved.tables[table].columns).toEqual(columns);
    expect(layoutProblems(`${source}.list`, saved)).toEqual([]);
    expect(layoutProblems(`${source}.list`, doc([], { [table]: { columns: [{ key: "content" }] } }))).not.toEqual([]);
  });
}

it("FLOW-281: registers the four existing record lists without inventing absent cards", () => {
  for (const key of ["dashboard.home/working-staff", "clients.detail/proposal-tracker", "vendors.detail/vendor-items", "venues.detail/event-history"])
    expect(builtinCards[key]).toBeDefined();
  expect(builtinCards["staff.detail/shifts"]).toBeUndefined();
  expect(builtinCards["inventory.detail/events"]).toBeUndefined();
});
