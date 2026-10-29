import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { test, databaseTest, mockBrowserAuth } from "./auth-fixture";
import { browserDb, seedInventory } from "./database";
import { chairs, consumable } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";
import { approvalRequests, users } from "../../worker/db/schema";

test("filters and exports the Master sheet with its displayed columns", async ({ page }) => {
  await seedInventory({ items: [chairs()] });
  await page.goto("/#/inventory/master");
  await expect(page.getByRole("heading", { name: "Master inventory" })).toBeVisible();
  await page.getByRole("combobox", { name: "Kind" }).selectOption("rental");
  await page.getByRole("combobox", { name: "Group" }).selectOption({ index: 1 });
  await expect(page.getByRole("link", { name: "Open" }).first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("Qty,Item,Description,Location,Price,Ratio,Group,Status");
  expect(csv).toContain("Chiavari Chair");
});

databaseTest("submits three edited cells as one request, then Admin approves", async ({ page }) => {
  await seedInventory({ items: [chairs()] });
  const salesperson = seedUsers.find((user) => user.role === "salesperson" && user.employmentType === "full_time")!;
  await mockBrowserAuth(page, { userId: salesperson.id });
  await page.goto("/#/inventory/master");
  await page.getByLabel("name for Chiavari Chair").fill("Gold Chiavari Chair");
  await page.getByLabel("description for Chiavari Chair").fill("Premium chair");
  await page.getByLabel("group for Chiavari Chair").fill("Premium");
  await page.getByRole("button", { name: "Submit batch for approval" }).click();
  await expect(page.getByRole("status").filter({ hasText: "One approval request" })).toBeVisible();
  await browserDb(async (db) => {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, salesperson.id));
  });
  await page.goto("/#/approvals");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.goto(`/#/inventory/${chairs().id}`);
  await expect(page.getByRole("heading", { name: "Gold Chiavari Chair" })).toBeVisible();
  await browserDb(async (db) => {
    await db.update(users).set({ role: "salesperson" }).where(eq(users.id, salesperson.id));
  });
  await page.goto("/#/inventory/master");
  await page.reload();
  await page.getByLabel("priceCents for Gold Chiavari Chair").fill("10");
  await page.getByRole("button", { name: "Submit batch for approval" }).click();
  await browserDb(async (db) => {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, salesperson.id));
  });
  await page.goto("/#/approvals");
  await page.reload();
  await page.getByLabel(/Rejection reason/).fill("Keep the current price");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect.poll(() => browserDb(async (db) => {
    const rows = await db.select({ status: approvalRequests.status }).from(approvalRequests);
    return rows.filter((row) => row.status === "rejected").length;
  })).toBe(1);
});

databaseTest("builds, edits, submits and prints an order list grouped by vendor", async ({ page }) => {
  const lead = seedUsers.find((user) => user.role === "kitchen_lead" && user.employmentType === "full_time")!;
  await seedInventory({ items: [consumable("Wine bottles", { details: { parLevel: 12,
    purchaseUnit: "case", packCount: 12 } })] });
  await mockBrowserAuth(page, { userId: lead.id });
  await page.goto("/#/inventory/orders");
  await page.getByRole("button", { name: "Build list" }).click();
  await expect(page.getByRole("heading", { name: "Unassigned vendor" })).toBeVisible();
  await page.getByLabel("Quantity for Wine bottles").fill("2");
  await page.getByRole("button", { name: "Save edits" }).click();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Edits are locked until Admin approves or rejects this list.")).toBeVisible();
  await page.evaluate(() => { window.print = () => { document.body.dataset.printed = "yes"; }; });
  await page.getByRole("button", { name: "Print list" }).click();
  await expect(page.locator("body[data-printed='yes']")).toBeVisible();
});
