import { describe, expect, it } from "vitest";
import {
  lineCost,
  recipeCost,
  recipeInputSchema,
  recipeTags,
  scaleRecipe,
  type RecipeIngredient,
  type RecipeInput,
} from "../shared/recipes";
import {
  asIngredient,
  tuscanCatalog,
  tuscanChicken,
  tuscanIds,
} from "./fixtures/tuscan-chicken";

const recipe = (overrides: Partial<RecipeInput> = {}) =>
  recipeInputSchema.parse(tuscanChicken(tuscanIds, overrides));
const byId = (catalog: RecipeIngredient[]) =>
  new Map(catalog.map((item) => [item.id, item]));
const costsOf = (
  catalog: RecipeIngredient[],
  overrides: Partial<RecipeInput> = {},
) => {
  const ingredients = byId(catalog);
  return recipe(overrides).lines.map((line) =>
    lineCost(
      {
        quantity: line.quantity,
        unit: line.unit,
        enteredCostCents: line.enteredCostCents ?? null,
      },
      ingredients.get(line.itemId),
    ),
  );
};
const peanuts = asIngredient("peanuts", {
  kind: "consumable",
  subtype: "ingredient",
  name: "Peanuts",
  consumable: { purchaseUnit: "lb", allergens: ["peanuts"] },
});

describe("recipe record (FLOW-93)", () => {
  it("takes Tuscan Chicken with all six lines, two without a quantity (AC1)", () => {
    const parsed = recipe();
    expect(parsed.lines).toHaveLength(6);
    expect(parsed.lines.filter((line) => line.quantity === null)).toHaveLength(2);
    expect(parsed.finishingNote).toBe("garnish with basil");
  });

  it("saves a recipe with no yield (AC2)", () => {
    expect(recipe({ yield: null }).yield).toBeNull();
  });

  it("needs a name, a known category and a unit for each quantity", () => {
    const cases: [Partial<RecipeInput>, string][] = [
      [{ name: " " }, "Name is required."],
      [{ yield: { servings: 0 } }, "Enter servings above zero."],
      [
        { lines: [{ itemId: tuscanIds.chicken, quantity: 2, unit: null }] },
        "Pick a unit for the quantity.",
      ],
    ];
    for (const [input, message] of cases) {
      const parsed = recipeInputSchema.safeParse(
        tuscanChicken(tuscanIds, input),
      );
      expect(parsed.error?.issues[0]?.message).toBe(message);
    }
    expect(
      recipeInputSchema.safeParse({ name: "Soup", category: "soups" }).success,
    ).toBe(false);
  });
});

describe("recipe costing (FLOW-94)", () => {
  it("costs Tuscan Chicken at $54.15, $0.54 a serving (AC1, AC4)", () => {
    const costs = costsOf(tuscanCatalog());
    expect(costs.map((cost) => cost.source)).toEqual([
      "entered",
      "entered",
      "entered",
      "entered",
      "none",
      "none",
    ]);
    expect(recipeCost(costs, 100)).toEqual({
      batchCents: 5415,
      perServingCents: 54,
      noCostLines: 2,
    });
  });

  it("flags the two lines with no cost and counts them as $0 (AC2)", () => {
    const costs = costsOf(tuscanCatalog());
    expect(costs.slice(4)).toEqual([
      { source: "none", cents: 0, problem: null },
      { source: "none", cents: 0, problem: null },
    ]);
  });

  it("switches a line to calculated once its ingredient has a cost (AC3)", () => {
    // $4.00 a pound; 10 breasts at about 8 oz each are 5 lb.
    const costs = costsOf(tuscanCatalog({ chicken: 400, cream: 2400 }));
    expect(costs[0]).toEqual({ source: "calculated", cents: 2000, problem: null });
    // A cup of cream is 1/24 of a case of six quarts.
    expect(costs[1]).toEqual({ source: "calculated", cents: 100, problem: null });
    expect(recipeCost(costs, 100).batchCents).toBe(2000 + 100 + 110 + 125);
  });

  it("keeps the entered cost when the unit can't be converted", () => {
    // Spinach is entered in cups but bought by the pound.
    const costs = costsOf(tuscanCatalog({ spinach: 300 }));
    expect(costs[3]).toEqual({
      source: "entered",
      cents: 125,
      problem: "Can't convert cup to lb for this item.",
    });
  });

  it("has no per-serving cost without a yield", () => {
    expect(recipeCost(costsOf(tuscanCatalog()), null).perServingCents).toBeNull();
  });
});

describe("allergens and dietary tags (FLOW-95)", () => {
  const none = { allergenOverride: null, dietaryOverride: null };

  it("shows Milk and contains meat on Tuscan Chicken (AC1)", () => {
    const tags = recipeTags(tuscanCatalog(), none);
    expect(tags.allergens).toEqual(["milk"]);
    expect(tags.dietaryTags).toEqual(["contains_meat"]);
    expect(tags.unverifiedIngredients).toEqual([]);
  });

  it("adds Peanuts when a peanut ingredient is added (AC2)", () => {
    const tags = recipeTags([...tuscanCatalog(), peanuts], none);
    expect(tags.allergens).toEqual(["milk", "peanuts"]);
  });

  it("shows a manual override next to what was derived (AC3)", () => {
    const tags = recipeTags(tuscanCatalog(), {
      allergenOverride: ["milk", "tree_nuts"],
      dietaryOverride: [],
    });
    expect(tags.allergens).toEqual(["milk", "tree_nuts"]);
    expect(tags.derivedAllergens).toEqual(["milk"]);
    expect(tags.allergenOverride).toEqual(["milk", "tree_nuts"]);
    expect(tags.dietaryTags).toEqual([]);
    expect(tags.derivedDietaryTags).toEqual(["contains_meat"]);
  });

  it("gives a free-from tag only when every ingredient has it", () => {
    const veg = tuscanCatalog().filter(
      (item) => item.id !== tuscanIds.chicken,
    );
    expect(recipeTags(veg, none).dietaryTags).toEqual([
      "vegetarian",
      "gluten_free",
    ]);
    expect(recipeTags([], none).dietaryTags).toEqual([]);
  });

  it("flags ingredients with no allergen information", () => {
    const unchecked = asIngredient("garlic", {
      kind: "consumable",
      subtype: "ingredient",
      name: "Garlic",
      consumable: { purchaseUnit: "lb" },
    });
    expect(
      recipeTags([...tuscanCatalog(), unchecked], none).unverifiedIngredients,
    ).toEqual(["Garlic"]);
  });
});

describe("recipe scaling (FLOW-98)", () => {
  const scale = (servings: number, overrides: Partial<RecipeInput> = {}) => {
    const parsed = recipe(overrides);
    return scaleRecipe(
      { yield: parsed.yield, lines: parsed.lines },
      tuscanCatalog(),
      servings,
    );
  };

  it("scales Tuscan Chicken to 120: 12 breasts and 1.2 cups of cream (AC1)", () => {
    const result = scale(120);
    if (!result.ok) throw new Error(result.message);
    const [chicken, cream, tomatoes, spinach, seasoning] = result.lines;
    expect(chicken).toMatchObject({
      quantity: 12,
      unit: "each",
      purchaseQuantity: 6,
      purchaseUnit: "lb",
    });
    expect(cream).toMatchObject({
      quantity: 1.2,
      unit: "cup",
      purchaseQuantity: 0.05,
      purchaseUnit: "case",
    });
    expect(tomatoes).toMatchObject({ quantity: 6, purchaseQuantity: 0.375 });
    expect(spinach).toMatchObject({
      quantity: 3.6,
      purchaseQuantity: null,
      problem: "Can't convert cup to lb for this item.",
    });
    expect(seasoning).toMatchObject({ asNeeded: true, quantity: null });
    expect(result.totals).toEqual([
      { itemId: tuscanIds.chicken, ingredientName: "Chicken Breast", quantity: 6, unit: "lb" },
      { itemId: tuscanIds.cream, ingredientName: "Heavy Cream", quantity: 0.05, unit: "case" },
      { itemId: tuscanIds.tomatoes, ingredientName: "Tomatoes", quantity: 0.375, unit: "lb" },
    ]);
  });

  it("scales down and rounds countable units up (AC3)", () => {
    const result = scale(15);
    if (!result.ok) throw new Error(result.message);
    expect(result.lines[0]).toMatchObject({ quantity: 2, unit: "each" });
    expect(result.lines[1]).toMatchObject({ quantity: 0.15, unit: "cup" });
  });

  it("keeps exact whole units whole", () => {
    const result = scale(100);
    if (!result.ok) throw new Error(result.message);
    expect(result.lines[0].quantity).toBe(10);
  });

  it("returns no yield instead of quantities (AC2)", () => {
    expect(scale(120, { yield: null })).toMatchObject({
      ok: false,
      reason: "no_yield",
    });
  });
});
