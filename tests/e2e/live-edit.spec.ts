import { test, expect, mockBrowserAuth, type Page } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";

// Admin live text editing (FLOW-240), against the real Worker and database.
const salesperson = seedUsers.find((user) => user.role === "salesperson" && user.employmentType === "full_time")!;
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const editor = (page: Page) => page.getByRole("dialog", { name: "Edit text" });
const startEditing = async (page: Page) => {
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
};

test("saves a sidebar label and an empty state for everyone (AC2, AC8)", async ({ page, browser }) => {
  await page.goto("/#/venues");
  await expect(page.getByText("No records found")).toBeVisible();
  await startEditing(page);
  // A click on text inside a link edits it and does not navigate (AC8).
  await sidebar(page).getByText("Sales", { exact: true }).click();
  await expect(page).toHaveURL(/#\/venues$/);
  await editor(page).getByRole("textbox", { name: "Text" }).fill("Selling");
  await editor(page).getByRole("button", { name: "Done" }).click();
  await page.getByText("No records found").click();
  await editor(page).getByRole("textbox", { name: "Text" }).fill("<b>Nothing here yet</b>");
  await expect(sidebar(page).getByText("Selling", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();

  // Another user sees the new wording, as plain text (AC7), and no pencil (AC1).
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/venues");
  await expect(sidebar(other).getByText("Selling", { exact: true })).toBeVisible();
  await expect(other.getByText("<b>Nothing here yet</b>")).toBeVisible();
  await expect(other.getByRole("button", { name: "Edit screen text" })).toHaveCount(0);
  await context.close();
});

test("Cancel discards every pending edit (AC3)", async ({ page }) => {
  await page.goto("/#/venues");
  await startEditing(page);
  await sidebar(page).getByText("Sales", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Text" }).fill("Selling");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(sidebar(page).getByText("Sales", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  await page.reload();
  await expect(sidebar(page).getByText("Sales", { exact: true })).toBeVisible();
});

test("asks Save, Discard or Stay before leaving with unsaved edits (AC4)", async ({ page }) => {
  // In edit mode a click on a link's text edits it, so these clicks hit the icon.
  const go = (heading: string) => sidebar(page).getByRole("link", { name: heading }).locator("svg").click();
  await page.goto("/#/venues");
  await startEditing(page);
  await page.getByText("No records found").click();
  await editor(page).getByRole("textbox", { name: "Text" }).fill("Nothing yet");
  await editor(page).getByRole("button", { name: "Done" }).click();
  const prompt = page.getByRole("dialog", { name: "Save your text changes?" });

  await go("Events");
  await prompt.getByRole("button", { name: "Stay" }).click();
  await expect(prompt).toBeHidden();
  await expect(page).toHaveURL(/#\/venues$/);
  await expect(page.getByText("Nothing yet")).toBeVisible();

  await go("Events");
  await prompt.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(/#\/calendar$/);
  // Edit mode stays on across pages.
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();

  await sidebar(page).getByText("Kitchen", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Text" }).fill("Kitchen team");
  await go("Inventory");
  await prompt.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/inventory$/);
  await expect(sidebar(page).getByText("Kitchen team", { exact: true })).toBeVisible();
  await page.goto("/#/venues");
  await expect(page.getByText("No records found")).toBeVisible();
});

test("blocks Save while a placeholder is missing (AC5)", async ({ page }) => {
  await page.goto("/#/venues");
  await startEditing(page);
  // The left edge: the list label ("venues") is its own string at the end.
  await page.getByText(/^0–0 of 0/).click({ position: { x: 2, y: 4 } });
  await editor(page).getByRole("textbox", { name: "Text" }).fill("{first} of {total} {label}");
  await expect(editor(page).getByRole("alert")).toHaveText("Keep {last} in the text");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await editor(page).getByRole("textbox", { name: "Text" }).fill("{first}–{last} of {total} {label} shown");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("resets a saved string to its default (AC6)", async ({ page }) => {
  await page.goto("/#/venues");
  await startEditing(page);
  await sidebar(page).getByText("Sales", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Text" }).fill("Selling");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sidebar(page).getByText("Selling", { exact: true })).toBeVisible();
  await startEditing(page);
  await sidebar(page).getByText("Selling", { exact: true }).click();
  await editor(page).getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(sidebar(page).getByText("Sales", { exact: true })).toBeVisible();
});
