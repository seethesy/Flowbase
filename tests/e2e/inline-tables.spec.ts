import { test, expect } from "./auth-fixture";
import { juniper, fallGala, chairs, consumable } from "./fixtures";
import { seedInventory, seedRecords } from "./database";
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
  await row.getByRole("button", { name: "—" }).click();
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
  const row = page.getByRole("list", { name: "Tasks" }).getByRole("listitem", { name: /Pack crates/ });
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
  const row = page.getByRole("row", { name: /Test Admin/ });
  await row.getByRole("button", { name: "Test Admin" }).click();
  await page.locator("tbody tr input.table-edit-input").fill("Admin Tester");
  await saveInline(page, "/api/staff/", "PATCH");
  await page.reload();
  await expect(page.getByRole("row", { name: /Admin Tester/ })).toBeVisible();
});

test("SOP library saves an inline title", async ({ page }) => {
  await page.goto("/#/sops/new");
  await page.getByLabel("Title").fill("Set up tables");
  await page.getByLabel("Category").fill("Production");
  await page.getByRole("textbox", { name: "SOP content" }).fill("Inspect each table.");
  await page.getByRole("button", { name: "Save SOP" }).click();
  await expect(page).toHaveURL(/#\/sops\/[^/]+$/);
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

test("proposal table saves a name through its existing demo endpoint", async ({ page }) => {
  await page.goto("/#/proposals?view=table");
  const row = page.locator("tbody tr").first();
  const name = row.locator("td").nth(2).getByRole("button");
  await name.click();
  await page.locator("tbody tr input.table-edit-input").fill("Synthetic proposal name");
  await page.locator("tbody tr input.table-edit-input").press("Enter");
  await expect(page.getByRole("row", { name: /Synthetic proposal name/ })).toBeVisible();
});

