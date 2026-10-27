import { test, expect } from "./auth-fixture";
import { consumableDetailsInputSchema } from "../../shared/inventory";
import { tuscanIngredients } from "../fixtures/tuscan-chicken";
import { seedInventory } from "./database";
import { consumable } from "./fixtures";

// The Tuscan Chicken ingredients in the catalog, with no unit costs yet.
const tuscanCatalogItems = () =>
  Object.values(tuscanIngredients).map((input) =>
    consumable(input.name, {
      unit: input.unit,
      category: input.category,
      details: {
        ...consumableDetailsInputSchema.parse(input.consumable),
        unitCostCents: null,
      },
    }),
  );

// FLOW-93/94/95/98: enter Tuscan Chicken, see its cost and allergens, scale it,
// then edit it.
test("creates, costs, scales and edits a recipe", async ({ page, isMobile }) => {
  await seedInventory({ items: tuscanCatalogItems() });
  await page.goto("/");
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Recipes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recipe book", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New Recipe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *", { exact: true }).fill("Tuscan Chicken");
  await dialog.getByLabel(/^Yield/).fill("100");
  const lines: [string, string, string][] = [
    ["Chicken Breast", "10", "50"],
    ["Heavy Cream", "1", "1.80"],
    ["Tomatoes", "5", "1.10"],
    ["Spinach", "3", "1.25"],
    ["Italian Seasoning", "", ""],
    ["Salt and Pepper", "", ""],
  ];
  for (const [index, [name, quantity, cost]] of lines.entries()) {
    await dialog.getByRole("button", { name: "Add ingredient" }).click();
    const line = dialog.getByRole("group", {
      name: `Ingredient line ${index + 1}`,
    });
    await line
      .getByLabel(`Ingredient ${index + 1}`, { exact: true })
      .selectOption({ label: name });
    if (quantity) await line.getByLabel(/^Quantity/).fill(quantity);
    if (cost) await line.getByLabel(/^Entered cost/).fill(cost);
  }
  // The unit comes from each ingredient's recipe unit.
  await expect(
    dialog
      .getByRole("group", { name: "Ingredient line 2" })
      .getByLabel("Unit", { exact: true }),
  ).toHaveValue("cup");
  await dialog
    .getByLabel(/^Steps/)
    .fill("1. Sear the chicken.\n2. Simmer the sauce.");
  await dialog.getByLabel(/^Finishing note/).fill("garnish with basil");
  await dialog.getByRole("button", { name: "Save recipe" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Tuscan Chicken", level: 1 }),
  ).toBeVisible();
  // FLOW-94 AC1/AC2: $54.15, $0.54 a serving, two lines with no cost.
  await expect(page.getByRole("row", { name: /^Batch cost \$54\.15/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Per serving \$0\.54/ })).toBeVisible();
  await expect(page.getByText("2 lines have no cost and count as $0.")).toBeVisible();
  await expect(page.getByText("As needed")).toHaveCount(2);
  // FLOW-95 AC1.
  const tags = page.locator("section", {
    has: page.getByRole("heading", { name: "Allergens and dietary tags" }),
  });
  await expect(tags.getByText("Milk", { exact: true })).toBeVisible();
  await expect(tags.getByText("Contains meat", { exact: true })).toBeVisible();
  const method = page.locator("section", {
    has: page.getByRole("heading", { name: "Method" }),
  });
  await expect(method.getByRole("listitem")).toHaveText([
    "Sear the chicken.",
    "Simmer the sauce.",
  ]);

  // FLOW-98 AC1.
  await page.getByLabel("Servings", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  const scaled = page.getByRole("table", { name: "Scaled ingredients" });
  await expect(
    scaled.getByRole("row", { name: "Chicken Breast 12 each 6 lb" }),
  ).toBeVisible();
  await expect(
    scaled.getByRole("row", { name: "Heavy Cream 1.2 cup 0.05 case" }),
  ).toBeVisible();

  // FLOW-95 AC3: an override is shown as one.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Override allergens").check();
  await dialog
    .getByRole("group", { name: "Allergen override" })
    .getByLabel("Tree nuts", { exact: true })
    .check();
  // FLOW-93 AC2: a recipe saves without a yield.
  await dialog.getByLabel(/^Yield/).fill("");
  await dialog.getByRole("button", { name: "Save recipe" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tags).toContainText("Milk, Tree nuts");
  await expect(tags.getByText("Override", { exact: true })).toBeVisible();
  await expect(tags.getByText("From the ingredients: Milk")).toBeVisible();
  await expect(page.getByRole("row", { name: /^Per serving Needs a yield/ })).toBeVisible();

  // FLOW-98 AC2: no yield, no quantities.
  await page.getByLabel("Servings", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "no yield" })).toBeVisible();

  await page.getByRole("link", { name: "← Recipe book" }).click();
  await expect(page.getByRole("button", { name: "Tuscan Chicken" })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Tuscan Chicken/ }),
  ).toContainText("No yield");
});
