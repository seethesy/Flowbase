import { test, databaseTest, expect, mockBrowserAuth } from "./auth-fixture";
import { choose } from "./dropdown";
import { seedUsers } from "../../worker/db/seed";

// Settings › Roles & permissions (FLOW-269) on the real Worker and database.
const staff = seedUsers.find((user) => user.role === "staff")!;
const salesManager = seedUsers.find((user) => user.role === "sales_manager")!;
// The Worker keeps the matrix in memory across scenarios, so each one that changes
// it puts the seeded rules back before it ends.

test("an Admin removes Inventory from Staff, and the change applies (AC2, AC3)", async ({ page, browser }) => {
  await page.goto("/#/settings/permissions");
  await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();
  // The Admin column is locked.
  await expect(page.getByLabel("Inventory and Bar for Admin: Write, locked")).toBeVisible();
  await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);

  const cell = page.getByLabel("Inventory and Bar for Staff", { exact: true });
  await choose(cell, { label: "None" });
  const bar = page.getByRole("region", { name: "Unsaved changes" });
  await expect(bar).toBeVisible();
  // Discard puts the draft back.
  await bar.getByRole("button", { name: "Discard" }).click();
  await expect(bar).toHaveCount(0);
  await expect(cell).toContainText("Read");

  await choose(cell, { label: "None" });
  await bar.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Permissions saved" })).toBeVisible();
  await expect(bar).toHaveCount(0);

  // Staff no longer have Inventory: the API refuses (403) and the page says so.
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: staff.id });
  await other.goto("/#/inventory");
  await expect(other.getByRole("link", { name: "Inventory", exact: true })).toHaveCount(0);
  await context.close();

  // Put the seeded rules back for the next scenario.
  await choose(cell, { label: "Read" });
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Permissions saved" })).toBeVisible();
});

test("hiding a dashboard card for a role hides it on their dashboard (AC4)", async ({ page, browser }) => {
  await page.goto("/#/settings/permissions");
  await choose(page.getByLabel("Working Staff for Sales Manager", { exact: true }), { label: "Hidden" });
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Permissions saved" })).toBeVisible();

  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesManager.id });
  await other.goto("/#/");
  await expect(other.getByRole("heading", { name: /^My Tasks/ })).toBeVisible();
  await expect(other.getByRole("heading", { name: /^Working Staff/ })).toHaveCount(0);
  await context.close();

  // Everyone else still sees it.
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: /^Working Staff/ })).toBeVisible();

  await page.goto("/#/settings/permissions");
  await choose(page.getByLabel("Working Staff for Sales Manager", { exact: true }), { label: "Visible" });
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Permissions saved" })).toBeVisible();
});

databaseTest("only Admin reaches the editor", async ({ page }) => {
  await mockBrowserAuth(page, { userId: salesManager.id });
  await page.goto("/#/settings/permissions");
  await expect(page.getByText("Only Admin can change roles and permissions.")).toBeVisible();
});
