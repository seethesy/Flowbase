import { eq } from "drizzle-orm";
import type { Locator } from "@playwright/test";
import { test, expect } from "../auth-fixture";
import { choose } from "../dropdown";
import { browserDb, seedInventory, seedRecords } from "../database";
import { consumable, defaultSections, fallGala, juniper } from "../fixtures";
import { seedUsers } from "../../../worker/db/seed";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { createRecipe } from "../../../worker/records/kitchen/recipes";
import { recipeInputSchema } from "../../../shared/recipes";
import * as s from "../../../worker/db/schema";
import { PDFDocument } from "pdf-lib";

// FLOW-353: these tables have no Open column; a click on a plain cell opens the row.
async function cellUnder(row: Locator, header: string) {
  await expect(row).toBeVisible();
  const headers = (await row.locator("xpath=ancestor::table[1]").locator("thead th").allTextContents()).map((text) => text.trim());
  expect(headers).not.toContain("Open");
  expect(headers).toContain(header);
  return row.getByRole("cell").nth(headers.indexOf(header));
}

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

test("the tabs read Overview | Recipes | Ingredients | Menus | Photos under the Kitchen heading (AC1; FLOW-293 AC1)", async ({ page }) => {
  for (const path of ["/kitchen/overview", "/recipes", "/kitchen/ingredients", "/kitchen/menus"]) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole("heading", { name: "Kitchen", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Kitchen pages" }).getByRole("link"))
      .toHaveText(["Overview", "Recipes", "Ingredients", "Menus", "Photos"]);
  }
});

test("the kitchen card scales the ingredient amounts to N servings (AC3)", async ({ page }) => {
  await seedDish();
  await page.goto("/#/recipes");
  await (await cellUnder(page.getByRole("row", { name: /Braised short rib/ }), "Updated")).click();
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
  await menus.getByRole("listitem").filter({ hasText: "Fall seasonal menu" }).getByRole("link", { name: "In Documents" }).click();
  await expect(page).toHaveURL(/#\/documents\?document=/);
  await expect(page.getByRole("dialog", { name: "Fall seasonal menu" })).toBeVisible();
});

// FLOW-293: Kitchen › Overview lists each menu item of the next 14 days' events,
// and In charge saves inline without opening the row.
test("Kitchen opens on the Overview, one row per menu item, and In charge saves inline (FLOW-293 AC1-AC3)", async ({ page, isMobile }) => {
  test.skip(isMobile, "The same table on phones; one viewport is enough.");
  const dish = await seedDish();
  const date = addLocalDays(utcToBusinessTime(new Date()).date, 3);
  const later = { ...fallGala(), id: "e0000000-0000-4000-8000-000000002931", title: "Far-off dinner", date: addLocalDays(date, 30) };
  await seedRecords({ clients: [juniper()], events: [{ ...fallGala(), date, guestCount: 80 }, later] });
  const cook = seedUsers.find((user) => user.role === "kitchen_staff")!;
  await browserDb(async (db) => {
    for (const event of [fallGala(), later]) {
      const [menu] = await db.insert(s.kitchenMenus).values({
        eventId: event.id,
        leavesKitchenAt: event.id === fallGala().id ? businessTimeToUtc(date, "16:30") : null,
      }).returning();
      await db.insert(s.kitchenMenuLines).values({ menuId: menu.id, recipeId: dish.id, course: "Mains", plannedQuantity: 80, notes: "Sauce on the side" });
    }
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Kitchen", exact: true }).click();
  await expect(page).toHaveURL(/#\/kitchen\/overview$/);
  const rows = page.getByRole("row", { name: /Braised short rib/ });
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText("Fall gala");
  await expect(row.locator(".date-time-cell__time")).toHaveText("4:30 PM");
  await expect(row).toContainText("Mains");
  await expect(row).toContainText("80");
  await expect(row).toContainText("Sauce on the side");
  await expect(row).toContainText("Milk");
  await expect(page.getByText("Far-off dinner")).toHaveCount(0);

  await row.getByRole("cell").last().getByRole("button").click();
  const options = page.getByRole("listbox").last();
  // Only kitchen staff are offered.
  await expect(options.getByRole("option", { name: seedUsers.find((user) => user.role === "salesperson")!.name })).toHaveCount(0);
  await options.getByRole("option", { name: cook.name, exact: true }).click();
  await expect(row).toContainText(cook.name);
  await expect(page).toHaveURL(/#\/kitchen\/overview$/);
  await page.reload();
  await expect(page.getByRole("row", { name: /Braised short rib/ })).toContainText(cook.name);
});

// FLOW-301: a stored client recipe book is a Menu document in the recipe book
// group, listed under the Recipe books filter with In Documents.
test("stored client recipe books appear on Menus under the Recipe books filter (FLOW-301 AC2)", async ({ page }) => {
  await browserDb(async (db) => {
    const book = "f3010000-0000-4000-8000-000000000001";
    await db.insert(s.attachments).values([
      { documentId: book, recordType: "document", recordId: book, group: "recipe_book", fileName: "Client-recipe-book.pdf",
        displayName: "Client recipe book", docType: "menu", status: "ready", variants: [] },
      { recordType: "document", recordId: "f3010000-0000-4000-8000-000000000002", documentId: "f3010000-0000-4000-8000-000000000002",
        fileName: "spring.pdf", displayName: "Spring seasonal menu", docType: "menu", status: "ready", variants: [] },
    ]);
  });
  await page.goto("/#/kitchen/menus");
  const menus = page.getByRole("list", { name: "Menus" });
  const book = menus.getByRole("listitem").filter({ hasText: "Client recipe book" });
  await expect(book).toContainText(/Recipe book/i);
  await expect(book.getByRole("link", { name: "In Documents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate recipe book" })).toBeVisible();
  await choose(page.getByRole("combobox", { name: /^Menus/ }), "recipe_book");
  await expect(book).toBeVisible();
  await expect(menus.getByRole("listitem").filter({ hasText: "Spring seasonal menu" })).toHaveCount(0);
});

test("the Ingredients tab filters by storage (FLOW-301 AC3)", async ({ page }) => {
  const pantry = defaultSections.find((section) => section.name === "Pantry")!;
  await seedInventory({ items: [
    consumable("Synthetic flour", { details: { storageSectionId: pantry.id } }),
    consumable("Synthetic cream"),
  ] });
  await page.goto("/#/inventory/ingredients");
  await expect(page.getByRole("row", { name: /Synthetic cream/ })).toBeVisible();
  await choose(page.getByRole("combobox", { name: /^Storage area/ }), { label: "Pantry" });
  await expect(page.getByRole("row", { name: /Synthetic flour/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Synthetic cream/ })).toHaveCount(0);
});

// FLOW-301 AC1: each Menus card shows the PDF's first page as its cover, with the
// page count.
test("a menu card shows the PDF's first page and its page count (FLOW-301 AC1)", async ({ page }) => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) pdf.addPage([612, 792]).drawText(`Synthetic menu page ${index + 1}`, { x: 72, y: 700 });
  const body = Buffer.from(await pdf.save());
  await page.route("**/r2-mock/**", (route) => route.fulfill({ status: 200, body, contentType: "application/pdf" }));
  const now = new Date().toISOString();
  await page.route("**/api/documents**", (route) => route.fulfill({ json: [{
    id: "f3010000-0000-4000-8000-000000000011", name: "Synthetic winter menu", docType: "menu", recordType: "document",
    recordId: "f3010000-0000-4000-8000-000000000011", group: "", protected: false, updatedAt: now,
    versions: [{ id: "f3010000-0000-4000-8000-000000000012", number: 1, fileName: "winter.pdf", size: body.byteLength,
      contentType: "application/pdf", url: `${new URL(route.request().url()).origin}/r2-mock/winter.pdf`, createdAt: now,
      uploadedBy: null, uploaderName: null }],
  }] }));
  await page.goto("/#/kitchen/menus");
  const card = page.getByRole("list", { name: "Menus" }).getByRole("listitem").filter({ hasText: "Synthetic winter menu" });
  await expect(card).toContainText("3 pages");
  const cover = card.locator(".menu-card-cover img");
  await expect(cover).toBeVisible();
  expect(await cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(card.getByRole("link", { name: "Open PDF" })).toHaveAttribute("href", /r2-mock\/winter\.pdf$/);
});
