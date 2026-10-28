import { test, expect } from "./auth-fixture";
import { chairs } from "./fixtures";
import { seedInventory } from "./database";

test("edits rental details and maintains separate color stock on one item", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  await page.goto(`/#/inventory/${chairs().id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Dimensions", { exact: true })
    .fill("18 × 18 × 36 inches");
  await dialog
    .getByLabel("Assembly notes", { exact: true })
    .fill("Attach cushion");
  await dialog.getByLabel("Buffer days before", { exact: true }).fill("2");
  await dialog.getByLabel("Internal cost ($)", { exact: true }).fill("12.50");
  await dialog.getByLabel("Replacement cost ($)", { exact: true }).fill("80");
  await dialog.getByLabel(/^Colors/).fill("Gold\nSilver");
  await expect(
    dialog.getByLabel("Price ($ per unit)", { exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("18 × 18 × 36 inches", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Attach cushion", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record movement" }).click();
  await dialog
    .getByRole("combobox", { name: "Color", exact: true })
    .selectOption("Silver");
  await dialog
    .getByRole("combobox", { name: "Section", exact: true })
    .selectOption({ label: "Warehouse" });
  await dialog.getByLabel("Quantity in (each)").fill("6");
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .locator(".stock-table")
      .first()
      .getByRole("row", { name: "Warehouse · Silver 6 each" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".stock-table")
      .first()
      .getByRole("row", { name: "Total 56 each" }),
  ).toBeVisible();
});

test("creates and edits fixed, per-person and quoted services with includes and add-ons", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  for (const [name, basis] of [
    ["Balloon arch", "per_event"],
    ["Plasticware package", "per_guest"],
    ["Florals", "quote"],
  ]) {
    await page.goto("/#/inventory");
    await page.getByRole("button", { name: "New Item", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name *", { exact: true }).fill(name);
    await dialog
      .getByRole("combobox", { name: "Kind", exact: true })
      .selectOption("service");
    if (basis === "quote")
      await dialog.getByLabel("Priced by quote", { exact: true }).check();
    else {
      await dialog.getByLabel("Price ($)", { exact: true }).fill("3.50");
      await dialog
        .getByRole("combobox", { name: "Priced", exact: true })
        .selectOption(basis);
    }
    await dialog
      .getByRole("button", { name: "Add component", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Component 1", exact: true })
      .selectOption(chairs().id);
    await dialog.getByLabel("Component 1 quantity", { exact: true }).fill("2");
    await dialog
      .getByRole("button", { name: "Add per-person add-on", exact: true })
      .click();
    await dialog.getByLabel("Add-on 1 name", { exact: true }).fill("Upgrade");
    await dialog
      .getByLabel("Add-on 1 price ($ per guest)", { exact: true })
      .fill("0.50");
    await dialog.getByRole("button", { name: "Save item" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Services aren't stocked.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Chiavari Chair", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Updated offering");
    await dialog.getByRole("button", { name: "Save item" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText("Updated offering", { exact: true }),
    ).toBeVisible();
    if (basis === "quote")
      await expect(
        page.getByText("Priced by quote", { exact: true }),
      ).toBeVisible();
  }
});

test("creates a decor kit and supply, filters low stock and reaches supply count mode", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  await page.goto("/#/inventory/supplies");
  await page.getByRole("button", { name: "New Supply", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *", { exact: true }).fill("Candles");
  await dialog.getByLabel(/^Par level/).fill("10");
  await expect(dialog.getByLabel(/^Storage section/)).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Below par only").check();
  await expect(
    page.getByRole("button", { name: "Candles", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Count", exact: true }).click();
  await page
    .getByRole("button", { name: "Start counting Supplies", exact: true })
    .click();
  await expect(page.getByText("Candles", { exact: true })).toBeVisible();
  await page.goto("/#/inventory");
  await page.getByRole("button", { name: "New Item", exact: true }).click();
  await dialog
    .getByLabel("Name *", { exact: true })
    .fill("Centerpiece Candle Set");
  await dialog
    .getByRole("combobox", { name: "Subtype", exact: true })
    .selectOption("decor");
  await dialog
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Component 1", exact: true })
    .selectOption(chairs().id);
  await dialog
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Component 2", exact: true })
    .selectOption({ label: "Candles" });
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Kit components", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Candles", exact: true }),
  ).toBeVisible();
});

test("transfers stock between sections from the item page", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  await page.goto("/#/inventory");
  await page
    .getByRole("combobox", { name: "Section", exact: true })
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
  await expect(dialog.getByRole("alert")).toContainText("Cafe only has 10");
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
  // Allergens are set on dishes, not ingredients (FLOW-95).
  await expect(dialog.getByRole("group", { name: "Allergens" })).toHaveCount(0);
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

// FLOW-198 AC3: once stock has moved, the item form explains why the stock unit
// can't change, and nothing is saved.
test("explains that an item with stock history can't change its stock unit", async ({
  page,
}) => {
  await seedInventory({ items: [chairs()] });
  await page.goto(`/#/inventory/${chairs().id}`);
  await page.getByRole("button", { name: "Record movement" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Type/).selectOption("damage_loss");
  await dialog.getByLabel(/^Section/).selectOption({ label: "Warehouse" });
  await dialog.getByLabel("Quantity out (each)").fill("1");
  await dialog.getByLabel("Reason", { exact: true }).fill("Broken leg");
  await dialog.getByRole("button", { name: "Record", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Stock unit", { exact: true }).selectOption("dozen");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "stock history is recorded in each, so its stock unit can't change",
  );
  // Other edits still save.
  await dialog.getByLabel("Stock unit", { exact: true }).selectOption("each");
  await dialog.getByLabel("Name *", { exact: true }).fill("Chiavari chairs, gold");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Chiavari chairs, gold", level: 1 }),
  ).toBeVisible();
});
