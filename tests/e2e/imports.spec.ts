import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { test, expect, type Page } from "./auth-fixture";
import { choose } from "./dropdown";
import { browserDb } from "./database";
import * as s from "../../worker/db/schema";

// Data import framework (FLOW-47) on the real Worker and database, signed in as
// the seeded Admin, through the browser tests' rental importer
// (tests/fixtures/rental-importer.ts). Imported quantities enter the ledger as
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
  await page.goto("/#/settings/imports");
  await page.getByRole("link", { name: "Test rentals" }).click();
  await expect(page).toHaveURL(/#\/settings\/imports\/test_rentals$/);
  await expect(
    page.getByRole("heading", { name: "Import Test rentals", level: 1 }),
  ).toBeVisible();
  await chooseFile(page);
  // Columns map by alias; Category comes from the heading rows instead.
  await expect(page.getByLabel("Code", { exact: true })).toHaveAttribute("data-value", "0");
  await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("data-value", "1");
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveAttribute("data-value", "3");
  await expect(page.getByLabel("Category", { exact: true })).toHaveAttribute("data-value", "");

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
  expect(await browserDb((db) => db.select().from(s.allInventoryItems))).toEqual([]);

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
    items: await db.select().from(s.allInventoryItems),
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
          .from(s.allInventoryItems)
          .where(eq(s.allInventoryItems.code, "CH-001"))
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

// A workbook with a notes tab before the rentals tab, as inline-string cells.
function workbook(sheets: { name: string; rows: string[][] }[]) {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const cell = (text: string, column: number, row: number) =>
    text === "" ? "" : `<c r="${String.fromCharCode(65 + column)}${row}" t="inlineStr"><is><t>${text}</t></is></c>`;
  return Buffer.from(
    zipSync({
      "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook ${ns}><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`),
      ...Object.fromEntries(sheets.map((sheet, index) => [
        `xl/worksheets/sheet${index + 1}.xml`,
        strToU8(`<?xml version="1.0"?><worksheet ${ns}><sheetData>${sheet.rows.map((cells, row) => `<row r="${row + 1}">${cells.map((text, column) => cell(text, column, row + 1)).join("")}</row>`).join("")}</sheetData></worksheet>`),
      ])),
    }),
  );
}

test("a workbook with several sheets asks which one to import (FLOW-290 AC3)", async ({ page }) => {
  await page.goto("/#/settings/imports/test_rentals");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "Rentals.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook([
      { name: "Notes", rows: [["Read me"], ["Counted in June"]] },
      { name: "Rentals", rows: csv.split("\r\n").map((line) => line.split(",")) },
    ]),
  });
  await expect(page.getByText("Rentals.xlsx has 2 sheets.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check rows" })).toHaveCount(0);
  await choose(page.getByRole("combobox", { name: "Sheet" }), { label: "Rentals" });
  await expect(page.getByText("Rentals.xlsx › Rentals: 3 rows to import.")).toBeVisible();
  await expect(page.getByLabel("Code", { exact: true })).toHaveAttribute("data-value", "0");
  await page.getByRole("button", { name: "Check rows" }).click();
  const summary = page.getByRole("list", { name: "Dry run summary" });
  await expect(summary).toContainText("2 to create");
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Imported Rentals.xlsx › Rentals: 2 created, 0 updated, 0 unchanged, 1 failed.")).toBeVisible();
  expect((await browserDb((db) => db.select().from(s.importLogs)))[0].fileName).toBe("Rentals.xlsx › Rentals");
});

test("Settings › Imports offers Leads as not available yet (FLOW-290)", async ({ page }) => {
  await page.goto("/#/settings/imports");
  const leads = page.getByRole("list", { name: "Importers" }).getByRole("listitem").filter({ hasText: "Leads" });
  await expect(leads).toContainText("Importer not available yet");
  await expect(leads.getByRole("link")).toHaveCount(0);
});
