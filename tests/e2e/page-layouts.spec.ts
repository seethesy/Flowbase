import { test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import { choose } from "./dropdown";

// Page layouts (FLOW-253/254), against the real Worker and database: an Admin
// hides a column, adds a text block and colors it, saves for everyone, and
// resets the page.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;

test("saves columns and a text block for everyone, then resets the page", async ({ page, browser }) => {
  await page.goto("/#/venues");
  await expect(page.getByRole("columnheader", { name: /Address/ })).toBeVisible();
  await page.getByRole("button", { name: "Edit screen text" }).click();
  const toolbar = page.getByRole("toolbar", { name: "Page layout" });
  await expect(toolbar).toBeVisible();

  // Columns (FLOW-254): Venue is required; Address can go.
  await page.getByRole("button", { name: "Columns" }).click();
  const picker = page.getByRole("dialog", { name: "Columns" });
  await expect(picker.getByRole("checkbox", { name: "Show Venue" })).toBeDisabled();
  await picker.getByRole("checkbox", { name: "Show Address" }).click();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("columnheader", { name: /Address/ })).toHaveCount(0);

  // A heading block, colored; a low-contrast pair blocks Save (FLOW-253 AC).
  await choose(toolbar.getByRole("combobox", { name: "Add text" }), "heading");
  await page.getByRole("textbox", { name: "Heading text" }).fill("Partner venues");
  await page.getByRole("button", { name: "Style Heading" }).click();
  const style = page.getByRole("dialog", { name: "Style" });
  await style.getByRole("textbox", { name: "Text color hex" }).fill("#e8e7e7");
  await expect(style.getByRole("alert")).toContainText("hard to read");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await style.getByRole("button", { name: "Text color: Primary" }).click();
  await expect(style.getByRole("alert")).toHaveCount(0);
  await style.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Partner venues" })).toBeVisible();

  // Everyone sees the saved layout; no layout chrome without layout.edit.
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/venues");
  await expect(other.getByRole("heading", { name: "Partner venues" })).toBeVisible();
  await expect(other.getByRole("columnheader", { name: /Address/ })).toHaveCount(0);
  await expect(other.getByRole("toolbar", { name: "Page layout" })).toHaveCount(0);
  await context.close();

  // Reset page layout: back to the code default, colors included.
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await toolbar.getByRole("button", { name: "Reset page layout" }).click();
  await page.getByRole("alertdialog", { name: "Reset page layout?" }).getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Partner venues" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: /Address/ })).toBeVisible();
});
