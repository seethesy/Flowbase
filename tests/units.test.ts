import { describe, expect, it } from "vitest";
import {
  compatibleUnits,
  convert,
  orderQuantity,
  type Unit,
} from "../shared/units";
import { recipeUnitProblem } from "../shared/inventory";

// FLOW-51: the conversion table every costing and ordering path relies on.
const value = (quantity: number, from: Unit, to: Unit, item = {}) => {
  const result = convert(quantity, from, to, item);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

describe("standard conversions", () => {
  it.each<[number, Unit, Unit, number]>([
    // AC1
    [3, "cup", "fl_oz", 24],
    [2, "lb", "oz", 32],
    [1, "tbsp", "tsp", 3],
    [1, "cup", "tbsp", 16],
    [1, "qt", "cup", 4],
    [1, "gal", "qt", 4],
    [1, "l", "ml", 1000],
    [1, "kg", "g", 1000],
    [1, "lb", "g", 453.59237],
    [1, "fl_oz", "ml", 29.57353],
    [2, "dozen", "each", 24],
    [6, "each", "dozen", 0.5],
    [24, "fl_oz", "cup", 3],
  ])("%d %s is %d %s", (quantity, from, to, expected) =>
    expect(value(quantity, from, to)).toBeCloseTo(expected, 4),
  );

  it("returns exact values without float noise", () => {
    expect(value(3, "cup", "fl_oz")).toBe(24);
    expect(value(2, "lb", "oz")).toBe(32);
  });
});

describe("can't convert", () => {
  it("each → oz without a per-item conversion (AC2)", () => {
    expect(convert(1, "each", "oz")).toEqual({
      ok: false,
      reason: "cannot_convert",
      message: "Can't convert each to oz for this item.",
    });
  });
  it("weight ↔ volume, even with a count conversion of one of them", () => {
    expect(convert(1, "lb", "cup").ok).toBe(false);
    expect(
      convert(1, "lb", "cup", { eachSize: { quantity: 8, unit: "oz" } }).ok,
    ).toBe(false);
  });
  it("a case without a pack count", () => {
    expect(convert(1, "case", "each").ok).toBe(false);
  });
});

describe("per-item conversions", () => {
  const chicken = { eachSize: { quantity: 8, unit: "oz" as const } };
  const wine = {
    packCount: 12,
    eachSize: { quantity: 750, unit: "ml" as const },
  };
  it("converts count ↔ weight with the item's size", () => {
    expect(value(3, "each", "oz", chicken)).toBe(24);
    expect(value(2, "lb", "each", chicken)).toBe(4);
  });
  it("converts a case of 12 × 750 ml", () => {
    expect(value(1, "case", "each", wine)).toBe(12);
    expect(value(1, "case", "l", wine)).toBe(9);
    expect(value(4.5, "l", "case", wine)).toBe(0.5);
  });
  it("lists the units an item can be measured in", () => {
    expect(compatibleUnits("each")).toEqual(["each", "dozen"]);
    expect(compatibleUnits("each", wine)).toContain("fl_oz");
    expect(compatibleUnits("each", wine)).not.toContain("oz");
  });
});

describe("order quantities", () => {
  it("rounds up to whole purchase units (AC3)", () => {
    expect(orderQuantity(30, "oz", "lb")).toEqual({ ok: true, value: 2 });
    expect(orderQuantity(13, "each", "case", { packCount: 12 })).toEqual({
      ok: true,
      value: 2,
    });
    expect(orderQuantity(12, "each", "case", { packCount: 12 })).toEqual({
      ok: true,
      value: 1,
    });
    // 3 cups is exactly 24 fl oz: no extra unit from float noise.
    expect(orderQuantity(3, "cup", "fl_oz")).toEqual({ ok: true, value: 24 });
    expect(orderQuantity(0, "lb", "lb")).toEqual({ ok: true, value: 0 });
  });
  it("passes on can't convert instead of guessing", () => {
    expect(orderQuantity(5, "each", "lb").ok).toBe(false);
  });
});

describe("ingredient units (FLOW-81)", () => {
  // Cream: bought by the case of 6 × 1 qt, counted in quarts, used by the cup.
  const cream = {
    unit: "qt" as const,
    consumable: {
      purchaseUnit: "case" as const,
      packCount: 6,
      eachSize: { quantity: 1, unit: "qt" as const },
    },
  };
  it("converts quarts and cups both ways (AC1)", () => {
    expect(value(1, "qt", "cup")).toBe(4);
    expect(value(4, "cup", "qt")).toBe(1);
    expect(value(1, "case", "cup", cream.consumable)).toBe(24);
    expect(value(24, "cup", "case", cream.consumable)).toBe(1);
  });
  it("accepts a recipe unit the ingredient converts to", () => {
    expect(recipeUnitProblem(cream, "cup")).toBeNull();
    expect(recipeUnitProblem(cream, "tbsp")).toBeNull();
  });
  it("flags a recipe unit with no conversion (AC2)", () => {
    expect(recipeUnitProblem(cream, "lb")).toBe(
      "Can't convert lb to case for this item.",
    );
    const breast = {
      unit: "each" as const,
      consumable: {
        purchaseUnit: "lb" as const,
        packCount: null,
        eachSize: null,
      },
    };
    expect(recipeUnitProblem(breast, "oz")).toBe(
      "Can't convert oz to each for this item.",
    );
    expect(
      recipeUnitProblem(
        {
          ...breast,
          consumable: {
            ...breast.consumable,
            eachSize: { quantity: 8, unit: "oz" },
          },
        },
        "oz",
      ),
    ).toBeNull();
  });
});
