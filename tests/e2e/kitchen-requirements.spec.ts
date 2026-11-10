import { and, eq, isNull } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { consumable, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

test("editing a planned dish quantity changes ingredient requirements", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const chicken = consumable("Chicken breast");
  await seedInventory({ items: [chicken] });
  await browserDb(async (db) => {
    const [recipe] = await db.insert(s.recipes).values({ name: "Tuscan Chicken", category: "Mains", yieldServings: 10 }).returning();
    await db.insert(s.recipeLines).values({ recipeId: recipe.id, itemId: chicken.id, quantity: 1, unit: "each" });
    const [menu] = await db.insert(s.kitchenMenus).values({ eventId: fallGala().id }).returning();
    await db.insert(s.kitchenMenuLines).values({ menuId: menu.id, recipeId: recipe.id, course: "Mains", plannedQuantity: 120 });
  });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("heading", { name: "Kitchen menu" }).scrollIntoViewIfNeeded();
  const quantity = page.getByLabel("Planned quantity of Tuscan Chicken");
  await expect(quantity).toHaveValue("120");
  await quantity.fill("60");
  await quantity.blur();
  await expect(quantity).toHaveValue("60");
  await expect.poll(() => browserDb(async (db) => {
    const [row] = await db.select().from(s.eventRequirements)
      .where(and(eq(s.eventRequirements.eventId, fallGala().id), eq(s.eventRequirements.source, "menu"), isNull(s.eventRequirements.archivedAt)));
    return row?.quantity;
  })).toBe(6);
});
