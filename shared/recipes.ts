import { z } from "zod";
import { conversionsOf, type InventoryItem } from "./inventory";
import { id, text, timestamp } from "./schema-primitives";
import { convert, unitSchema, units, type Unit } from "./units";

// Recipe book (FLOW-93 dish record, FLOW-94 costing, FLOW-95 allergens and
// dietary tags, FLOW-98 scaling), shared by the API and the app. Costs and scaled
// quantities are worked out from the ingredients each time a recipe is read, so a
// changed ingredient cost shows on every dish at once. Allergens and dietary tags
// are set on the dish itself, not on its ingredients.
const cents = z.number().int().min(0).max(100_000_000);

// Categories, allergens and dietary tags are the settings lists recipe_category,
// allergen and dietary_tag (FLOW-218), changed in Settings without a deploy. A dish
// stores the label it was saved with, so archiving a value never changes an old dish.
export const defaultRecipeCategories = [
  "Appetizers",
  "Mains",
  "Sides",
  "Desserts",
  "Drinks",
  "Additional items",
] as const;
export const defaultDietaryTags = [
  "Vegan",
  "Vegetarian",
  "Gluten-free",
  "Dairy-free",
] as const;
// What each built-in tag promises, shown where tags are picked. A tag added in
// Settings has no hint.
export const dietaryTagHints: Readonly<Record<string, string>> = {
  Vegan: "No ingredient contains meat.",
  Vegetarian: "No meat or fish.",
  "Gluten-free": "No ingredient contains gluten.",
  "Dairy-free": "No milk or milk products.",
};

// One value from a settings list. The API checks it against the list.
const listLabel = text(100).min(1, "Pick a value.");
// The Master Recipe Book is "based off 100 servings"; its import (FLOW-99) gives
// recipes this yield.
export const IMPORTED_RECIPE_SERVINGS = 100;

export const recipeLineInputSchema = z
  .object({
    // A stored line's id keeps it (and its entered cost) on update.
    id: id.optional(),
    // An ingredient from the catalog (FLOW-81).
    itemId: id,
    // Optional: the recipe book has lines like "Italian Seasoning" with no amount.
    quantity: z.number().finite().positive().max(1_000_000).nullable().default(null),
    unit: unitSchema.nullable().default(null),
    prepNote: text(500).default(""),
    // The typed line cost (FLOW-94). FT+ only (F-01-04): omitted keeps the stored
    // cost.
    enteredCostCents: cents.nullable().optional(),
  })
  .refine((line) => line.quantity === null || line.unit !== null, {
    message: "Pick a unit for the quantity.",
    path: ["unit"],
  });
export type RecipeLineInput = z.input<typeof recipeLineInputSchema>;

const yieldSchema = z.object({
  servings: z.number().finite().positive("Enter servings above zero.").max(100_000),
  // e.g. "6 oz".
  portionSize: text(100).default(""),
});

export const recipeInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  category: listLabel,
  description: text(5000).default(""),
  lines: z.array(recipeLineInputSchema).max(200).default([]),
  // The numbered method, in order.
  steps: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  // e.g. "garnish with microgreens".
  finishingNote: text(1000).default(""),
  // Optional (FLOW-93 AC2); a dish with no yield can't be scaled (FLOW-98).
  yield: yieldSchema.nullable().default(null),
  // Set by hand on the dish (FLOW-95).
  allergens: z.array(listLabel).max(20).default([]),
  dietaryTags: z.array(listLabel).max(20).default([]),
  active: z.boolean().default(true),
});
export type RecipeInput = z.input<typeof recipeInputSchema>;
export type RecipeInputParsed = z.output<typeof recipeInputSchema>;

// ---- Costing (FLOW-94) ----

export const costSourceSchema = z.enum(["calculated", "entered", "none"]);
export type LineCostSource = z.infer<typeof costSourceSchema>;
export const lineCostSourceLabels: Record<LineCostSource, string> = {
  calculated: "Calculated",
  entered: "Entered",
  none: "No cost",
};
export const lineCostSchema = z.object({
  source: costSourceSchema,
  // A line with no cost counts as $0.
  cents: z.number().int(),
  // Why the cost couldn't be calculated, when the ingredient has a cost.
  problem: z.string().nullable(),
});
export type LineCost = z.infer<typeof lineCostSchema>;
export const recipeCostSchema = z.object({
  batchCents: z.number().int(),
  // null without a yield.
  perServingCents: z.number().int().nullable(),
  noCostLines: z.number().int(),
});
export type RecipeCost = z.infer<typeof recipeCostSchema>;

// What the calculations need from an ingredient: the catalog item as the API
// returns it.
export type RecipeIngredient = Pick<
  InventoryItem,
  "id" | "name" | "unit" | "consumable"
>;
type CostLine = {
  quantity: number | null;
  unit: Unit | null;
  enteredCostCents: number | null;
};

// Calculated = quantity × the ingredient's unit cost, converted to its purchase
// unit; otherwise the entered cost; otherwise "no cost" at $0. Integer cents.
export function lineCost(
  line: CostLine,
  ingredient: RecipeIngredient | undefined,
): LineCost {
  const c = ingredient?.consumable;
  let problem: string | null = null;
  if (line.quantity !== null && line.unit && c && c.unitCostCents !== null) {
    const converted = convert(
      line.quantity,
      line.unit,
      c.purchaseUnit,
      conversionsOf(c),
    );
    if (converted.ok)
      return {
        source: "calculated",
        cents: Math.round(converted.value * c.unitCostCents),
        problem: null,
      };
    problem = converted.message;
  }
  if (line.enteredCostCents !== null)
    return { source: "entered", cents: line.enteredCostCents, problem };
  return { source: "none", cents: 0, problem };
}

// Batch cost is the sum of the line costs; per serving divides by the yield.
export function recipeCost(
  lineCosts: LineCost[],
  servings: number | null,
): RecipeCost {
  const batchCents = lineCosts.reduce((sum, cost) => sum + cost.cents, 0);
  return {
    batchCents,
    perServingCents: servings ? Math.round(batchCents / servings) : null,
    noCostLines: lineCosts.filter((cost) => cost.source === "none").length,
  };
}

// ---- The recipe as the API returns it ----

export const recipeLineSchema = z.object({
  id,
  itemId: id,
  ingredientName: z.string(),
  ingredientArchived: z.boolean(),
  quantity: z.number().nullable(),
  unit: unitSchema.nullable(),
  prepNote: z.string(),
  // null, with the recipe's costHidden, when the caller isn't FT+.
  enteredCostCents: z.number().int().nullable(),
  cost: lineCostSchema.nullable(),
});
export type RecipeLine = z.infer<typeof recipeLineSchema>;
export const recipeSchema = z.object({
  id,
  name: z.string(),
  category: z.string(),
  description: z.string(),
  lines: z.array(recipeLineSchema),
  steps: z.array(z.string()),
  finishingNote: z.string(),
  yield: z.object({ servings: z.number(), portionSize: z.string() }).nullable(),
  allergens: z.array(z.string()),
  dietaryTags: z.array(z.string()),
  // null, with costHidden, when the caller isn't FT+ (F-01-04).
  cost: recipeCostSchema.nullable(),
  costHidden: z.boolean(),
  // Live recipes with the same name in the same category (FLOW-93): flagged, not
  // blocked.
  duplicates: z.array(z.object({ id, name: z.string() })),
  active: z.boolean(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Recipe = z.infer<typeof recipeSchema>;

// FLOW-97: an allowlist, shared by the client view and printed book. Never
// spread a recipe into this projection: new internal fields must stay internal.
export const clientRecipeSchema = recipeSchema.pick({
  id: true, name: true, category: true, description: true,
  allergens: true, dietaryTags: true,
}).extend({
  ingredients: z.array(z.string()),
  photo: z.string().url().nullable(),
}).strict();
export type ClientRecipe = z.infer<typeof clientRecipeSchema>;
export function clientRecipe(recipe: Recipe, photo: string | null = null): ClientRecipe {
  return {
    id: recipe.id, name: recipe.name, category: recipe.category,
    description: recipe.description, allergens: recipe.allergens,
    dietaryTags: recipe.dietaryTags,
    ingredients: [...new Set(recipe.lines.map((line) => line.ingredientName))],
    photo,
  };
}

// ---- Scaling (FLOW-98) ----

export const scaledLineSchema = z.object({
  lineId: id.optional(),
  itemId: id,
  ingredientName: z.string(),
  prepNote: z.string(),
  // A line with no quantity is listed "as needed" and left out of the totals.
  asNeeded: z.boolean(),
  // In the recipe's unit; countable units are rounded up to whole units.
  quantity: z.number().nullable(),
  unit: unitSchema.nullable(),
  // The same amount in the ingredient's purchase unit, not rounded to packs (that
  // happens on the order list, F-07-07).
  purchaseQuantity: z.number().nullable(),
  purchaseUnit: unitSchema.nullable(),
  problem: z.string().nullable(),
});
export type ScaledLine = z.infer<typeof scaledLineSchema>;
export const scaledRecipeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    servings: z.number(),
    yieldServings: z.number(),
    lines: z.array(scaledLineSchema),
    // Per ingredient, in its purchase unit, without the "as needed" lines.
    totals: z.array(
      z.object({
        itemId: id,
        ingredientName: z.string(),
        quantity: z.number(),
        unit: unitSchema,
      }),
    ),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.literal("no_yield"),
    message: z.string(),
  }),
]);
export type ScaledRecipe = z.infer<typeof scaledRecipeSchema>;
export const scaleQuerySchema = z.coerce
  .number()
  .finite()
  .positive("Enter servings above zero.")
  .max(100_000);

// Four decimal places, as quantities are stored. Countable units round up, with a
// little slack so 12.000000001 breasts stays 12.
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const roundUp = (value: number) => Math.ceil(round4(value));

export function scaleRecipe(
  recipe: {
    yield: { servings: number } | null;
    lines: {
      id?: string;
      itemId: string;
      quantity: number | null;
      unit: Unit | null;
      prepNote: string;
    }[];
  },
  ingredients: RecipeIngredient[],
  servings: number,
): ScaledRecipe {
  if (!recipe.yield)
    return {
      ok: false,
      reason: "no_yield",
      message: "This dish has no yield, so it can't be scaled. Add servings first.",
    };
  const factor = servings / recipe.yield.servings;
  const byId = new Map(ingredients.map((item) => [item.id, item]));
  const lines = recipe.lines.map((line): ScaledLine => {
    const ingredient = byId.get(line.itemId);
    const c = ingredient?.consumable ?? null;
    const base = {
      lineId: line.id,
      itemId: line.itemId,
      ingredientName: ingredient?.name ?? "Unknown ingredient",
      prepNote: line.prepNote,
    };
    if (line.quantity === null || !line.unit)
      return {
        ...base,
        asNeeded: true,
        quantity: null,
        unit: null,
        purchaseQuantity: null,
        purchaseUnit: null,
        problem: null,
      };
    const scaled = line.quantity * factor;
    const quantity =
      units[line.unit].dimension === "count" ? roundUp(scaled) : round4(scaled);
    const purchase = c
      ? convert(quantity, line.unit, c.purchaseUnit, conversionsOf(c))
      : null;
    return {
      ...base,
      asNeeded: false,
      quantity,
      unit: line.unit,
      purchaseQuantity: purchase?.ok ? round4(purchase.value) : null,
      purchaseUnit: c?.purchaseUnit ?? null,
      problem:
        purchase && !purchase.ok
          ? purchase.message
          : c
            ? null
            : "This line's ingredient isn't in the catalog.",
    };
  });
  const totals = new Map<
    string,
    { itemId: string; ingredientName: string; quantity: number; unit: Unit }
  >();
  for (const line of lines) {
    if (line.purchaseQuantity === null || !line.purchaseUnit) continue;
    const total = totals.get(line.itemId);
    if (total) total.quantity = round4(total.quantity + line.purchaseQuantity);
    else
      totals.set(line.itemId, {
        itemId: line.itemId,
        ingredientName: line.ingredientName,
        quantity: line.purchaseQuantity,
        unit: line.purchaseUnit,
      });
  }
  return {
    ok: true,
    servings,
    yieldServings: recipe.yield.servings,
    lines,
    totals: [...totals.values()],
  };
}
