import { describe, expect, it } from "vitest";
import {
  barCountStep,
  correctionInputSchema,
  countDifference,
  fitsCountStep,
  itemInputSchema,
  movementInputSchema,
  type ItemInput,
} from "../shared/inventory";

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
  // FLOW-90: brand or varietal, tier, container and size, pack size, distributor.
  "bar wine": {
    kind: "consumable",
    subtype: "bar",
    name: "House Pinot Grigio",
    category: "Wine",
    tier: "mid",
    consumable: {
      purchaseUnit: "case",
      packCount: 12,
      eachSize: { quantity: 750, unit: "ml" },
      unitCostCents: 9600,
      preferredVendor: "Imperio",
      parLevel: 24,
    },
    bar: { brand: "Pinot Grigio", subcategory: "White", container: "bottle" },
  },
  "rail vodka": {
    kind: "consumable",
    subtype: "bar",
    name: "Rail Vodka",
    category: "Liquor",
    tier: "rail",
    consumable: { purchaseUnit: "case", packCount: 12 },
    bar: { brand: "", subcategory: "Vodka", container: "bottle" },
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
      "bar stock outside the bar categories",
      {
        kind: "consumable",
        subtype: "bar",
        name: "Cola",
        category: "Soda",
        consumable: { purchaseUnit: "each" },
      },
      "Pick a bar category.",
    ],
    [
      "a bar tier that isn't rail, mid, high or premium",
      {
        kind: "consumable",
        subtype: "bar",
        name: "Gin",
        category: "Liquor",
        tier: "Top shelf",
        consumable: { purchaseUnit: "each" },
      },
      "The tier is rail, mid, high or premium.",
    ],
    [
      "a liquor subcategory on wine",
      {
        kind: "consumable",
        subtype: "bar",
        name: "Merlot",
        category: "Wine",
        consumable: { purchaseUnit: "each" },
        bar: { subcategory: "Rum" },
      },
      "Pick White or Red.",
    ],
    [
      "a subcategory on beer",
      {
        kind: "consumable",
        subtype: "bar",
        name: "Modelo",
        category: "Beer",
        consumable: { purchaseUnit: "each" },
        bar: { subcategory: "Lager" },
      },
      "Only wine and liquor have a subcategory.",
    ],
    [
      "bar details on an ingredient",
      {
        kind: "consumable",
        subtype: "ingredient",
        name: "Limes",
        consumable: { purchaseUnit: "each" },
        bar: { container: "can" },
      },
      "Only bar stock has bar details.",
    ],
    [
      "an unknown bar container",
      {
        kind: "consumable",
        subtype: "bar",
        name: "Cider",
        category: "Beer",
        consumable: { purchaseUnit: "each" },
        bar: { container: "box" as "can" },
      },
      "",
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

describe("stock ledger inputs (FLOW-71, FLOW-82)", () => {
  it("turns a counted quantity into the count movement's difference (FLOW-82 AC1)", () => {
    expect(countDifference(12, 15)).toBe(-3);
    expect(countDifference(15, 12)).toBe(3);
    expect(countDifference(15, 15)).toBe(0);
    expect(countDifference(0, 2.5)).toBe(-2.5);
    // No floating-point drift: 0.3 - 0.1 is 0.2, not 0.19999999999999998.
    expect(countDifference(0.3, 0.1)).toBe(0.2);
  });

  it("counts beer and wine to the nearest 0.5 and liquor to the nearest 0.25", () => {
    for (const category of ["Beer", "Wine", "Champagne"])
      expect(barCountStep(category)).toBe(0.5);
    for (const category of ["Liquor", "Cordials"])
      expect(barCountStep(category)).toBe(0.25);
    expect(barCountStep("Soft Beverages")).toBeNull();
    expect(fitsCountStep(7.5, 0.5)).toBe(true);
    expect(fitsCountStep(1.25, 0.5)).toBe(false);
    expect(fitsCountStep(3.25, 0.25)).toBe(true);
    expect(fitsCountStep(3.3, 0.25)).toBe(false);
    expect(fitsCountStep(3.3, null)).toBe(true);
  });

  it("takes a positive quantity for typed movements and a signed one for adjustments", () => {
    const section = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";
    const message = (input: unknown) =>
      movementInputSchema.safeParse(input).error?.issues[0]?.message;
    expect(
      message({ type: "receive", sectionId: section, quantity: 12 }),
    ).toBeUndefined();
    expect(message({ type: "consume", sectionId: section, quantity: -1 })).toBe(
      "Enter how many; the type sets the direction.",
    );
    expect(
      message({
        type: "adjust",
        sectionId: section,
        quantity: -1,
        reason: "Broken in transit",
      }),
    ).toBeUndefined();
    expect(message({ type: "adjust", sectionId: section, quantity: -1 })).toBe(
      "Give a reason for the adjustment.",
    );
    expect(message({ type: "receive", sectionId: section, quantity: 0 })).toBe(
      "Enter a quantity other than zero.",
    );
    // Counts and transfers have their own inputs; nothing sets a quantity.
    expect(
      message({ type: "count", sectionId: section, quantity: 3 }),
    ).toBeDefined();
    expect(
      message({ type: "transfer", sectionId: section, quantity: 3 }),
    ).toBeDefined();
  });

  it("requires a reason for a correction (FLOW-71 AC3)", () => {
    expect(
      correctionInputSchema.safeParse({ quantity: 12, reason: "Invoice" })
        .success,
    ).toBe(true);
    expect(
      correctionInputSchema.safeParse({ quantity: 12, reason: "" }).error
        ?.issues[0]?.message,
    ).toBe("Give a reason for the correction.");
  });
});
