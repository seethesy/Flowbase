import { test, expect, mockBrowserAuth, type Page } from "../auth-fixture";
import { seedUsers } from "../../../worker/db/seed";

// Which roles see each sidebar heading and tab (FLOW-284), on the real Worker and
// database. Each scenario starts from an empty database: nothing hidden.
const partTime = seedUsers.find((user) => user.role === "part_time_staff")!;

const saveSettings = async (page: Page) => {
  await page.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Permissions saved" })).toBeVisible();
};
const venuesCell = (page: Page) => page.getByLabel("Sales › Venues for Part Time Staff", { exact: true });

test("Admin hides Sales › Venues and Reports from Part-time Staff (AC1, AC2)", async ({ page, browser }) => {
  await page.goto("/#/settings/permissions");
  const grid = page.getByRole("table", { name: "Navigation by role" });
  // Admin's column is locked on (AC4).
  await expect(grid.getByLabel("Reports for Admin: always shown", { exact: true })).toBeChecked();
  await expect(grid.getByLabel("Reports for Admin: always shown", { exact: true })).toBeDisabled();
  // A tab the role can't open anyway is disabled with the reason (AC3).
  await expect(grid.getByLabel("Sales › Leads for Part Time Staff", { exact: true })).toBeDisabled();
  await expect(grid.getByRole("row", { name: /^Leads/ })).toContainText("No access to Leads");

  await venuesCell(page).uncheck();
  await grid.getByLabel("Reports for Part Time Staff", { exact: true }).uncheck();
  // Unchecking a heading turns off every tab under it.
  await expect(grid.getByLabel("Reports › Time tracking for Part Time Staff", { exact: true })).toBeDisabled();
  await saveSettings(page);

  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: partTime.id });
  await other.goto("/#/calendar");
  const sidebar = other.getByRole("navigation", { name: "Main" });
  await expect(sidebar.getByRole("link", { name: "Events" })).toBeVisible();
  // Venues was Sales' only tab for this role, so the heading goes with it.
  await expect(sidebar.getByRole("link", { name: "Sales" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Reports" })).toHaveCount(0);

  // A direct link to a hidden tab (AC2).
  await other.goto("/#/venues");
  await expect(other.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
  await expect(other.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText("Venues");
  await expect(other.getByRole("navigation", { name: "Sales pages" })).toHaveCount(0);
  await other.getByRole("link", { name: "Go to your first page" }).click();
  await expect(other).toHaveURL(/#\/$/);
  await other.goto("/#/reports");
  await expect(other.getByRole("heading", { name: "Not available for your role" })).toBeVisible();
  // The API still answers by area permissions: tests/db/settings/permissions.test.ts.
  await context.close();

  // Admin still sees everything.
  await page.goto("/#/venues");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not available for your role" })).toHaveCount(0);
});

test("the live-edit popover and the Settings grid show and save the same values (AC5)", async ({ page }) => {
  await page.goto("/#/sales/overview");
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Who sees Sales › Venues" }).click();
  const popover = page.getByRole("dialog", { name: "Who sees Sales › Venues" });
  await expect(popover.getByRole("checkbox", { name: /^Admin/ })).toBeDisabled();
  await popover.getByRole("checkbox", { name: /^Part Time Staff/ }).uncheck();
  await page.getByRole("group", { name: "Editing screen text" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();

  // The grid shows what the popover saved.
  await page.goto("/#/settings/permissions");
  await expect(venuesCell(page)).not.toBeChecked();
  // And the popover shows what the grid saves.
  await venuesCell(page).check();
  await saveSettings(page);
  await page.goto("/#/sales/overview");
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Who sees Sales › Venues" }).click();
  await expect(
    page.getByRole("dialog", { name: "Who sees Sales › Venues" }).getByRole("checkbox", { name: /^Part Time Staff/ }),
  ).toBeChecked();
  await page.getByRole("group", { name: "Editing screen text" }).getByRole("button", { name: "Cancel" }).click();
});
