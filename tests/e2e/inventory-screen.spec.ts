import { choose } from "./dropdown";
import { test, expect } from "./auth-fixture";
import { chairs, consumable } from "./fixtures";
import { seedInventory } from "./database";

// The Inventory screen's tabs (FLOW-266, FLOW-291) and the Order tab (FLOW-292).
const spirit = (options: Parameters<typeof consumable>[1] = {}) => consumable("Synthetic spirit", { subtype: "bar", category: "Liquor",
  bar: { brand: "Synthetic", subcategory: "Vodka", container: "bottle", housePick: false }, ...options });

test("the tabs read Inventory | Bar Inventory | Order | Vendors | Photos, each under the Inventory heading (FLOW-291)", async ({ page }) => {
  await page.goto("/#/inventory");
  await expect(page.getByRole("navigation", { name: "Inventory pages" }).getByRole("link"))
    .toHaveText(["Inventory", "Bar Inventory", "Order", "Vendors", "Photos"]);
  // Photos (FLOW-298) has its own "Inventory photos" heading, so it is not in the loop below.
  for (const path of ["/inventory", "/inventory/bar", "/inventory/order", "/vendors"]) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole("heading", { name: "Inventory", level: 1 })).toBeVisible();
  }
  await expect(page.getByText("Stock & Supplies", { exact: false })).toHaveCount(0);
});

test("the old addresses lead to their new places (FLOW-291, FLOW-292)", async ({ page }) => {
  for (const [from, to] of [
    ["/inventory/master", /#\/inventory$/],
    ["/inventory/supplies", /#\/inventory$/],
    ["/inventory/counts", /#\/inventory$/],
    ["/inventory/ingredients", /#\/kitchen\/ingredients$/],
    ["/inventory/sections", /#\/settings\/locations$/],
    ["/imports", /#\/settings\/imports$/],
    ["/purchasing", /#\/inventory\/order$/],
    ["/inventory/low-stock", /#\/inventory\/order$/],
    ["/inventory/orders", /#\/inventory\/order$/],
  ] as const) {
    await page.goto(`/#${from}`);
    await expect(page).toHaveURL(to);
  }
});

test("bar items appear only on the Bar Inventory tab, with no location (FLOW-289 AC2)", async ({ page }) => {
  await seedInventory({ items: [chairs(), spirit()] });
  await page.goto("/#/inventory");
  await expect(page.getByRole("row", { name: /Chiavari Chair/ })).toContainText("Rental");
  await expect(page.getByRole("row", { name: /Synthetic spirit/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Inventory pages" }).getByRole("link", { name: "Bar Inventory" }).click();
  await expect(page).toHaveURL(/#\/inventory\/bar$/);
  await expect(page.getByRole("row", { name: /Synthetic spirit/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Chiavari Chair/ })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Location" })).toHaveCount(0);
});

test("the Order tab lists order lists and what each list needs reordered (FLOW-292)", async ({ page }) => {
  await seedInventory({ items: [
    chairs(),
    consumable("Synthetic napkins", { subtype: "supply", onHand: 2, details: { parLevel: 10 } }),
    consumable("Synthetic foil", { subtype: "supply", onHand: 50, details: { parLevel: 10 } }),
    spirit({ onHand: 1, details: { parLevel: 6 } }),
  ] });
  await page.goto("/#/inventory/order");
  await expect(page.getByText("Page not found")).toHaveCount(0);
  await expect(page.getByText("How an order list moves:")).toBeVisible();
  const master = page.locator("#reorder-master");
  await expect(master.getByRole("row", { name: /Synthetic napkins/ })).toContainText("8");
  await expect(master.getByRole("row", { name: /Synthetic foil/ })).toHaveCount(0);
  await expect(master.getByRole("row", { name: /Chiavari Chair/ })).toHaveCount(0);
  await expect(page.locator("#reorder-bar").getByRole("row", { name: /Synthetic spirit/ })).toBeVisible();
  await expect(page.locator("#kitchen")).toContainText("Nothing needs reordering");

  await page.getByRole("button", { name: "+ New order list" }).click();
  await page.getByRole("dialog", { name: "New order list" }).getByRole("button", { name: "Build list" }).click();
  await expect(page).toHaveURL(/#\/inventory\/orders\/[0-9a-f-]{36}$/);
  await page.goto("/#/inventory/order");
  await expect(page.getByRole("row", { name: /Draft/ })).toBeVisible();
  await choose(page.getByRole("combobox", { name: "Status", exact: true }), "approved");
  await expect(page.getByRole("row", { name: /Draft/ })).toHaveCount(0);
});

test("Below par only shows the items under par on Inventory", async ({ page }) => {
  await seedInventory({ items: [
    chairs(),
    consumable("Synthetic napkins", { subtype: "supply", onHand: 2, details: { parLevel: 10 } }),
    consumable("Synthetic foil", { subtype: "supply", onHand: 50, details: { parLevel: 10 } }),
  ] });
  await page.goto("/#/inventory");
  await expect(page.getByRole("row", { name: /Synthetic napkins/ })).toContainText("Low");
  await expect(page.getByRole("row", { name: /Synthetic foil/ })).toContainText("In stock");
  await page.getByLabel("Below par only").check();
  await expect(page.getByRole("row", { name: /Synthetic napkins/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Synthetic foil/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Chiavari Chair/ })).toHaveCount(0);
});

test("Settings › Imports shows a card per importer, with Never run until it has run", async ({ page }) => {
  await page.goto("/#/settings/imports");
  const cards = page.getByRole("list", { name: "Importers" });
  await expect(cards.getByRole("listitem").first()).toContainText(/Never run|Last run/);
  await expect(cards.getByRole("link", { name: "Import file" }).first()).toBeVisible();
});
