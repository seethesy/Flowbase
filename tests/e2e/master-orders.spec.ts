import { databaseTest, mockBrowserAuth } from "./auth-fixture";
import { expect } from "@playwright/test";
import { seedInventory } from "./database";
import { consumable } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";

// The Master sheet was removed in FLOW-291; order lists live on Inventory › Order (FLOW-292).
databaseTest("builds, edits, submits and prints an order list grouped by vendor", async ({ page }) => {
  const lead = seedUsers.find((user) => user.role === "kitchen_lead")!;
  await seedInventory({ items: [consumable("Wine bottles", { details: { parLevel: 12,
    purchaseUnit: "case", packCount: 12 } })] });
  await mockBrowserAuth(page, { userId: lead.id });
  await page.goto("/#/inventory/order");
  await page.getByRole("button", { name: "+ New order list" }).click();
  await page.getByRole("dialog", { name: "New order list" }).getByRole("button", { name: "Build list" }).click();
  await expect(page.getByRole("heading", { name: "Unassigned vendor" })).toBeVisible();
  await page.getByLabel("Quantity for Wine bottles").fill("2");
  await page.getByRole("button", { name: "Save edits" }).click();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Edits are locked until Admin approves or rejects this list.")).toBeVisible();
  await page.evaluate(() => { window.print = () => { document.body.dataset.printed = "yes"; }; });
  await page.getByRole("button", { name: "Print list" }).click();
  await expect(page.locator("body[data-printed='yes']")).toBeVisible();
});
