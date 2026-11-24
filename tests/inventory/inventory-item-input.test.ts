import { describe, expect, it } from "vitest";
import { itemInputSchema } from "../../shared/inventory";
import {
  buildItemInput,
  initialItemFields,
  type ItemFields,
  type ItemFormState,
} from "../../src/features/inventory/inventory-item-input";

// FLOW-317 AC2: the item form's API input for each item kind.
const vendorId = "00000000-0000-4000-8000-0000000000a1";
const componentId = "00000000-0000-4000-8000-0000000000b1";
const sectionId = "00000000-0000-4000-8000-0000000000c1";

const state = (overrides: Partial<Omit<ItemFormState, "fields">> & { fields?: Partial<ItemFields> } = {}): ItemFormState => {
  const { fields, ...rest } = overrides;
  return {
    kind: "rental",
    subtype: "equipment",
    categoryId: "",
    typeId: "",
    active: true,
    quoted: false,
    includes: [],
    addons: [],
    housePick: false,
    allergens: [],
    rentalCostsVisible: true,
    costHidden: false,
    ...rest,
    fields: { ...initialItemFields(undefined), name: "Sample item", ...fields },
  };
};

describe("buildItemInput", () => {
  it("builds a rental with prices in cents, a sub-rental vendor and colors", () => {
    const input = buildItemInput(state({
      fields: {
        price: "12.5", internalCost: "4", replacementCost: "30", rentalVendorId: vendorId,
        vendorCost: "6.25", leadTimeDays: "3", colors: " White \n\nGold ", ratioQuantity: "2",
        bufferDaysBefore: "2", bufferDaysAfter: "0",
      },
    }));
    expect(input).toMatchObject({
      kind: "rental", subtype: "equipment", name: "Sample item", categoryId: null, typeId: null,
      ratio: { quantity: 2, basis: "per_guest" }, active: true,
      rental: {
        priceCents: 1250, internalCostCents: 400, replacementCostCents: 3000, vendorId,
        vendorCostCents: 625, leadTimeDays: 3, colors: ["White", "Gold"], components: [],
        bufferDaysBefore: 2, bufferDaysAfter: 0,
      },
    });
    expect(input).not.toHaveProperty("service");
    expect(input).not.toHaveProperty("consumable");
    expect(itemInputSchema.safeParse(input).success).toBe(true);
  });

  it("leaves rental costs out when the user can't see them and drops vendor fields when owned", () => {
    const input = buildItemInput(state({
      rentalCostsVisible: false,
      fields: { price: "", internalCost: "4", vendorCost: "6", leadTimeDays: "3" },
    }));
    expect(input.rental).toMatchObject({ priceCents: null, vendorId: null, leadTimeDays: null });
    expect(input.rental).not.toHaveProperty("internalCostCents");
    expect(input.rental).not.toHaveProperty("replacementCostCents");
    expect(input.rental).not.toHaveProperty("vendorCostCents");
    expect(input.ratio).toBeNull();
  });

  it("sends a decor rental's components without the service basis", () => {
    const input = buildItemInput(state({
      subtype: "decor",
      includes: [{ itemId: componentId, quantity: 2, basis: "per_event" }],
    }));
    expect(input.rental?.components).toEqual([{ itemId: componentId, quantity: 2 }]);
  });

  it("builds a priced service with includes and add-ons, and a quoted one without a price", () => {
    const includes = [{ itemId: componentId, quantity: 1, basis: "per_guest" as const }];
    const addons = [{ name: "Dessert bar", priceCents: 450 }];
    const priced = buildItemInput(state({
      kind: "service", subtype: "", includes, addons,
      fields: { price: "200", priceBasis: "per_guest" },
    }));
    expect(priced).toMatchObject({
      kind: "service", subtype: null,
      service: { priceCents: 20000, priceBasis: "per_guest", pricedByQuote: false, includes, addons },
    });
    expect(priced).not.toHaveProperty("rental");
    expect(itemInputSchema.safeParse(priced).success).toBe(true);
    const quoted = buildItemInput(state({ kind: "service", subtype: "", quoted: true, fields: { price: "200" } }));
    expect(quoted.service).toMatchObject({ priceCents: null, pricedByQuote: true });
  });

  it("builds a supply with its pack, each size, cost, vendor and storage", () => {
    const input = buildItemInput(state({
      kind: "consumable", subtype: "supply",
      fields: {
        purchaseUnit: "case", packCount: "12", eachSizeQuantity: "16", eachSizeUnit: "oz",
        unitCost: "24.99", preferredVendorId: vendorId, parLevel: "4", storageSectionId: sectionId, storageOrder: "3",
      },
    }));
    expect(input.consumable).toMatchObject({
      purchaseUnit: "case", packCount: 12, eachSize: { quantity: 16, unit: "oz" }, recipeUnit: null,
      unitCostCents: 2499, preferredVendorId: vendorId, parLevel: 4, storageSectionId: sectionId, storageOrder: 3,
    });
    expect(input).not.toHaveProperty("bar");
    expect(itemInputSchema.safeParse(input).success).toBe(true);
  });

  it("keeps an ingredient's allergens and leaves a hidden cost alone", () => {
    const input = buildItemInput(state({
      kind: "consumable", subtype: "ingredient", costHidden: true, allergens: ["milk"],
      fields: { unit: "lb", recipeUnit: "oz", unitCost: "9" },
    }));
    expect(input.consumable).toMatchObject({ allergens: ["milk"], recipeUnit: "oz", eachSize: null });
    expect(input.consumable).not.toHaveProperty("unitCostCents");
  });

  it("builds a bar item without storage and drops a subcategory its category doesn't have", () => {
    const input = buildItemInput(state({
      kind: "consumable", subtype: "bar", housePick: true,
      fields: { category: "Wine", subcategory: "Not a real subcategory", brand: "House red", container: "", storageSectionId: sectionId },
    }));
    expect(input.consumable).toMatchObject({ storageSectionId: null });
    expect(input.bar).toEqual({ brand: "House red", subcategory: "", container: null, housePick: true });
  });
});
