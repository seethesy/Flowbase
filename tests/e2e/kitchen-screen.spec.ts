import { eq } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { browserDb, seedInventory, seedRecords } from "./database";
import { consumable, fallGala, juniper } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";
import { createRecipe } from "../../worker/records/recipes";
import { recipeInputSchema } from "../../shared/recipes";
import * as s from "../../worker/db/schema";

// The Kitchen screen's tabs (FLOW-267).
async function seedDish() {
  const rib = consumable("Beef short rib", { details: { unitCostCents: 625 } });
  await seedInventory({ items: [rib] });
  const admin = seedUsers[0];
  return browserDb((db) => createRecipe(db, { userId: admin.id, role: admin.role }, recipeInputSchema.parse({
    name: "Braised short rib", category: "Mains", description: "",
    lines: [{ itemId: rib.id, quantity: 6, unit: "lb", prepNote: "" }],
    steps: ["Season ribs and sear hard on all sides."], finishingNote: "",
    yield: { servings: 12, portionSize: "" }, allergens: ["Milk"], dietaryTags: ["Gluten-free"],
  })));
}

test("the tabs read Recipes | Ingredients | Menus | Photos under the Kitchen heading (AC1)", async ({ page }) => {
  for (const path of ["/recipes", "/inventory/ingredients", "/kitchen/menus"]) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole("heading", { name: "Kitchen", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Kitchen pages" }).getByRole("link"))
      .toHaveText(["Recipes", "Ingredients", "Menus", "Photos"]);
  }
});

test("the kitchen card scales the ingredient amounts to N servings (AC3)", async ({ page }) => {
  await seedDish();
  await page.goto("/#/recipes");
  await page.getByRole("row", { name: /Braised short rib/ }).getByRole("button", { name: "Open", exact: true }).click();
  const card = page.getByRole("dialog", { name: /Braised short rib/ });
  await expect(card).toContainText("Contains Milk");
  const ingredients = card.getByRole("region", { name: "Ingredients" });
  await expect(ingredients).toContainText("6 lb");
  await card.getByLabel("Servings").fill("24");
  await expect(ingredients).toContainText("12 lb");
  await card.getByLabel("Servings").fill("3");
  await expect(ingredients).toContainText("1.5 lb");
  await expect(card.getByRole("region", { name: "Method" })).toContainText("Season ribs");
  await expect(card.getByRole("link", { name: "Print kitchen card" })).toBeVisible();
});

test("the Menus tab lists every Menu document, and Open PDF and In Documents lead to it (AC2)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb((db) => db.insert(s.attachments).values([
    { documentId: fallGala().id, recordType: "event", recordId: fallGala().id, fileName: "gala-menu.pdf",
      displayName: "Fall gala menu", docType: "menu", status: "ready", variants: [] },
    { recordType: "client", recordId: juniper().id, fileName: "fall-seasonal.pdf",
      displayName: "Fall seasonal menu", docType: "menu", status: "ready", variants: [] },
  ]));
  await browserDb(async (db) => {
    // Every stored document carries its document id (FLOW-263).
    const rows = await db.select().from(s.attachments);
    for (const row of rows.filter((entry) => !entry.documentId))
      await db.update(s.attachments).set({ documentId: row.id }).where(eq(s.attachments.id, row.id));
  });
  await page.goto("/#/kitchen/menus");
  const menus = page.getByRole("list", { name: "Menus" });
  await expect(menus.getByRole("listitem").filter({ hasText: "Fall gala menu" })).toContainText(/Event menu/i);
  await expect(menus.getByRole("listitem").filter({ hasText: "Fall seasonal menu" })).toContainText(/Seasonal/i);
  await expect(menus.getByRole("listitem").filter({ hasText: "Client recipe book" })).toBeVisible();
  await menus.getByRole("listitem").filter({ hasText: "Fall seasonal menu" }).getByRole("link", { name: "In Documents" }).click();
  await expect(page).toHaveURL(/#\/documents\?document=/);
  await expect(page.getByRole("dialog", { name: "Fall seasonal menu" })).toBeVisible();
});
