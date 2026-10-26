import { test, expect } from "./auth-fixture";
import { consumable, defaultSections, mockInventoryApi } from "./mock-api";

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
  await mockInventoryApi(page, {
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
    page.getByRole("heading", { name: "Bar", level: 1 }),
  ).toBeVisible();
  const shown = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(page.getByText("4 bar items", { exact: true })).toBeVisible();
  await expect(page.getByText("Liquor · Vodka").first()).toBeVisible();
  await expect(page.getByText("Bottle 750 ml").first()).toBeVisible();

  await page.getByLabel("Category", { exact: true }).selectOption("Wine");
  await expect(shown("House Pinot Grigio")).toBeVisible();
  await expect(page.getByText("1 bar items", { exact: true })).toBeVisible();
  // Wine offers only its own subcategories.
  await expect(
    page.getByLabel("Subcategory", { exact: true }).getByRole("option"),
  ).toHaveText(["All subcategories", "White", "Red"]);
  await page.getByLabel("Subcategory", { exact: true }).selectOption("White");
  await expect(shown("House Pinot Grigio")).toBeVisible();

  await page.getByLabel("Category", { exact: true }).selectOption("");
  await expect(page.getByLabel("Subcategory", { exact: true })).toHaveValue("");
  await page.getByLabel("Subcategory", { exact: true }).selectOption("Vodka");
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "Liquor",
  );
  await expect(shown("Tito's Vodka")).toBeVisible();
  await expect(shown("Rail Vodka")).toBeVisible();
  await expect(shown("Rail Gin")).toHaveCount(0);

  await page.getByLabel("Tier", { exact: true }).selectOption("rail");
  await expect(shown("Rail Vodka")).toBeVisible();
  await expect(shown("Tito's Vodka")).toHaveCount(0);

  await page.getByLabel("Subcategory", { exact: true }).selectOption("");
  await page.getByLabel("Category", { exact: true }).selectOption("");
  await page.getByLabel("Tier", { exact: true }).selectOption("");
  await page.getByLabel("Distributor", { exact: true }).fill("imperio");
  await expect(shown("Tito's Vodka")).toBeVisible();
  await expect(shown("House Pinot Grigio")).toBeVisible();
  await expect(page.getByText("2 bar items", { exact: true })).toBeVisible();
});

test("creates a bar item kept in Bar Storage", async ({ page }) => {
  await mockInventoryApi(page);
  await page.goto("/#/inventory/bar");
  await page.getByRole("button", { name: "New Bar Item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^Storage section/)).toHaveValue(
    barStorage.id,
  );
  await dialog.getByLabel("Name *", { exact: true }).fill("Tito's Vodka");
  await dialog.getByLabel(/^Category/).selectOption("Liquor");
  await dialog.getByLabel(/^Subcategory/).selectOption("Vodka");
  await dialog.getByLabel(/^Brand \/ varietal/).fill("Tito's");
  await dialog.getByLabel(/^Tier/).selectOption("mid");
  await dialog.getByLabel(/^Container/).selectOption("bottle");
  await dialog.getByLabel(/^Purchase unit/).selectOption("case");
  await dialog.getByLabel("Items per case", { exact: true }).fill("12");
  await dialog.getByLabel(/^One each is about/).fill("750");
  await dialog.getByLabel(/^Each size unit/).selectOption("ml");
  await dialog.getByLabel("Distributor", { exact: true }).fill("Imperio");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Tito's Vodka", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Liquor · Vodka")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Mid", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("case of 12 × 750 ml")).toBeVisible();
});
