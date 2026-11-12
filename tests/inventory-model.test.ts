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

// FLOW-69 AC3 and FLOW-165 AC1: one row of each shape in the current source files
// (Master Inventory "Main", Bar "Master Sheet", Kitchen "Sheet1" in the private
// data repo, ADR-27), as items. The structure matches the real rows (fields
// present, empty and formatted as in the files); every value is invented.
const vendorId = "b0000000-0000-4000-8000-000000000001";
const rows: Record<string, ItemInput> = {
  // Category, Subcategory, Item, Qty, Description, Location, Pull Owner, Cost,
  // Distributor all filled.
  "rental with category, subcategory, location, pull owner and cost": {
    kind: "rental",
    subtype: "equipment",
    name: "Sample Chafing Dish",
    category: "Sample Kitchen",
    subcategory: "Sample Heating",
    description: "wire",
    pullOwner: "pull_lead",
    rental: { internalCostCents: 4000, supplierId: vendorId },
  },
  // Same Item in several rows, told apart by Description: "<Item> – <Description>".
  "same-name item split by description": {
    kind: "rental",
    subtype: "equipment",
    name: "Sample Microphone – wireless",
    category: "Sample AV",
    subcategory: "Sample Sound",
    description: "wireless",
    pullOwner: "production_lead",
  },
  // Glassware and tableware rows with a sales-owned pull.
  "rental pulled by the sales manager": {
    kind: "rental",
    subtype: "tableware",
    name: "Sample Menu Easel",
    category: "Sample Decor",
    subcategory: "Sample Signage",
    pullOwner: "sales_manager",
    rental: {},
  },
  // Guest Disposables and Packing: used up, with a pack size in Description.
  "guest disposable": {
    kind: "consumable",
    subtype: "supply",
    name: "Sample Plastic Fork",
    category: "Sample Disposables",
    subcategory: "Sample Cutlery",
    description: "72 pk\nLocation: Warehouse",
    pullOwner: "pull_lead",
    consumable: { purchaseUnit: "each", preferredVendorId: vendorId },
  },
  // A priced offering with no stock.
  "service row": {
    kind: "service",
    name: "Sample Menu Card Design",
    category: "Sample Decor",
    subcategory: "Sample Signage",
    service: {},
  },
  // The Storage Box rows at the end: no Category, blank Qty, Cost and Location.
  "uncategorized row left with every flag": {
    kind: "rental",
    subtype: "equipment",
    name: "Sample Loose Item",
    category: "Uncategorized",
    flags: ["needs_category", "needs_count", "needs_cost", "confirm_location"],
    rental: {},
  },
  // Bar: Item, Qty, Unit "24pk", Details, Distributor; the category row above
  // gives Category.
  "bar beer in a pack": {
    kind: "consumable",
    subtype: "bar",
    name: "Sample Lager",
    category: "Beer",
    unit: "case",
    consumable: {
      purchaseUnit: "case",
      packCount: 24,
      preferredVendor: "Sample Beer Distributor",
      preferredVendorId: vendorId,
    },
    bar: { brand: "Sample Lager" },
  },
  // "WINE (White)": category Wine, subcategory White; Unit "12pk".
  "bar wine with a type": {
    kind: "consumable",
    subtype: "bar",
    name: "Sample Pinot Grigio",
    category: "Wine",
    unit: "case",
    consumable: { purchaseUnit: "case", packCount: 12, preferredVendorId: vendorId },
    bar: { brand: "Sample Pinot Grigio", subcategory: "White" },
  },
  // Liquor: Unit blank (counted in bottles), Details a tier, "rail/mid" keeps
  // the first tier.
  "bar liquor with a tier": {
    kind: "consumable",
    subtype: "bar",
    name: "Sample Vodka",
    category: "Liquor",
    tier: "rail",
    description: "Tier: rail/mid",
    consumable: { purchaseUnit: "each", preferredVendorId: vendorId },
    bar: { brand: "Sample Vodka", subcategory: "Vodka" },
  },
  // Unit "(64 floz)": a container size, not a pack.
  "bar mixer in a container": {
    kind: "consumable",
    subtype: "bar",
    name: "Sample Cranberry Juice",
    category: "Mixers & Juices",
    consumable: { purchaseUnit: "each", eachSize: { quantity: 64, unit: "fl_oz" } },
    bar: { brand: "Sample Cranberry Juice" },
  },
  // Bar rows whose Qty is text ("2 case") still import, flagged for a count.
  "bar item with an unreadable count": {
    kind: "consumable",
    subtype: "bar",
    name: "Sample Cola",
    category: "Soft Beverages",
    description: "Sheet quantity: 2 case",
    flags: ["needs_count"],
    consumable: { purchaseUnit: "each" },
    bar: { brand: "Sample Cola" },
  },
  // Kitchen: Category, Subcategory, Item, Quantity, Cost/Unit, Distributor.
  "kitchen ingredient with category and subcategory": {
    kind: "consumable",
    subtype: "ingredient",
    name: "Sample Beef Chuck",
    category: "Sample Protein",
    subcategory: "Sample Beef & Lamb",
    unit: "lb",
    consumable: {
      purchaseUnit: "lb",
      unitCostCents: 899,
      preferredVendor: "Sample Food Distributor",
    },
  },
};

describe("inventory item model", () => {
  it.each(Object.entries(rows))("represents a %s row", (_shape, row) => {
    const parsed = itemInputSchema.safeParse(row);
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.data).toMatchObject(row);
  });

  it("represents every column the current files add", () => {
    const item = itemInputSchema.parse(
      rows["rental with category, subcategory, location, pull owner and cost"],
    );
    expect(item).toMatchObject({
      subcategory: "Sample Heating",
      pullOwner: "pull_lead",
      rental: { supplierId: vendorId, internalCostCents: 4000 },
    });
    expect(
      itemInputSchema.parse(rows["uncategorized row left with every flag"]).flags,
    ).toEqual(["needs_category", "needs_count", "needs_cost", "confirm_location"]);
  });

  it("leaves the new fields out when a save doesn't send them, to keep the stored values", () => {
    const item = itemInputSchema.parse({ kind: "service", name: "Sample Service", service: {} });
    expect(item.subcategory).toBeUndefined();
    expect(item.pullOwner).toBeUndefined();
    expect(item.flags).toBeUndefined();
  });

  it.each([
    ["a pull owner that isn't a role", { pullOwner: "intern" }],
    ["a flag that doesn't exist", { flags: ["needs_coffee"] }],
    ["a subcategory over 100 characters", { subcategory: "x".repeat(101) }],
  ])("rejects %s", (_name, extra) => {
    expect(
      itemInputSchema.safeParse({ kind: "rental", subtype: "equipment", name: "Chair", ...extra })
        .success,
    ).toBe(false);
  });

  it("defaults the optional fields", () => {
    const item = itemInputSchema.parse(rows["service row"]);
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
