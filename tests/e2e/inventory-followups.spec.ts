import type { Page } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import { browserDb } from "./database";
import { importLogs, orderLists, vendorContacts, vendors } from "../../worker/db/schema";
import { seedUsers } from "../../worker/db/seed";

// The signed-in admin, seeded as seedUsers[0] under this name (tests/e2e/database.ts).
const adminName = "Test Admin";

// The Inventory screen's Purchasing, Vendors and Imports tabs, finished to match
// the preview (FLOW-300).

// The cell under a column header in the row whose name matches.
async function cellOf(page: Page, row: RegExp, header: string) {
  await expect(page.getByRole("row", { name: row })).toBeVisible();
  const headers = (await page.locator("thead th").allTextContents())
    .map((text) => text.replace(/[↑↓]/g, "").trim());
  const index = headers.indexOf(header);
  expect(index, `column ${header} in ${headers.join(", ")}`).toBeGreaterThanOrEqual(0);
  return page.getByRole("row", { name: row }).getByRole("cell").nth(index);
}
async function saveInline(page: Page, path: string, method: string, value: string) {
  const input = page.locator("tbody tr input.table-edit-input");
  await input.fill(value);
  const saved = page.waitForResponse((response) =>
    response.url().includes(path) && response.request().method() === method);
  await input.press("Enter");
  expect((await saved).ok()).toBeTruthy();
}

test("Purchasing shows Created by and saves a list's notes inline (AC1)", async ({ page }) => {
  const admin = seedUsers[0];
  const listId = await browserDb(async (db) => {
    const [row] = await db.insert(orderLists).values({ fromDate: "2026-11-01", toDate: "2026-11-30", status: "draft",
      createdBy: admin.id, updatedBy: admin.id }).returning();
    return row.id;
  });
  await page.goto("/#/inventory/order");
  await expect(await cellOf(page, /Draft/, "Created by")).toHaveText(adminName);
  await expect(page.locator("thead th").filter({ hasText: "Est. total" })).toBeVisible();
  await (await cellOf(page, /Draft/, "Notes")).getByRole("button").click();
  await saveInline(page, `/api/order-lists/${listId}`, "PATCH", "Deliver to the back door");
  await page.reload();
  await expect(await cellOf(page, /Draft/, "Notes")).toHaveText("Deliver to the back door");
  // Editing the note didn't open the list.
  await expect(page).toHaveURL(/#\/inventory\/order$/);
});

test("Purchasing deletes a Draft list and skips an Ordered one with a reason (AC1)", async ({ page }) => {
  await browserDb((db) => db.insert(orderLists).values([
    { fromDate: "2026-11-01", toDate: "2026-11-30", status: "draft" },
    { fromDate: "2026-12-01", toDate: "2026-12-31", status: "ordered" },
  ]));
  await page.goto("/#/inventory/order");
  const draftRow = page.getByRole("row", { name: /Draft/ });
  const orderedRow = page.getByRole("row", { name: /Ordered/ });
  await expect(draftRow).toBeVisible();
  await draftRow.getByRole("cell").nth(1).click({ modifiers: ["ControlOrMeta"] });
  await orderedRow.getByRole("cell").nth(1).click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("region", { name: "Selected rows" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Delete" }).click();
  const toast = page.getByRole("status").filter({ hasText: "deleted." });
  await expect(toast).toContainText("1 deleted.");
  await expect(toast).toContainText("only Draft, Rejected and Cancelled lists can be deleted");
  await expect(draftRow).toHaveCount(0);
  await expect(orderedRow).toBeVisible();
  // Undo brings it back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(draftRow).toBeVisible();
});

test("a vendor's phone is edited from the Vendors table and persists (AC2)", async ({ page }) => {
  const vendorId = await browserDb(async (db) => {
    const [vendor] = await db.insert(vendors).values({ name: "Synthetic produce", type: "food_distributor" }).returning();
    await db.insert(vendorContacts).values({ vendorId: vendor.id, name: "Synthetic rep", phone: "555-0101" });
    return vendor.id;
  });
  await page.goto("/#/vendors");
  await (await cellOf(page, /Synthetic produce/, "Phone")).getByRole("button").click();
  await saveInline(page, `/api/vendors/${vendorId}`, "PUT", "555-0199");
  await page.reload();
  await expect(await cellOf(page, /Synthetic produce/, "Phone")).toHaveText("555-0199");
  const contacts = await browserDb((db) => db.select().from(vendorContacts));
  expect(contacts.map((contact) => [contact.name, contact.phone])).toEqual([["Synthetic rep", "555-0199"]]);
});

// The importer cards themselves are Settings › Imports' (FLOW-290); this checks
// the Recent imports table and its read-only record.
test("Imports shows the Recent imports table of the preview and opens a record read-only (AC3)", async ({ page }) => {
  const admin = seedUsers[0];
  await browserDb((db) => db.insert(importLogs).values({ module: "test_rentals", fileName: "synthetic-rentals.csv",
    status: "completed", rowCount: 4, created: 2, updated: 1, skipped: 0, failed: 1,
    createdBy: admin.id, updatedBy: admin.id }));
  await page.goto("/#/settings/imports");
  const cards = page.getByRole("list", { name: "Importers" });
  await expect(cards.getByRole("listitem").filter({ hasText: "Test rentals" })).toContainText(`by ${adminName}`);

  const table = page.getByRole("table", { name: "Recent imports" });
  await expect(table.locator("thead th")).toHaveText(["Open", "Date", "Importer", "File", "New", "Updated", "Errors", "By"]);
  const row = table.getByRole("row", { name: /synthetic-rentals\.csv/ });
  await expect(row).toContainText("Test rentals");
  await expect(row).toContainText(adminName);
  await row.getByRole("button", { name: "Open" }).click();
  const record = page.getByRole("dialog", { name: "synthetic-rentals.csv" });
  await expect(record.getByRole("definition")).toHaveCount(9);
  await expect(record).toContainText("can't be edited or deleted");
  // Read-only: nothing to edit or delete.
  await expect(record.getByRole("textbox")).toHaveCount(0);
  await expect(record.getByRole("button", { name: /Delete/ })).toHaveCount(0);
});
