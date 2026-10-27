import { test, expect } from "./auth-fixture";

// Vendor and distributor directory (FLOW-84): create a vendor, then find it from
// the header search (AC4).
test("creates a vendor and finds it in the global search", async ({ page }) => {
  await page.goto("/#/vendors");
  await page.getByRole("button", { name: "New Vendor", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // AC1: the form has no password field.
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
  await dialog.getByLabel("Name *", { exact: true }).fill("Imperio");
  // A select's accessible name includes its selected option ("Type Food
  // distributor"), so match the start.
  await dialog
    .getByRole("combobox", { name: /^Type\b/ })
    .selectOption({ label: "Beverage distributor" });
  await dialog
    .getByLabel("Vendor portal URL", { exact: true })
    .fill("https://portal.imperio.example");
  await dialog.getByLabel("Account number", { exact: true }).fill("IMP-4410");
  await dialog
    .getByLabel("Order cutoff", { exact: true })
    .fill("Tuesday 2 pm for Thursday delivery");
  await dialog.getByLabel("Thu", { exact: true }).check();
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await dialog.getByLabel("Contact name *", { exact: true }).fill("Dana Reyes");
  await dialog.getByLabel("Email", { exact: true }).fill("dana@imperio.example");
  await dialog.getByRole("button", { name: "Save vendor" }).click();
  await expect(
    page.getByRole("heading", { name: "Imperio", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("IMP-4410")).toBeVisible();
  await expect(page.getByText("Dana Reyes")).toBeVisible();
  await expect(page.getByText("No items yet.")).toBeVisible();

  await page.goto("/#/");
  await page.getByRole("button", { name: "Search anything" }).click();
  await page
    .getByPlaceholder("Search clients, leads, events, venues, items, vendors…")
    .fill("imperoi");
  const result = page.getByRole("button", { name: /Imperio/ });
  await expect(result).toContainText("Vendor · Beverage distributor");
  await result.click();
  await expect(
    page.getByRole("heading", { name: "Imperio", level: 1 }),
  ).toBeVisible();
});
