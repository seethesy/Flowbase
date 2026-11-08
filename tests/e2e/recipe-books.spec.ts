import { databaseTest as test, expect, mockBrowserAuth } from "./auth-fixture";
import { browserDb, seedInventory } from "./database";
import { consumable } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";
import { createRecipe } from "../../worker/records/recipes";
import { recipeInputSchema } from "../../shared/recipes";

async function seedDishes(count = 1) {
  const chicken = consumable("Chicken Breast", { details: { unitCostCents: 400 } });
  await seedInventory({ items: [chicken] });
  const admin = seedUsers[0];
  return browserDb(async (db) => {
    const dishes = [];
    for (let i = 0; i < count; i++) dishes.push(await createRecipe(db, { userId: admin.id, role: admin.role, employmentType: admin.employmentType }, recipeInputSchema.parse({
      name: i === 0 ? "Tuscan Chicken" : `Dish ${i + 1}`,
      category: i === count - 1 && count > 1 ? "Sides" : "Mains",
      description: "A dish for your event", lines: [{ itemId: chicken.id, quantity: 10, unit: "each", prepNote: "Internal prep note" }],
      steps: ["Sear until golden."], finishingNote: "Internal finishing note",
      yield: { servings: 100, portionSize: "6 oz" }, allergens: ["Milk"], dietaryTags: ["Gluten-free"],
    })));
    return dishes;
  });
}

test("browses by category, ingredient, allergen and dietary tag and prints a kitchen card", async ({ page }) => {
  await mockBrowserAuth(page);
  const [dish] = await seedDishes();
  await page.goto("/#/recipes");
  await page.getByPlaceholder("Search recipes…").fill("chicken");
  await expect(page.getByRole("button", { name: "Tuscan Chicken", exact: true })).toBeVisible();
  await page.getByPlaceholder("Search recipes…").fill("breast");
  await page.getByLabel("Category", { exact: true }).selectOption("Mains");
  await page.getByLabel("Allergen", { exact: true }).selectOption("Milk");
  await page.getByLabel("Dietary tag", { exact: true }).selectOption("Vegan");
  await expect(page.getByText("0 recipes", { exact: true })).toBeVisible();
  await page.getByLabel("Dietary tag", { exact: true }).selectOption("Gluten-free");
  await page.getByRole("button", { name: "Tuscan Chicken", exact: true }).click();
  await page.getByRole("link", { name: "Kitchen card" }).click();
  await expect(page).toHaveURL(new RegExp(`/print/recipes/${dish.id}`));
  await expect(page.locator(".print-document")).toContainText("Sear until golden.");
  await expect(page.locator(".print-document")).toContainText("Chicken Breast — 10 each");
  await expect(page.locator(".print-document")).not.toContainText("$40");
  await expect(page.locator(".print-document")).not.toContainText("Batch cost");
  await page.evaluate(() => { window.print = () => { document.body.dataset.printed = "yes"; }; });
  await page.getByRole("button", { name: "Print or save as PDF" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-printed", "yes");
});

test("part-time Kitchen Staff reads the method with no recipe costs", async ({ page }) => {
  const user = seedUsers.find((user) => user.role === "kitchen_staff" && user.employmentType === "part_time")!;
  await mockBrowserAuth(page, { userId: user.id });
  const [dish] = await seedDishes();
  await page.goto(`/#/recipes/${dish.id}`);
  await expect(page.getByText("Sear until golden.", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cost", exact: true })).toHaveCount(0);
  await expect(page.getByText("$40.00", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "← Recipe book" }).click();
  await expect(page.getByRole("columnheader", { name: "Cost per serving" })).toHaveCount(0);
});

test("a salesperson selects ten dishes and prints a branded client PDF or category", async ({ page, isMobile }, testInfo) => {
  const user = seedUsers.find((user) => user.role === "salesperson" && user.employmentType === "part_time")!;
  await mockBrowserAuth(page, { userId: user.id });
  const dishes = await seedDishes(10);
  await page.goto("/#/recipes/client");
  await expect(page.getByRole("heading", { name: "Tuscan Chicken", exact: true })).toBeVisible();
  await expect(page.locator(".client-recipe-grid")).not.toContainText("Sear until golden.");
  await expect(page.locator(".client-recipe-grid")).not.toContainText("Internal");
  for (const dish of dishes) await page.getByRole("checkbox", { name: `Select ${dish.name}`, exact: true }).check();
  await page.getByRole("link", { name: "Print selected (10)" }).click();
  const printedDocument = page.locator(".print-document");
  await expect(printedDocument.locator("article")).toHaveCount(10);
  await expect(printedDocument.locator(".print-header strong")).not.toBeEmpty();
  await expect(printedDocument).not.toContainText("Sear until golden.");
  await expect(printedDocument).not.toContainText("Internal");
  await expect(printedDocument).not.toContainText("servings");
  await expect(printedDocument).not.toContainText("$40");
  await expect(printedDocument.locator("article").first()).toContainText("Chicken Breast");
  await page.evaluate(() => { window.print = () => { document.body.dataset.printed = "yes"; }; });
  await page.getByRole("button", { name: "Print or save as PDF" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-printed", "yes");
  if (!isMobile) {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    await testInfo.attach("client-recipe-book.pdf", { body: pdf, contentType: "application/pdf" });
  }
  await page.goto("/#/recipes/client");
  await page.getByLabel("Category", { exact: true }).selectOption("Sides");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("link", { name: "Print category" }).click();
  await expect(page.locator(".print-document article")).toHaveCount(1);
  await expect(page.locator(".print-document article")).toContainText("Dish 10");
});

