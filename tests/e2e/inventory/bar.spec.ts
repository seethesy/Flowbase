import { choose, optionTexts } from "../dropdown";
import type { Locator } from "@playwright/test";
import { test, expect } from "../auth-fixture";
import { consumable, defaultSections } from "../fixtures";
import { seedInventory } from "../database";

// FLOW-353: these tables have no Open column; a click on a plain cell opens the row.
async function cellUnder(row: Locator, header: string) {
  const headers = (await row.locator("xpath=ancestor::table[1]").locator("thead th").allTextContents()).map((text) => text.trim());
  expect(headers).not.toContain("Open");
  expect(headers).toContain(header);
  return row.getByRole("cell").nth(headers.indexOf(header));
}

// Bar stock is kept at a location (FLOW-289), which no bar screen shows.
const barStorage = defaultSections[6];
const bar = (
  name: string,
  category: string,
  tier: string,
  details: { brand: string; subcategory: string; distributor: string },
) =>
  consumable(name, {
    subtype: "bar",
    category,
    tier,
    bar: {
      brand: details.brand,
      subcategory: details.subcategory,
      container: "bottle",
      housePick: false,
    },
    details: {
      purchaseUnit: "case",
      packCount: 12,
      eachSize: { quantity: 750, unit: "ml" },
      preferredVendor: details.distributor,
      storageSectionId: barStorage.id,
    },
  });

test("filters the bar screen by category, subcategory, tier and distributor", async ({
  page,
}) => {
  await seedInventory({
    items: [
      bar("Tito's Vodka", "Liquor", "mid", {
        brand: "Tito's",
        subcategory: "Vodka",
        distributor: "Imperio",
      }),
      bar("Rail Vodka", "Liquor", "rail", {
        brand: "",
        subcategory: "Vodka",
        distributor: "Southern",
      }),
      bar("Rail Gin", "Liquor", "rail", {
        brand: "",
        subcategory: "Gin",
        distributor: "Southern",
      }),
      bar("House Pinot Grigio", "Wine", "", {
        brand: "Pinot Grigio",
        subcategory: "White",
        distributor: "Imperio",
      }),
    ],
  });
  await page.goto("/#/inventory/bar");
  await expect(
    page.getByRole("heading", { name: "Inventory", level: 1 }),
  ).toBeVisible();
  const shown = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(page.getByText("4 bar items", { exact: true })).toBeVisible();
  const vodkaRow = page.getByRole("row", { name: /Tito's Vodka/ });
  await expect(vodkaRow.getByRole("button", { name: "Liquor", exact: true })).toBeVisible();
  await expect(vodkaRow.getByRole("button", { name: "Vodka", exact: true })).toBeVisible();
  await expect(page.getByText("Bottle 750 ml").first()).toBeVisible();

  await choose(page.getByLabel("Category", { exact: true }), "Wine");
  await expect(shown("House Pinot Grigio")).toBeVisible();
  await expect(page.getByText("1 bar items", { exact: true })).toBeVisible();
  // Wine offers only its own subcategories.
  await expect
    .poll(() => optionTexts(page.getByLabel("Subcategory", { exact: true })))
    .toEqual(["All subcategories", "White", "Red"]);
  await choose(page.getByLabel("Subcategory", { exact: true }), "White");
  await expect(shown("House Pinot Grigio")).toBeVisible();

  await choose(page.getByLabel("Category", { exact: true }), "");
  await expect(page.getByLabel("Subcategory", { exact: true })).toHaveAttribute("data-value", "");
  await choose(page.getByLabel("Subcategory", { exact: true }), "Vodka");
  await expect(page.getByLabel("Category", { exact: true })).toHaveAttribute(
    "data-value",
    "Liquor",
  );
  await expect(shown("Tito's Vodka")).toBeVisible();
  await expect(shown("Rail Vodka")).toBeVisible();
  await expect(shown("Rail Gin")).toHaveCount(0);

  await choose(page.getByLabel("Tier", { exact: true }), "rail");
  await expect(shown("Rail Vodka")).toBeVisible();
  await expect(shown("Tito's Vodka")).toHaveCount(0);

  await choose(page.getByLabel("Subcategory", { exact: true }), "");
  await choose(page.getByLabel("Category", { exact: true }), "");
  await choose(page.getByLabel("Tier", { exact: true }), "");
  await page.getByLabel("Distributor", { exact: true }).fill("imperio");
  await expect(shown("Tito's Vodka")).toBeVisible();
  await expect(shown("House Pinot Grigio")).toBeVisible();
  await expect(page.getByText("2 bar items", { exact: true })).toBeVisible();
});

test("creates a bar item without a location (FLOW-291)", async ({ page }) => {
  await seedInventory();
  await page.goto("/#/inventory/bar");
  await expect(page.getByRole("columnheader", { name: /^(Location|Storage)/ })).toHaveCount(0);
  await expect(page.getByLabel(/^All locations|^Location/)).toHaveCount(0);
  await page.getByRole("button", { name: "New Bar Item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^(Location|Storage)/)).toHaveCount(0);
  await dialog.getByLabel("Name *", { exact: true }).fill("Tito's Vodka");
  await choose(dialog.getByRole("combobox", { name: "Bar category", exact: true }), "Liquor");
  await choose(dialog.getByLabel(/^Subcategory/), "Vodka");
  await dialog.getByLabel(/^Brand \/ varietal/).fill("Tito's");
  await choose(dialog.getByLabel(/^Tier/), "mid");
  await choose(dialog.getByLabel(/^Container/), "bottle");
  await choose(dialog.getByLabel(/^Purchase unit/), "case");
  await dialog.getByLabel("Items per case", { exact: true }).fill("12");
  await dialog.getByLabel(/^One each is about/).fill("750");
  await choose(dialog.getByLabel(/^Each size unit/), "ml");
  await dialog.getByLabel("Distributor", { exact: true }).fill("Imperio");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Tito's Vodka", exact: true }),
  ).toBeVisible();
  const createdRow = page.getByRole("row", { name: /Tito's Vodka/ });
  await expect(createdRow.getByRole("button", { name: "Liquor", exact: true })).toBeVisible();
  await expect(createdRow.getByRole("button", { name: "Vodka", exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Mid", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("case of 12 × 750 ml")).toBeVisible();
});

test("the bar table has no Open column and a row click opens the item (FLOW-353)", async ({ page }) => {
  await seedInventory({ items: [bar("Tito's Vodka", "Liquor", "mid", { brand: "Tito's", subcategory: "Vodka", distributor: "Southern" })] });
  await page.goto("/#/inventory/bar");
  await (await cellUnder(page.getByRole("row", { name: /Tito's Vodka/ }), "Stock")).click();
  await expect(page.getByRole("heading", { name: "Tito's Vodka", level: 1 })).toBeVisible();
});
