import { test, expect } from "../auth-fixture";
import { juniper, fallGala, chairs, consumable } from "../fixtures";
import { browserDb, seedInventory, seedRecords } from "../database";
import { utcToBusinessTime } from "../../../shared/time";
import { attachments, orderLists, proposals } from "../../../worker/db/schema";
import type { Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function saveInline(page: Page, path: string, method = "PUT") {
  const saved = page.waitForResponse((response) =>
    response.url().includes(path) && response.request().method() === method,
  );
  await page.locator("tbody tr input.table-edit-input").press("Enter");
  expect((await saved).ok()).toBeTruthy();
}

// The cell under a column header in the row whose name matches (FLOW-275).
async function cellOf(page: Page, row: RegExp, header: string) {
  await expect(page.getByRole("row", { name: row })).toBeVisible();
  const headers = (await page.locator("thead th").allTextContents())
    .map((text) => text.replace(/[↑↓]/g, "").trim());
  const index = headers.indexOf(header);
  expect(index, `column ${header} in ${headers.join(", ")}`).toBeGreaterThanOrEqual(0);
  return page.getByRole("row", { name: row }).getByRole("cell").nth(index);
}
// Opens an inline dropdown cell, picks an option and waits for the save.
async function pickInline(page: Page, trigger: Locator, option: string, path: string, method = "PATCH") {
  const saved = page.waitForResponse((response) =>
    response.url().includes(path) && response.request().method() === method,
  );
  await trigger.click();
  await page.getByRole("listbox").last().getByRole("option", { name: option, exact: true }).click();
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
  // The events table on Events › Overview (FLOW-349 retired the /events list).
  await page.goto("/#/events/overview");
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
    ["/kitchen/ingredients", "Synthetic herb", "Synthetic basil"],
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

// FLOW-275: the remaining stored fields on Inventory, Ingredients and Bar.
test("Inventory, Ingredient and Bar tables save the remaining item fields inline", async ({ page }) => {
  await seedInventory({ items: [
    chairs(), consumable("Synthetic herb"),
    consumable("Synthetic spirit", { subtype: "bar", category: "Liquor",
      bar: { brand: "Synthetic", subcategory: "Vodka", container: "bottle", housePick: false } }),
  ] });
  await page.goto("/#/inventory");
  await (await cellOf(page, /Chiavari Chair/, "Group")).getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("Ballroom chairs");
  await saveInline(page, "/api/inventory/items/", "PATCH");
  await page.reload();
  await expect(await cellOf(page, /Chiavari Chair/, "Group")).toHaveText("Ballroom chairs");

  await page.goto("/#/kitchen/ingredients");
  await pickInline(page, (await cellOf(page, /Synthetic herb/, "Recipe unit")).getByRole("button"), "tbsp", "/api/inventory/items/");
  await page.reload();
  await expect(await cellOf(page, /Synthetic herb/, "Recipe unit")).toHaveText("tbsp");

  await page.goto("/#/inventory/bar");
  await pickInline(page, (await cellOf(page, /Synthetic spirit/, "Tier")).getByRole("button"), "Premium", "/api/inventory/items/");
  await pickInline(page, (await cellOf(page, /Synthetic spirit/, "Container")).getByRole("button"), "Keg", "/api/inventory/items/");
  await (await cellOf(page, /Synthetic spirit/, "Distributor")).getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("Synthetic distributor");
  await saveInline(page, "/api/inventory/items/", "PATCH");
  await page.reload();
  await expect(await cellOf(page, /Synthetic spirit/, "Tier")).toHaveText("Premium");
  await expect(await cellOf(page, /Synthetic spirit/, "Container")).toHaveText("Keg");
  await expect(await cellOf(page, /Synthetic spirit/, "Distributor")).toHaveText("Synthetic distributor");
});

test("All tasks saves a task's priority and position in place", async ({ page }) => {
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "New task" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Title").fill("Stack chairs");
  await drawer.getByRole("button", { name: "Add task" }).click();
  await expect(drawer).toHaveCount(0);
  const row = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: "Stack chairs" });
  await pickInline(page, row.getByTitle("Priority"), "High", "/api/tasks/");
  const saved = page.waitForResponse((response) =>
    response.url().includes("/api/tasks/") && response.request().method() === "PATCH",
  );
  await row.getByTitle("Position").click();
  await row.getByRole("textbox", { name: "Position" }).fill("Server");
  await row.getByRole("textbox", { name: "Position" }).press("Enter");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  const reloaded = page.getByRole("list", { name: "Tasks" }).getByRole("listitem").filter({ hasText: "Stack chairs" });
  await expect(reloaded.getByTitle("Priority")).toHaveText("High");
  await expect(reloaded.getByTitle("Position")).toHaveText("Server");
});

test("the Sales tracker renames a proposal in place and the name persists", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const proposalId = "f0000000-0000-4000-8000-000000000075";
  await browserDb(async (db) => {
    await db.insert(proposals).values({ id: proposalId, eventId: fallGala().id, clientId: juniper().id, title: "Gala proposal", notes: "Keep these notes" });
  });
  // The Sales tracker is under Sales › Analytics (FLOW-340).
  await page.goto("/#/sales/analytics");
  const row = page.getByRole("row", { name: /Gala proposal/ });
  await row.getByTitle("Proposal title").click();
  await row.getByRole("textbox", { name: "Proposal title" }).fill("Gala proposal v2");
  await saveInline(page, `/api/proposals/${proposalId}`);
  await page.reload();
  await expect(page.getByTitle("Proposal title")).toHaveText("Gala proposal v2");
  // The save kept the proposal's notes.
  await expect.poll(() => browserDb(async (db) =>
    (await db.select({ notes: proposals.notes }).from(proposals))[0]?.notes)).toBe("Keep these notes");
});

test("Purchasing saves an order line's note on blur", async ({ page }) => {
  const herb = consumable("Synthetic herb");
  await seedInventory({ items: [herb] });
  const listId = await browserDb(async (db) => {
    const [row] = await db.insert(orderLists).values({ fromDate: "2026-11-01", toDate: "2026-11-30", status: "draft",
      lines: [{ itemId: herb.id, itemName: "Synthetic herb", vendorId: null, vendorName: "Synthetic vendor",
        orderingInstructions: "", quantity: 2, purchaseUnit: "case", shortage: 2,
        orderBy: null, eventIds: [], eventTitles: [], note: "" }] }).returning();
    return row.id;
  });
  await page.goto(`/#/inventory/orders/${listId}`);
  const note = page.getByLabel("Note for Synthetic herb");
  await note.fill("Ask for the large bunches");
  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/order-lists/${listId}`) && response.request().method() === "PUT",
  );
  await note.press("Enter");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByLabel("Note for Synthetic herb")).toHaveValue("Ask for the large bunches");
});

// FLOW-275: how an ingredient is bought, saved inline and still there after a reload.
test("Ingredients save how an item is bought inline", async ({ page }) => {
  await seedInventory({ items: [consumable("Synthetic thyme", { details: { purchaseUnit: "each", packCount: null } })] });
  await page.goto("/#/kitchen/ingredients");
  // A case needs its pack count first.
  await (await cellOf(page, /Synthetic thyme/, "Pack count")).getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("6");
  await saveInline(page, "/api/inventory/items/", "PATCH");
  await pickInline(page, (await cellOf(page, /Synthetic thyme/, "Bought as")).getByRole("button"), "case", "/api/inventory/items/");
  await page.reload();
  await expect(await cellOf(page, /Synthetic thyme/, "Bought as")).toContainText("case of 6");
  await expect(await cellOf(page, /Synthetic thyme/, "Pack count")).toHaveText("6");
});

test("event table changes an event's status with the pill dropdown", async ({ page }) => {
  const event = { ...fallGala(), date: utcToBusinessTime(new Date()).date };
  await seedRecords({ clients: [juniper()], events: [event] });
  // The events table on Events › Overview (FLOW-349 retired the /events list).
  await page.goto("/#/events/overview");
  await pickInline(page, page.getByRole("combobox", { name: "Status for Fall gala" }), "Negotiation", `/api/events/${event.id}/status`, "POST");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Status for Fall gala" })).toHaveAttribute("data-value", "negotiation");
});

test("an event's Tasks section changes a task's status in place", async ({ page }) => {
  const event = { ...fallGala(), date: "2026-09-17", startTime: "18:00" };
  await seedRecords({ clients: [juniper()], events: [event] });
  await page.goto(`/#/events/${event.id}`);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Title").fill("Fold napkins");
  await drawer.getByRole("button", { name: "Add task" }).click();
  await expect(drawer).toHaveCount(0);
  const row = () => page.getByRole("list", { name: "Event tasks" }).getByRole("listitem").filter({ hasText: "Fold napkins" });
  await pickInline(page, row().getByTitle("Status"), "In progress", "/api/tasks/");
  await page.reload();
  await expect(row().getByTitle("Status")).toHaveText("In progress");
});

test("Documents table saves an inline name after reload", async ({ page }) => {
  await seedRecords({ clients: [juniper()] });
  // Every stored document carries its document id (FLOW-263; migration 0066).
  const documentId = randomUUID();
  const [document] = await browserDb((db) => db.insert(attachments).values({
    id: documentId, documentId, recordType: "client", recordId: juniper().id, fileName: "synthetic-menu.pdf",
    displayName: "Synthetic menu", docType: "other", status: "ready", variants: [],
  }).returning());
  await page.goto("/#/documents");
  await page.getByRole("row", { name: /Synthetic menu/ }).getByRole("button", { name: "Synthetic menu" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Synthetic tasting menu");
  await saveInline(page, `/api/documents/${document.id}`, "PATCH");
  await page.reload();
  await expect(page.getByRole("row", { name: /Synthetic tasting menu/ })).toBeVisible();
});
