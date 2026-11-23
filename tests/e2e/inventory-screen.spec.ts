import { choose } from "./dropdown";
import { test, expect } from "./auth-fixture";
import { chairs, consumable } from "./fixtures";
import { seedInventory } from "./database";

// The Inventory screen's tabs (FLOW-266).
const spirit = () => consumable("Synthetic spirit", { subtype: "bar", category: "Liquor",
  bar: { brand: "Synthetic", subcategory: "Vodka", container: "bottle", housePick: false } });

test("the tabs read Inventory | Bar | Purchasing | Vendors | Photos | Imports, each under the Inventory heading (AC1)", async ({ page }) => {
  await page.goto("/#/inventory");
  await expect(page.getByRole("navigation", { name: "Inventory pages" }).getByRole("link"))
    .toHaveText(["Inventory", "Bar", "Purchasing", "Vendors", "Photos", "Imports"]);
  // Photos (FLOW-298) has its own "Inventory photos" heading, so it is not in the loop below.
  for (const path of ["/inventory", "/inventory/bar", "/purchasing", "/vendors", "/imports"]) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole("heading", { name: "Inventory", level: 1 })).toBeVisible();
  }
});

test("bar items appear only on the Bar tab (AC2)", async ({ page }) => {
  await seedInventory({ items: [chairs(), spirit()] });
  await page.goto("/#/inventory");
  await expect(page.getByRole("row", { name: /Chiavari Chair/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Synthetic spirit/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Inventory pages" }).getByRole("link", { name: "Bar" }).click();
  await expect(page).toHaveURL(/#\/inventory\/bar$/);
  await expect(page.getByRole("row", { name: /Synthetic spirit/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Chiavari Chair/ })).toHaveCount(0);
});

test("/purchasing shows the order lists, not a not-found page (AC3)", async ({ page }) => {
  await seedInventory({ items: [consumable("Synthetic cups", { subtype: "supply", details: { parLevel: 12 } })] });
  await page.goto("/#/purchasing");
  await expect(page.getByText("Page not found")).toHaveCount(0);
  await expect(page.getByText("How an order list moves:")).toBeVisible();
  await page.getByRole("button", { name: "+ New order list" }).click();
  await page.getByRole("dialog", { name: "New order list" }).getByRole("button", { name: "Build list" }).click();
  await expect(page).toHaveURL(/#\/inventory\/orders\/[0-9a-f-]{36}$/);
  await page.goto("/#/purchasing");
  const row = page.getByRole("row", { name: /Draft/ });
  await expect(row).toBeVisible();
  await choose(page.getByRole("combobox", { name: "Status", exact: true }), "approved");
  await expect(page.getByRole("row", { name: /Draft/ })).toHaveCount(0);
  // The old address leads here.
  await page.goto("/#/inventory/orders");
  await expect(page).toHaveURL(/#\/purchasing$/);
});

test("the Low stock card counts items below par, and Below par only shows them (AC4)", async ({ page }) => {
  await seedInventory({ items: [
    chairs(),
    consumable("Synthetic napkins", { subtype: "supply", onHand: 2, details: { parLevel: 10 } }),
    consumable("Synthetic foil", { subtype: "supply", onHand: 50, details: { parLevel: 10 } }),
    // Bar stock below par counts on the Bar tab, not here.
    consumable("Synthetic gin", { subtype: "bar", category: "Liquor", onHand: 1, details: { parLevel: 6 },
      bar: { brand: "Synthetic", subcategory: "Gin", container: "bottle", housePick: false } }),
  ] });
  await page.goto("/#/inventory");
  await expect(page.getByRole("navigation", { name: "Inventory shortcuts" }).getByRole("link", { name: /Low stock/ }))
    .toContainText("1 items below par");
  await expect(page.getByRole("row", { name: /Synthetic napkins/ })).toContainText("Low");
  await expect(page.getByRole("row", { name: /Synthetic foil/ })).toContainText("In stock");
  await page.getByLabel("Below par only").check();
  await expect(page.getByRole("row", { name: /Synthetic napkins/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Synthetic foil/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Chiavari Chair/ })).toHaveCount(0);
});

test("the Imports tab shows a card per importer, with Never run until it has run", async ({ page }) => {
  await page.goto("/#/imports");
  const cards = page.getByRole("list", { name: "Importers" });
  await expect(cards.getByRole("listitem").first()).toContainText(/Never run|Last run/);
  await expect(cards.getByRole("link", { name: "Import file" }).first()).toBeVisible();
});
