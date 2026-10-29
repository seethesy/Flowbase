import { describe, expect, it } from "vitest";
import {
  defaultDietaryTags,
  dietaryTagHints,
  lineCost,
  clientRecipe,
  clientRecipeSchema,
  recipeSchema,
  recipeCost,
  recipeInputSchema,
  scaleRecipe,
  type RecipeIngredient,
  type RecipeInput,
} from "../shared/recipes";
import {
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

describe("client recipe projection (FLOW-97 AC1)", () => {
  it("allowlists fields and drops all kitchen and financial data", () => {
    const dish = recipeSchema.parse({
      id: tuscanIds.chicken, name: "Tuscan Chicken", category: "Mains",
      description: "Creamy chicken", lines: [{
        id: tuscanIds.cream, itemId: tuscanIds.cream, ingredientName: "Heavy Cream",
        ingredientArchived: false, quantity: 1, unit: "cup", prepNote: "internal prep",
        enteredCostCents: 180, cost: { source: "entered", cents: 180, problem: null },
      }], steps: ["Secret method"], finishingNote: "Internal note",
      yield: { servings: 100, portionSize: "6 oz" }, allergens: ["Milk"], dietaryTags: [],
      cost: { batchCents: 180, perServingCents: 2, noCostLines: 0 }, costHidden: false,
      duplicates: [], active: true, archivedAt: null,
      createdAt: "2026-10-27T12:00:00Z", updatedAt: "2026-10-27T12:00:00Z",
    });
    const projected = clientRecipe(dish, "https://example.com/photo.jpg");
    expect(Object.keys(projected).sort()).toEqual(["allergens", "category", "description", "dietaryTags", "id", "ingredients", "name", "photo"]);
    expect(projected.ingredients).toEqual(["Heavy Cream"]);
    expect(clientRecipeSchema.parse(projected)).toEqual(projected);
    expect(clientRecipeSchema.safeParse({ ...projected, steps: dish.steps }).success).toBe(false);
    expect(JSON.stringify(projected)).not.toMatch(/internal prep|Secret method|Internal note|180|servings/);
    expect(clientRecipe(dish).photo).toBeNull();
  });
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
  it("sets them on the dish, empty by default", () => {
    expect(recipe()).toMatchObject({ allergens: ["Milk"], dietaryTags: [] });
    expect(recipe({ allergens: undefined })).toMatchObject({ allergens: [] });
    expect(
      recipe({ allergens: ["Milk", "Peanuts"], dietaryTags: ["Gluten-free"] }),
    ).toMatchObject({
      allergens: ["Milk", "Peanuts"],
      dietaryTags: ["Gluten-free"],
    });
  });

  // FLOW-218: the values come from the settings lists, which the API checks.
  it("takes a category, allergen or tag from any settings label, but not a blank one", () => {
    expect(
      recipeInputSchema.safeParse(
        tuscanChicken(tuscanIds, {
          category: "Brunch",
          allergens: ["Coconut"],
          dietaryTags: ["Nut-free"],
        }),
      ).success,
    ).toBe(true);
    for (const overrides of [
      { category: " " },
      { allergens: [""] },
      { dietaryTags: [" "] },
    ])
      expect(
        recipeInputSchema.safeParse(tuscanChicken(tuscanIds, overrides)).success,
      ).toBe(false);
  });

  it("keeps the hints of the built-in tags and has none for a tag added later", () => {
    expect(Object.keys(dietaryTagHints)).toEqual([...defaultDietaryTags]);
    expect(dietaryTagHints.Vegan).toBe("No ingredient contains meat.");
    expect(dietaryTagHints["Nut-free"]).toBeUndefined();
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
