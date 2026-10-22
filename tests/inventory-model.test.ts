import { describe, expect, it } from "vitest";
import { itemInputSchema, type ItemInput } from "../shared/inventory";

// FLOW-69 AC3: one row of each shape in the source spreadsheets, as items. The
// rows follow the shapes the ticket names; swap in the exact CSV rows once
// docs/source-data/ lands (FLOW-32).
const rows: Record<string, ItemInput> = {
  "grouped linen tier": {
    kind: "rental",
    subtype: "linen",
    name: 'Premium 120" Round Tablecloth',
    category: "Linens",
    group: "Table Linens",
    tier: "Premium",
    color: "Ivory",
    ratio: { quantity: 1, basis: "per_table" },
    rental: { priceCents: 2500 },
  },
  "gold/silver cutlery": {
    kind: "rental",
    subtype: "tableware",
    name: "Dinner Fork",
    category: "Flatware",
    group: "Cutlery",
    color: "Gold",
    ratio: { quantity: 1, basis: "per_guest" },
    rental: { priceCents: 75 },
  },
  "per-person glassware": {
    kind: "rental",
    subtype: "glassware",
    name: "Red Wine Glass",
    category: "Glassware",
    ratio: { quantity: 2, basis: "per_guest" },
    rental: { priceCents: 85 },
  },
  "Full Plasticware Package": {
    kind: "service",
    name: "Full Plasticware Package",
    category: "Disposables",
    description: "Plates, cutlery, cups and napkins for each guest.",
    service: { priceCents: 350, priceBasis: "per_guest" },
  },
  "bar liquor": {
    kind: "consumable",
    subtype: "bar",
    name: "Vodka",
    category: "Liquor",
    unit: "each",
    consumable: {
      purchaseUnit: "case",
      packCount: 12,
      eachSize: { quantity: 750, unit: "ml" },
      recipeUnit: "fl_oz",
      unitCostCents: 21000,
      preferredVendor: "Republic National",
    },
  },
  "kitchen ingredient": {
    kind: "consumable",
    subtype: "ingredient",
    name: "Heavy Cream",
    category: "Dairy",
    unit: "qt",
    consumable: {
      purchaseUnit: "case",
      packCount: 6,
      eachSize: { quantity: 1, unit: "qt" },
      recipeUnit: "cup",
      unitCostCents: 2400,
      preferredVendor: "Sysco",
      parLevel: 6,
      allergens: ["milk"],
    },
  },
};

describe("inventory item model", () => {
  it.each(Object.entries(rows))("represents a %s row", (_shape, row) => {
    const parsed = itemInputSchema.safeParse(row);
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data).toMatchObject(row);
  });

  it("defaults the optional fields", () => {
    const item = itemInputSchema.parse(rows["per-person glassware"]);
    expect(item).toMatchObject({
      code: "",
      unit: "each",
      group: "",
      tier: "",
      active: true,
    });
  });

  it.each<[string, ItemInput, string]>([
    [
      "a service with a subtype",
      { kind: "service", subtype: "decor", name: "Setup" },
      "Services have no subtype.",
    ],
    [
      "a rental with a consumable subtype",
      { kind: "rental", subtype: "ingredient", name: "Flour" },
      "Pick a rental subtype.",
    ],
    [
      "a consumable without purchase details",
      { kind: "consumable", subtype: "supply", name: "Napkins" },
      "Purchase details are required.",
    ],
    [
      "a rental with consumable details",
      {
        kind: "rental",
        subtype: "bar",
        name: "Portable Bar",
        consumable: { purchaseUnit: "each" },
      },
      "Only consumable items have consumable details.",
    ],
    [
      "a case without a pack count",
      {
        kind: "consumable",
        subtype: "bar",
        name: "Tonic",
        consumable: { purchaseUnit: "case" },
      },
      "Enter how many are in a case.",
    ],
    [
      "an unknown unit",
      {
        kind: "rental",
        subtype: "decor",
        name: "Vase",
        unit: "bunch" as "each",
      },
      "",
    ],
  ])("rejects %s", (_case, row, message) => {
    const parsed = itemInputSchema.safeParse(row);
    expect(parsed.success).toBe(false);
    if (message)
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        message,
      );
  });
});
