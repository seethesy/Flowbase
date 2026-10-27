import { eq } from "drizzle-orm";
import { test, expect, type Page } from "./auth-fixture";
import { browserDb } from "./database";
import * as s from "../../worker/db/schema";

// Data import framework (FLOW-47) on the real Worker and database, signed in as
// the seeded Admin, through the browser tests' rental importer
// (tests/fixtures/rental-importer.ts). Starting quantities enter the ledger as
// count movements linked to the import (FLOW-168).

// A category heading row (SEATING), two good rows and one without a name.
const csv = [
  "SKU,Item,Section,Qty",
  "SEATING,,,",
  "CH-001,Chiavari Chair,Warehouse,120",
  "CH-002,Folding Chair,Warehouse,40",
  "CH-003,,Warehouse,5",
].join("\r\n");

async function chooseFile(page: Page) {
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "rentals.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText("rentals.csv: 3 rows to import.")).toBeVisible();
}

test("checks rows in a dry run, then imports them and skips the row with an error", async ({
  page,
}) => {
  await page.goto("/#/imports");
  await page.getByRole("link", { name: "Test rentals" }).click();
  await expect(
    page.getByRole("heading", { name: "Import Test rentals", level: 1 }),
  ).toBeVisible();
  await chooseFile(page);
  // Columns map by alias; Category comes from the heading rows instead.
  await expect(page.getByLabel("Code", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue("");

  await page.getByRole("button", { name: "Check rows" }).click();
  const summary = page.getByRole("list", { name: "Dry run summary" });
  await expect(summary).toContainText("2 to create");
  await expect(summary).toContainText("1 row with errors");
  await expect(
    page
      .getByRole("table", { name: "Rows with errors" })
      .getByRole("row", { name: "5 Name is required." }),
  ).toBeVisible();
  // The dry run wrote nothing.
  expect(await browserDb((db) => db.select().from(s.inventoryItems))).toEqual([]);

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(
    page.getByText(
      "Imported rentals.csv: 2 created, 0 updated, 0 unchanged, 1 failed.",
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Rows that failed" })
      .getByRole("row", { name: "5 Name is required." }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Recent imports" }).getByRole("row"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("table", { name: "Recent imports" }),
  ).toContainText("Test Admin");

  const { items, movements, log } = await browserDb(async (db) => ({
    items: await db.select().from(s.inventoryItems),
    movements: await db.select().from(s.stockMovements),
    log: (await db.select().from(s.importLogs))[0],
  }));
  expect(items.map((item) => [item.code, item.category]).sort()).toEqual([
    ["CH-001", "SEATING"],
    ["CH-002", "SEATING"],
  ]);
  expect(log).toMatchObject({
    fileName: "rentals.csv",
    status: "completed",
    created: 2,
    failed: 1,
  });
  expect(
    movements.map((m) => [m.type, m.quantity, m.linkType, m.linkId]).sort(),
  ).toEqual([
    ["count", 120, "import", log.id],
    ["count", 40, "import", log.id],
  ]);

  // The same file again finds nothing to create (FLOW-47 AC1).
  await chooseFile(page);
  await page.getByRole("button", { name: "Check rows" }).click();
  await expect(summary).toContainText("0 to create");
  await expect(summary).toContainText("2 unchanged");
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(
    page.getByText(
      "Imported rentals.csv: 0 created, 0 updated, 2 unchanged, 1 failed.",
    ),
  ).toBeVisible();
  const chair = await browserDb(
    async (db) =>
      (
        await db
          .select()
          .from(s.inventoryItems)
          .where(eq(s.inventoryItems.code, "CH-001"))
      )[0],
  );
  expect(
    await browserDb((db) =>
      db
        .select()
        .from(s.stockMovements)
        .where(eq(s.stockMovements.itemId, chair.id)),
    ),
  ).toHaveLength(1);
});
