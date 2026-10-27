import { test, expect } from "./auth-fixture";
import { chairs } from "./fixtures";
import { seedInventory } from "./database";

test("transfers stock between sections from the item page", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  await page.goto("/#/inventory");
  await page
    .getByLabel("Section", { exact: true })
    .selectOption({ label: "Cafe" });
  await page
    .getByRole("button", { name: "Chiavari Chair", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chiavari Chair", level: 1 }),
  ).toBeVisible();
  const stock = page.locator(".stock-table");
  await expect(
    stock.getByRole("row", { name: "Warehouse 40 each" }),
  ).toBeVisible();
  await expect(stock.getByRole("row", { name: "Cafe 10 each" })).toBeVisible();
  await expect(stock.getByRole("row", { name: "Total 50 each" })).toBeVisible();

  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^From section/).selectOption({ label: "Warehouse" });
  await dialog.getByLabel(/^To section/).selectOption({ label: "Jamie's" });
  await dialog.getByLabel("Quantity (each)").fill("10");
  await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    stock.getByRole("row", { name: "Warehouse 30 each" }),
  ).toBeVisible();
  await expect(
    stock.getByRole("row", { name: "Jamie's 10 each" }),
  ).toBeVisible();
  await expect(stock.getByRole("row", { name: "Total 50 each" })).toBeVisible();

  await page.getByRole("button", { name: "Transfer", exact: true }).click();
  await dialog.getByLabel(/^From section/).selectOption({ label: "Cafe" });
  await dialog.getByLabel(/^To section/).selectOption({ label: "Vendor" });
  await dialog.getByLabel("Quantity (each)").fill("11");
  await dialog.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Not enough stock");
});

test("creates, edits and filters ingredients", async ({ page }) => {
  await seedInventory();
  await page.goto("/#/inventory/ingredients");
  await page
    .getByRole("button", { name: "New Ingredient", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *", { exact: true }).fill("Heavy Cream");
  await dialog.getByLabel("Category", { exact: true }).fill("Dairy");
  await dialog.getByLabel(/^Stock unit/).selectOption("qt");
  await dialog.getByLabel(/^Purchase unit/).selectOption("case");
  await dialog.getByLabel("Items per case", { exact: true }).fill("6");
  await dialog.getByLabel(/^One each is about/).fill("1");
  await dialog.getByLabel(/^Each size unit/).selectOption("qt");
  // A recipe unit the cream can't be converted to is flagged.
  await dialog.getByLabel(/^Recipe unit/).selectOption("lb");
  await expect(dialog.getByRole("status")).toContainText(
    "Can't convert lb to case for this item.",
  );
  await dialog.getByLabel(/^Recipe unit/).selectOption("cup");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await dialog.getByLabel(/^Unit cost/).fill("24");
  await dialog.getByLabel(/^Par level/).fill("6");
  await dialog.getByLabel(/^Storage section/).selectOption({
    label: "Kitchen – Refrigerated",
  });
  await dialog.getByLabel("Milk", { exact: true }).check();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("case of 6 × 1 qt")).toBeVisible();
  await expect(page.getByText("$24.00")).toBeVisible();

  await page
    .getByRole("button", { name: "New Ingredient", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *", { exact: true }).fill("Romaine");
  await dialog.getByLabel("Category", { exact: true }).fill("Produce");
  await dialog.getByLabel(/^Purchase unit/).selectOption("lb");
  await dialog.getByLabel("Preferred vendor", { exact: true }).fill("Farm Co");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByLabel("Category", { exact: true }).selectOption("Dairy");
  await expect(page.getByRole("button", { name: "Heavy Cream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Romaine" })).toHaveCount(0);
  await page.getByLabel("Category", { exact: true }).selectOption("");
  await page.getByLabel("Below par only").check();
  await expect(page.getByRole("button", { name: "Heavy Cream" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Romaine" })).toHaveCount(0);
  await page.getByLabel("Below par only").uncheck();
  await page.getByLabel("Vendor", { exact: true }).fill("farm");
  await expect(page.getByRole("button", { name: "Romaine" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Heavy Cream" })).toHaveCount(
    0,
  );
  await page.getByLabel("Vendor", { exact: true }).fill("");

  await page.getByRole("button", { name: "Heavy Cream" }).click();
  await expect(
    page.getByRole("heading", { name: "Heavy Cream", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Preferred vendor", { exact: true }).fill("Sysco");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Sysco", { exact: true })).toBeVisible();
  await expect(page.getByText("Kitchen – Refrigerated")).toBeVisible();
  await expect(page.getByText("$24.00 per case")).toBeVisible();
});

test("records and corrects a stock movement from the item page", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  await page.goto(`/#/inventory/${chairs().id}`);
  const stock = page.locator(".stock-table").first();
  await expect(
    stock.getByRole("row", { name: "Warehouse 40 each" }),
  ).toBeVisible();
  await expect(page.getByText("No stock movements yet.")).toBeVisible();

  await page.getByRole("button", { name: "Record movement" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Type/).selectOption("damage_loss");
  await dialog.getByLabel(/^Section/).selectOption({ label: "Warehouse" });
  await dialog.getByLabel("Quantity out (each)").fill("2");
  await dialog.getByLabel("Reason", { exact: true }).fill("Broken legs");
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    stock.getByRole("row", { name: "Warehouse 38 each" }),
  ).toBeVisible();
  const history = page.locator(".movement-table");
  await expect(history.getByRole("row")).toHaveCount(2);
  await expect(history.getByRole("row").nth(1)).toContainText("Damage / loss");
  await expect(history.getByRole("row").nth(1)).toContainText("−2");
  await expect(history.getByRole("row").nth(1)).toContainText("Broken legs");

  // AC3: the correction is a new, linked movement; the original stays.
  await history.getByRole("button", { name: /^Correct the damage/ }).click();
  await expect(dialog.getByLabel(/^Should have been/)).toHaveValue("-2");
  await dialog.getByLabel(/^Should have been/).fill("-3");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Give a reason for the correction.",
  );
  await dialog.getByLabel("Reason *").fill("Found a third");
  await dialog.getByRole("button", { name: "Save correction" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    stock.getByRole("row", { name: "Warehouse 37 each" }),
  ).toBeVisible();
  await expect(history.getByRole("row")).toHaveCount(3);
  await expect(history.getByRole("row").nth(1)).toContainText("Correction");
  await expect(history.getByRole("row").nth(1)).toContainText("−1");
  await expect(history.getByRole("row").nth(2)).toContainText("Corrected");
  await expect(history.getByRole("row").nth(2)).toContainText("−2");
});
