import { test, expect, type Page } from "../auth-fixture";

// FLOW-347: every Settings card has a fold arrow at its top right. Settings
// cards start open (A2); a fold is remembered on this device (A1).

const card = (page: Page, title: string) =>
  page.locator("section.panel", { has: page.getByRole("heading", { name: title, exact: true }) });

test("every Settings card folds to its title bar and back, by mouse and keyboard (AC1, AC2)", async ({ page }) => {
  await page.goto("/#/settings");
  for (const title of ["Staff access", "Deleted records", "Company profile", "Lists", "Defaults", "Recent changes", "Time tracking"])
    await expect(card(page, title).getByRole("button", { name: `Fold ${title}` })).toHaveAttribute("aria-expanded", "true");

  const company = card(page, "Company profile");
  await company.getByRole("button", { name: "Fold Company profile" }).click();
  await expect(company.getByRole("heading", { name: "Company profile" })).toBeVisible();
  await expect(company.getByRole("textbox").first()).toBeHidden();
  const unfold = company.getByRole("button", { name: "Unfold Company profile" });
  await expect(unfold).toHaveAttribute("aria-expanded", "false");

  // Remembered on this device after a reload (A1).
  await page.reload();
  await expect(unfold).toHaveAttribute("aria-expanded", "false");

  // Keyboard: focus the arrow, Enter and Space toggle.
  await unfold.focus();
  await page.keyboard.press("Enter");
  await expect(company.getByRole("button", { name: "Fold Company profile" })).toHaveAttribute("aria-expanded", "true");
  await expect(company.getByRole("textbox").first()).toBeVisible();
  await page.keyboard.press(" ");
  await expect(unfold).toHaveAttribute("aria-expanded", "false");
});

test("a folded card keeps its live-edit chrome (AC4)", async ({ page }) => {
  await page.goto("/#/settings");
  await card(page, "Company profile").getByRole("button", { name: "Fold Company profile" }).click();
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await expect(page.getByRole("button", { name: "Hide on phone: Company", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Company", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete Company?", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(card(page, "Company profile")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card(page, "Company profile")).toHaveCount(1);
});
