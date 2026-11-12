import { eq } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { fallGala, juniper, consumable, defaultSections } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import * as s from "../../worker/db/schema";

test("starting planning shows every step progress and creates a BEO", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("button", { name: "Start planning", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Create the BEO draft")).toBeVisible();
  await expect(page.getByText("Refresh the calendar")).toBeVisible();
  await browserDb(async (db) => {
    const registry = createJobRegistry();
    await runDueJobs(db, registry, { maxAttempts: 1 });
    await runDueJobs(db, registry, { maxAttempts: 1 });
  });
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.getByText("Planning is complete.")).toBeVisible();
  expect(await browserDb(async (db) => db.select().from(s.beos).where(eq(s.beos.eventId, fallGala().id)))).toHaveLength(1);
});

test("pull lines can be checked off and given a section on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb(async (db) => {
    const [list] = await db.insert(s.pullLists).values({ eventId: fallGala().id }).returning();
    await db.insert(s.pullListLines).values([
      { pullListId: list.id, group: "decor", name: "Lantern", quantity: 2 },
      { pullListId: list.id, group: "decor", name: "Vase", quantity: null },
    ]);
  });
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(page.getByText("Readiness check: Missing schedule — set the pull date, time and puller.")).toBeVisible();
  await page.getByRole("combobox", { name: "Section of Lantern" }).selectOption(defaultSections[0].id);
  await expect(page.getByRole("combobox", { name: "Section of Lantern" })).toHaveValue(defaultSections[0].id);
  await page.getByRole("combobox", { name: "Status of Lantern" }).selectOption("pulled");
  await expect(page.getByRole("combobox", { name: "Status of Lantern" })).toHaveValue("pulled");
  await expect(page.getByText("Production list: pull quantity TBD for Vase.")).toBeVisible();
});

test("kitchen dishes open their method and scaled ingredients and prep can be assigned", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const chicken = consumable("Chicken breast");
  await seedInventory({ items: [chicken] });
  await browserDb(async (db) => {
    const [recipe] = await db.insert(s.recipes).values({ name: "Tuscan Chicken", category: "Mains", yieldServings: 10,
      steps: ["Roast the chicken."] }).returning();
    await db.insert(s.recipeLines).values({ recipeId: recipe.id, itemId: chicken.id, quantity: 1, unit: "each" });
    const [menu] = await db.insert(s.kitchenMenus).values({ eventId: fallGala().id }).returning();
    await db.insert(s.kitchenMenuLines).values({ menuId: menu.id, recipeId: recipe.id, course: "Mains", plannedQuantity: 120 });
  });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("textbox", { name: "Kitchen task title" }).fill("Prep chicken");
  await page.getByRole("combobox", { name: "Kitchen task assignee" }).selectOption({ label: "Test Admin" });
  await page.getByRole("button", { name: "Assign prep" }).click();
  await expect(page.getByText("Prep chicken").locator("..")).toContainText("Test Admin");
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.body.classList.add("printing-kitchen-sheet"));
  await expect(page.getByRole("article", { name: "Kitchen sheet" })).toHaveCSS("display", "block");
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => document.body.classList.remove("printing-kitchen-sheet"));
  await page.getByRole("link", { name: "Method and ingredients for 120 servings" }).click();
  await expect(page.getByText("Roast the chicken.")).toBeVisible();
  await expect(page.getByRole("table", { name: "Scaled ingredients" })).toContainText("Chicken breast");
});
