import {
  consumableDetailsInputSchema,
  type ItemInput,
} from "../../shared/inventory";
import type { RecipeIngredient, RecipeInput } from "../../shared/recipes";

// Tuscan Chicken from the Master Recipe Book, as the recipe tickets describe it
// (FLOW-93/94/95/98/99): based off 100 servings, six ingredient lines, two of them
// with no quantity and no cost, and line costs of $50.00 + $1.80 + $1.10 + $1.25 =
// $54.15. The source CSV isn't in the repo, so the sixth ingredient's name and the
// method are stand-ins.
export const tuscanIngredients = {
  chicken: {
    kind: "consumable",
    subtype: "ingredient",
    name: "Chicken Breast",
    category: "Meat",
    unit: "each",
    consumable: {
      purchaseUnit: "lb",
      eachSize: { quantity: 8, unit: "oz" },
      recipeUnit: "each",
    },
  },
  cream: {
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
    },
  },
  tomatoes: {
    kind: "consumable",
    subtype: "ingredient",
    name: "Tomatoes",
    category: "Produce",
    unit: "lb",
    consumable: {
      purchaseUnit: "lb",
      recipeUnit: "oz",
    },
  },
  spinach: {
    kind: "consumable",
    subtype: "ingredient",
    name: "Spinach",
    category: "Produce",
    unit: "lb",
    consumable: {
      purchaseUnit: "lb",
      recipeUnit: "cup",
    },
  },
  seasoning: {
    kind: "consumable",
    subtype: "ingredient",
    name: "Italian Seasoning",
    category: "Dry Goods",
    unit: "oz",
    consumable: {
      purchaseUnit: "oz",
    },
  },
  saltAndPepper: {
    kind: "consumable",
    subtype: "ingredient",
    name: "Salt and Pepper",
    category: "Dry Goods",
    unit: "oz",
    consumable: {
      purchaseUnit: "oz",
    },
  },
} satisfies Record<string, ItemInput>;
export type TuscanIds = Record<keyof typeof tuscanIngredients, string>;

export const tuscanChicken = (
  ids: TuscanIds,
  overrides: Partial<RecipeInput> = {},
): RecipeInput => ({
  name: "Tuscan Chicken",
  category: "mains",
  lines: [
    { itemId: ids.chicken, quantity: 10, unit: "each", enteredCostCents: 5000 },
    { itemId: ids.cream, quantity: 1, unit: "cup", enteredCostCents: 180 },
    { itemId: ids.tomatoes, quantity: 5, unit: "oz", enteredCostCents: 110 },
    { itemId: ids.spinach, quantity: 3, unit: "cup", enteredCostCents: 125 },
    { itemId: ids.seasoning, enteredCostCents: null },
    { itemId: ids.saltAndPepper, enteredCostCents: null },
  ],
  steps: [
    "Season the chicken and sear until golden.",
    "Simmer the tomatoes, spinach and cream into a sauce.",
    "Return the chicken to the sauce and cook through.",
  ],
  finishingNote: "garnish with basil",
  yield: { servings: 100, portionSize: "" },
  allergens: ["milk"],
  ...overrides,
});

// Fixed ids for the shared calculations, where there is no database.
export const tuscanIds: TuscanIds = {
  chicken: "d1000000-0000-4000-8000-000000000001",
  cream: "d1000000-0000-4000-8000-000000000002",
  tomatoes: "d1000000-0000-4000-8000-000000000003",
  spinach: "d1000000-0000-4000-8000-000000000004",
  seasoning: "d1000000-0000-4000-8000-000000000005",
  saltAndPepper: "d1000000-0000-4000-8000-000000000006",
};
// The ingredients as the API returns them, with tuscanIds; unit costs are unset
// unless given.
export function tuscanCatalog(
  costs: Partial<Record<keyof TuscanIds, number>> = {},
): RecipeIngredient[] {
  return (Object.keys(tuscanIngredients) as (keyof TuscanIds)[]).map((key) =>
    asIngredient(tuscanIds[key], tuscanIngredients[key], costs[key]),
  );
}

export function asIngredient(
  id: string,
  input: ItemInput,
  unitCostCents: number | null = null,
): RecipeIngredient {
  const details = consumableDetailsInputSchema.parse(input.consumable);
  return {
    id,
    name: input.name,
    unit: input.unit ?? "each",
    consumable: {
      ...details,
      unitCostCents,
      costHidden: false,
      storageSectionName: null,
    },
  };
}
