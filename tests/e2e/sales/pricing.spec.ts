import { choose } from "../dropdown";
import { test, expect, mockBrowserAuth } from "../auth-fixture";
import { seedUsers } from "../../../worker/db/seed";

// Sales › Pricing (FLOW-329): the Admin keeps the price list on the tab; roles
// that read proposals see it; others don't get the tab.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;
const partTime = seedUsers.find((user) => user.role === "part_time_staff")!;

test("the Admin adds and edits prices that a salesperson then sees (AC1, AC2)", async ({ page, browser }) => {
  await page.goto("/#/sales/pricing");
  await expect(page.getByRole("heading", { name: "Pricing", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(/Workspace\s*\/\s*Sales\s*\/\s*Pricing/);
  await expect(page.getByText("No prices yet")).toBeVisible();

  await page.getByRole("button", { name: "New price" }).click();
  let drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name *").fill("Buffet package");
  await choose(drawer.getByRole("combobox", { name: "Charged" }), "per_guest");
  await drawer.getByLabel("Amount ($) *").fill("45");
  await drawer.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByRole("row", { name: /Buffet package/ })).toContainText("$45.00 per guest");

  await page.getByRole("button", { name: "New price" }).click();
  drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name *").fill("Service charge");
  await choose(drawer.getByRole("combobox", { name: "Category" }), "fee");
  await choose(drawer.getByRole("combobox", { name: "Charged" }), "percent");
  await drawer.getByLabel("Percent *").fill("18");
  await drawer.getByRole("button", { name: "Save price" }).click();
  await expect(page.getByRole("region", { name: "Fees" }).getByRole("row", { name: /Service charge/ })).toContainText("18% of the event total");

  await page.getByRole("button", { name: "Edit Buffet package" }).click();
  await page.getByRole("dialog").getByLabel("Amount ($) *").fill("50");
  await page.getByRole("dialog").getByRole("button", { name: "Save price" }).click();
  await expect(page.getByRole("row", { name: /Buffet package/ })).toContainText("$50.00 per guest");

  // A salesperson reads the list but can't change it.
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/sales/overview");
  await other.getByRole("navigation", { name: "Sales pages" }).getByRole("link", { name: "Pricing" }).click();
  await expect(other.getByRole("region", { name: "Packages" }).getByRole("row", { name: /Buffet package/ })).toContainText("$50.00 per guest");
  await expect(other.getByRole("button", { name: "New price" })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Edit Buffet package" })).toHaveCount(0);
  await context.close();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archive Service charge" }).click();
  await expect(page.getByRole("row", { name: /Service charge/ })).toHaveCount(0);
});

test("roles that can't read proposals get no Pricing tab (AC1)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockBrowserAuth(page, { userId: partTime.id });
  await page.goto("/#/venues");
  await expect(page.getByRole("navigation", { name: "Sales pages" }).getByRole("link")).toHaveText(["Overview", "Venues", "Time Tracking"]);
  await context.close();
});
