import { expect, mockBrowserAuth, test, type Page } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";

// Live text editing (FLOW-240): the admin rewords screens in place.
const editor = (page: Page) => page.getByRole("dialog", { name: "Edit wording" });
const headerButton = (page: Page, name: string) =>
  page.locator(".top-header").getByRole("button", { name, exact: true });
// On phones the sidebar is a drawer: open it when it's closed.
async function sidebar(page: Page, isMobile: boolean) {
  if (isMobile && !(await page.locator(".sidebar.mobile-open").count()))
    await page.getByRole("button", { name: "Open navigation" }).click();
  return page.locator(".primary-nav");
}
async function rewrite(page: Page, text: string) {
  await editor(page).getByRole("textbox").fill(text);
  await editor(page).getByRole("button", { name: "Done" }).click();
}
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test("the admin rewords a sidebar label and an empty state for everyone (AC2, AC8)", async ({
  page,
  browser,
  isMobile,
}) => {
  await page.goto("/#/clients");
  await expect(heading(page)).toHaveText("Clients");
  await expect(page.getByText("No records found")).toBeVisible();
  await headerButton(page, "Edit wording").click();
  await expect(headerButton(page, "Save")).toBeDisabled();

  // Clicking the label inside a link edits it and doesn't follow the link.
  const nav = await sidebar(page, isMobile);
  await nav.getByText("Venues", { exact: true }).click();
  await expect(page).toHaveURL(/#\/clients$/);
  await rewrite(page, "Locations");
  if (isMobile) await page.getByRole("button", { name: "Close mobile navigation" }).click();
  await page.getByText("No records found").click();
  await rewrite(page, "Nothing here yet");
  await headerButton(page, "Save").click();
  await expect(headerButton(page, "Edit wording")).toBeVisible();
  await expect(page.getByText("Nothing here yet")).toBeVisible();

  // Another user sees the new wording, and gets no pencil (AC1).
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await context.newPage();
  await mockBrowserAuth(other, {
    userId: seedUsers.find((u) => u.role === "salesperson")!.id,
  });
  await other.goto("/#/clients");
  await expect(other.getByText("Nothing here yet")).toBeVisible();
  // A fresh context has the desktop layout.
  const otherNav = await sidebar(other, false);
  await expect(otherNav.getByRole("link", { name: "Locations" })).toBeVisible();
  await expect(otherNav.getByRole("link", { name: "Venues" })).toHaveCount(0);
  await expect(headerButton(other, "Edit wording")).toHaveCount(0);
  await context.close();
});

test("cancel discards edits, and a broken placeholder blocks Save (AC3, AC5)", async ({ page }) => {
  await page.goto("/#/clients");
  await expect(heading(page)).toHaveText("Clients");
  await headerButton(page, "Edit wording").click();
  await heading(page).getByText("Clients").click();
  await rewrite(page, "Customers");
  await expect(heading(page)).toHaveText("Customers");

  // The list's "0–0 of 0 …" line has live values.
  await page.locator(".pagination").getByText(/of 0/).click();
  await editor(page).getByRole("textbox").fill("Showing {first} to {last}");
  await expect(editor(page).getByRole("alert")).toHaveText("Keep {label}, {total} in the text.");
  await expect(headerButton(page, "Save")).toBeDisabled();
  await editor(page).getByRole("textbox").fill("Showing {fist} to {last} of {total} {label}");
  await expect(editor(page).getByRole("alert")).toHaveText("Keep {first} in the text.");
  await editor(page).getByRole("button", { name: "Done" }).click();
  await expect(headerButton(page, "Save")).toBeDisabled();

  await headerButton(page, "Cancel").click();
  await expect(heading(page)).toHaveText("Clients");
  await expect(page.locator(".pagination")).toContainText("0–0 of 0");
  await expect(headerButton(page, "Edit wording")).toBeVisible();
  await page.reload();
  await expect(heading(page)).toHaveText("Clients");
});

test("leaving a page with unsaved edits asks Save, Discard or Stay (AC4)", async ({
  page,
  isMobile,
}) => {
  await page.goto("/#/clients");
  await expect(heading(page)).toHaveText("Clients");
  await headerButton(page, "Edit wording").click();
  const guard = page.getByRole("alertdialog", { name: "Save your wording changes?" });
  const edit = async (text: string) => {
    await heading(page).getByText(/./).first().click();
    await rewrite(page, text);
  };
  // In edit mode the link's icon still navigates; its label edits.
  const leave = async (to: string) =>
    (await sidebar(page, isMobile)).getByRole("link", { name: to }).locator("svg").click();

  await edit("Customers");
  await leave("Venues");
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Stay" }).click();
  await expect(guard).toHaveCount(0);
  await expect(page).toHaveURL(/#\/clients$/);
  await expect(heading(page)).toHaveText("Customers");

  await leave("Venues");
  await guard.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(/#\/venues$/);
  // Edit mode stays on across pages.
  await expect(headerButton(page, "Cancel")).toBeVisible();
  await page.goBack();
  await expect(heading(page)).toHaveText("Clients");

  await edit("Customers");
  await leave("Venues");
  await guard.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/venues$/);
  await page.goBack();
  await expect(heading(page)).toHaveText("Customers");
});
