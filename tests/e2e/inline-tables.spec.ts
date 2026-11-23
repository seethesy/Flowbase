import { test, expect } from "./auth-fixture";
import { juniper, fallGala, chairs, consumable } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import { attachments, orderLists } from "../../worker/db/schema";
import { utcToBusinessTime } from "../../shared/time";
import type { Page } from "@playwright/test";

async function saveInline(page: Page, path: string, method = "PUT") {
  const saved = page.waitForResponse((response) =>
    response.url().includes(path) && response.request().method() === method,
  );
  await page.locator("tbody tr input.table-edit-input").press("Enter");
  expect((await saved).ok()).toBeTruthy();
}

test("client table saves an inline name and keeps Open", async ({ page }) => {
  await seedRecords({ clients: [juniper()] });
  await page.goto("/#/clients");
  const row = page.getByRole("row", { name: /Juniper & Co\./ });
  await expect(row.getByRole("button", { name: "Open" })).toBeVisible();
  await row.getByRole("button", { name: "Juniper & Co." }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Juniper Events");
  await saveInline(page, `/api/clients/${juniper().id}`);
  await expect(page.getByRole("row", { name: /Juniper Events/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: /Juniper Events/ })).toBeVisible();
});

test("event table saves an inline title", async ({ page }) => {
  const event = { ...fallGala(), date: utcToBusinessTime(new Date()).date };
  await seedRecords({ clients: [juniper()], events: [event] });
  await page.goto("/#/events");
  const row = page.getByRole("row", { name: /Fall gala/ });
  await row.getByRole("button", { name: "Fall gala" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Winter gala");
  await saveInline(page, `/api/events/${event.id}`);
  await expect(page.getByRole("row", { name: /Winter gala/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: /Winter gala/ })).toBeVisible();
});

test("venue table saves an inline address", async ({ page }) => {
  await page.goto("/#/venues");
  await page.getByRole("button", { name: "New Venue", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name *", { exact: true }).fill("Synthetic venue");
  await drawer.getByRole("button", { name: "Save venue" }).click();
  await expect(page).toHaveURL(/#\/venues\/[^/]+$/);
  await page.goto("/#/venues");
  const row = page.getByRole("row", { name: /Synthetic venue/ });
  await row.getByRole("cell").nth(2).getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("100 Test Lane");
  await saveInline(page, "/api/venues/");
  await page.reload();
  await expect(page.getByRole("row", { name: /100 Test Lane/ })).toBeVisible();
});

test("Inventory, Ingredient and Bar tables save inline item names", async ({ page }) => {
  await seedInventory({ items: [
    chairs(), consumable("Synthetic herb"),
    consumable("Synthetic spirit", { subtype: "bar", category: "Liquor",
      bar: { brand: "Synthetic", subcategory: "Vodka", container: "bottle", housePick: false } }),
  ] });
  for (const [path, before, after] of [
    ["/inventory", "Chiavari Chair", "Banquet Chair"],
    ["/inventory/ingredients", "Synthetic herb", "Synthetic basil"],
    ["/inventory/bar", "Synthetic spirit", "Synthetic vodka"],
  ]) {
    await page.goto(`/#${path}`);
    const row = page.getByRole("row", { name: new RegExp(before) });
    await row.getByRole("button", { name: before }).click();
    await page.locator("tbody tr input.table-edit-input").fill(after);
    await saveInline(page, "/api/inventory/items/", "PATCH");
    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(after) })).toBeVisible();
  }
});

test("task list edits a title inline and keeps its record link", async ({ page }) => {
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "New task" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Title").fill("Pack crates");
  await drawer.getByRole("button", { name: "Add task" }).click();
  const row = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: "Pack crates" });
  await row.getByRole("button", { name: "Edit" }).click();
  await row.getByRole("textbox", { name: "Edit Pack crates" }).fill("Pack checked crates");
  const saved = page.waitForResponse((response) =>
    response.url().includes("/api/tasks/") && response.request().method() === "PATCH",
  );
  await row.getByRole("textbox", { name: "Edit Pack crates" }).press("Enter");
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole("link", { name: "Pack checked crates" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Pack checked crates" })).toBeVisible();
});

test("staff directory saves an inline name", async ({ page }) => {
  await page.goto("/#/staff");
  const row = page.getByRole("row", { name: /Jamie Park/ });
  await row.getByRole("button", { name: "Jamie Park (staff)" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Jamie Tester");
  await saveInline(page, "/api/staff/", "PATCH");
  await page.reload();
  await expect(page.getByRole("row", { name: /Jamie Tester/ })).toBeVisible();
});

test("SOP library saves an inline title", async ({ page }) => {
  await page.goto("/#/sops/new");
  await page.getByLabel("Title").fill("Set up tables");
  await page.getByLabel("Category").fill("Production");
  await page.getByRole("textbox", { name: "SOP content" }).fill("Inspect each table.");
  await page.getByRole("button", { name: "Save SOP" }).click();
  await expect(page.getByRole("heading", { name: "Set up tables", level: 1 })).toBeVisible();
  await page.goto("/#/sops");
  const row = page.getByRole("row", { name: /Set up tables/ });
  await row.getByRole("button", { name: "Set up tables" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Set up guest tables");
  await saveInline(page, "/api/sops/");
  await page.reload();
  await expect(page.getByRole("row", { name: /Set up guest tables/ })).toBeVisible();
});

test("vendor table saves an inline name", async ({ page }) => {
  await page.goto("/#/vendors");
  await page.getByRole("button", { name: "New Vendor", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name *", { exact: true }).fill("Synthetic distributor");
  await drawer.getByRole("button", { name: "Save vendor" }).click();
  await expect(page).toHaveURL(/#\/vendors\/[^/]+$/);
  await page.goto("/#/vendors");
  const row = page.getByRole("row", { name: /Synthetic distributor/ });
  await row.getByRole("button", { name: "Synthetic distributor" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Synthetic supplier");
  await saveInline(page, "/api/vendors/");
  await page.reload();
  await expect(page.getByRole("row", { name: /Synthetic supplier/ })).toBeVisible();
});

test("recipe table saves an inline dish name", async ({ page }) => {
  await page.goto("/#/recipes");
  await page.getByRole("button", { name: "New Recipe", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name *", { exact: true }).fill("Synthetic dish");
  await drawer.getByRole("button", { name: "Save recipe" }).click();
  await expect(page).toHaveURL(/#\/recipes\/[^/]+$/);
  await page.goto("/#/recipes");
  const row = page.getByRole("row", { name: /Synthetic dish/ });
  await row.getByRole("button", { name: "Synthetic dish" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Synthetic entrée");
  await saveInline(page, "/api/recipes/");
  await page.reload();
  await expect(page.getByRole("row", { name: /Synthetic entrée/ })).toBeVisible();
});

// FLOW-275: the remaining stored fields, each saved inline and still there after
// a reload.
async function pick(page: Page, trigger: import("@playwright/test").Locator, option: string, path: string, method = "PATCH") {
  const saved = page.waitForResponse((response) => response.url().includes(path) && response.request().method() === method);
  await trigger.click();
  await page.getByRole("listbox").last().getByRole("option", { name: option, exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
}

test("Ingredients save how an item is bought, sized and used inline", async ({ page }) => {
  const herb = consumable("Synthetic thyme", { details: { purchaseUnit: "each", packCount: null, recipeUnit: null } });
  await seedInventory({ items: [herb] });
  await page.goto("/#/inventory/ingredients");
  // The cell under a column header.
  const cell = (header: string) => page.getByRole("row", { name: /Synthetic thyme/ })
    .locator(`xpath=td[count(ancestor::table//th[normalize-space()='${header}']/preceding-sibling::th)+1]`);
  // A case needs its pack count first.
  await cell("Pack count").getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("6");
  await saveInline(page, "/api/inventory/items/", "PATCH");
  await pick(page, cell("Bought as").getByRole("button"), "case", "/api/inventory/items/");
  await pick(page, cell("Recipe unit").getByRole("button"), "ml", "/api/inventory/items/");
  await page.reload();
  await expect(cell("Bought as")).toContainText("case of 6");
  await expect(cell("Recipe unit")).toContainText("ml");
});

test("Bar saves an item's container and tier inline", async ({ page }) => {
  const spirit = consumable("Synthetic gin", { subtype: "bar", category: "Liquor",
    bar: { brand: "Synthetic", subcategory: "Gin", container: null, housePick: false } });
  await seedInventory({ items: [spirit] });
  await page.goto("/#/inventory/bar");
  const cell = (header: string) => page.getByRole("row", { name: /Synthetic gin/ })
    .locator(`xpath=td[count(ancestor::table//th[normalize-space()='${header}']/preceding-sibling::th)+1]`);
  await pick(page, cell("Container").getByRole("button"), "Bottle", "/api/inventory/items/");
  await pick(page, cell("Tier").getByRole("button"), "Premium", "/api/inventory/items/");
  await page.reload();
  await expect(cell("Container")).toContainText("Bottle");
  await expect(cell("Tier")).toContainText("Premium");
});

test("Inventory saves an item's group, tier and color inline", async ({ page }) => {
  await seedInventory({ items: [chairs()] });
  await page.goto("/#/inventory");
  const cell = (header: string) => page.getByRole("row", { name: /Chiavari Chair/ })
    .locator(`xpath=td[count(ancestor::table//th[normalize-space()='${header}']/preceding-sibling::th)+1]`);
  await cell("Group").getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("Ballroom");
  await saveInline(page, "/api/inventory/items/", "PATCH");
  await page.reload();
  await expect(cell("Group")).toContainText("Ballroom");
});

test("event table changes an event's status with the pill dropdown", async ({ page }) => {
  const event = { ...fallGala(), date: utcToBusinessTime(new Date()).date };
  await seedRecords({ clients: [juniper()], events: [event] });
  await page.goto("/#/events");
  await pick(page, page.getByRole("combobox", { name: "Status for Fall gala" }), "Negotiation", `/api/events/${event.id}/status`, "POST");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Status for Fall gala" })).toHaveAttribute("data-value", "negotiation");
});

test("task list edits a task's status, priority and position inline", async ({ page }) => {
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "New task" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Title").fill("Stack linens");
  await drawer.getByRole("button", { name: "Add task" }).click();
  const row = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: "Stack linens" });
  await pick(page, row.getByRole("button", { name: /^Status for Stack linens/ }), "In progress", "/api/tasks/");
  await pick(page, row.getByRole("button", { name: /^Priority for Stack linens/ }), "High", "/api/tasks/");
  await row.getByRole("button", { name: /^Position for Stack linens/ }).click();
  const position = row.getByRole("textbox", { name: "Position for Stack linens" });
  await position.fill("Server");
  const saved = page.waitForResponse((response) => response.url().includes("/api/tasks/") && response.request().method() === "PATCH");
  await position.press("Enter");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  const after = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: "Stack linens" });
  await expect(after.getByRole("button", { name: /^Status for Stack linens/ })).toContainText("In progress");
  await expect(after.getByRole("button", { name: /^Priority for Stack linens/ })).toContainText("High");
  await expect(after.getByRole("button", { name: /^Position for Stack linens/ })).toContainText("Server");
});

test("Purchasing saves an order line's note inline", async ({ page }) => {
  const wine = consumable("Synthetic rosé", { details: { purchaseUnit: "case", packCount: 12 } });
  await seedInventory({ items: [wine] });
  const listId = await browserDb(async (db) => {
    const [row] = await db.insert(orderLists).values({ fromDate: "2026-11-01", toDate: "2026-11-30", status: "approved",
      lines: [{ itemId: wine.id, itemName: "Synthetic rosé", vendorId: null, vendorName: "Synthetic vendor",
        orderingInstructions: "", quantity: 2, purchaseUnit: "case", shortage: 24,
        orderBy: null, eventIds: [], eventTitles: [], note: "" }] }).returning();
    return row.id;
  });
  await page.goto(`/#/inventory/orders/${listId}`);
  const note = page.getByLabel("Note for Synthetic rosé");
  await note.fill("Ask for the 2025 vintage");
  const saved = page.waitForResponse((response) => response.url().includes(`/api/order-lists/${listId}`) && response.request().method() === "PUT");
  await note.press("Enter");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel("Note for Synthetic rosé")).toHaveValue("Ask for the 2025 vintage");
});

test("Documents table saves an inline name after reload", async ({ page }) => {
  await seedRecords({ clients: [juniper()] });
  const [document] = await browserDb((db) => db.insert(attachments).values({
    recordType: "client", recordId: juniper().id, fileName: "synthetic-menu.pdf",
    displayName: "Synthetic menu", docType: "other", status: "ready", variants: [],
  }).returning());
  await page.goto("/#/documents");
  const row = page.getByRole("row", { name: /Synthetic menu/ });
  await row.getByRole("button", { name: "Synthetic menu" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Synthetic tasting menu");
  await saveInline(page, `/api/documents/${document.id}`, "PATCH");
  await page.reload();
  await expect(page.getByRole("row", { name: /Synthetic tasting menu/ })).toBeVisible();
});
