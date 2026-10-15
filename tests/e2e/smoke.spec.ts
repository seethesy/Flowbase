import { test, expect } from "@playwright/test";
test("sidebar, customer search, detail tabs, and browser history", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "CRM", exact: true }).click();
  await page.getByPlaceholder("Search customers or contacts…").fill("Juniper");
  await page.getByRole("button", { name: "JC Juniper & Co." }).click();
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await expect(page.getByText("Olivia Bennett", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(page.getByText("Event brief.pdf")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Customers", exact: true }),
  ).toBeVisible();
});
test("inventory detail, simulated receipt, and keyboard dialog close", async ({
  page,
}) => {
  await page.goto("/#/inventory");
  await page.getByPlaceholder("Search item name or SKU…").fill("INV-001");
  await page.getByRole("button", { name: "INV-001", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Organic mixed greens" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Simulate receipt" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quantity change (kg)").fill("25");
  await dialog
    .getByLabel("Reason / reference *", { exact: true })
    .fill("PO-demo");
  await dialog.getByRole("button", { name: "Apply simulation" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("tab", { name: "Stock History" }).click();
  await expect(
    page.getByText("Simulated receipt", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
});
test("contract status rules and lost reason confirmation", async ({ page }) => {
  await page.goto("/#/contracts?view=table");
  await page.getByRole("button", { name: "FB-2026", exact: true }).click();
  await page
    .getByLabel("Contract stage", { exact: true })
    .selectOption("Signed");
  await expect(page.getByRole("alert")).toContainText(
    "Cannot move Draft to Signed",
  );
  await page.getByLabel("Contract stage", { exact: true }).selectOption("Sent");
  await expect(page.getByLabel("Contract stage", { exact: true })).toHaveValue(
    "Sent",
  );
  await page.getByLabel("Contract stage", { exact: true }).selectOption("Lost");
  await page
    .getByLabel("Loss reason", { exact: true })
    .fill("Customer event postponed");
  await page.getByRole("button", { name: "Confirm Lost" }).click();
  await expect(page.getByLabel("Contract stage", { exact: true })).toHaveValue(
    "Lost",
  );
});
test("customer creation validates and saves in memory", async ({ page }) => {
  await page.goto("/#/crm");
  await page.getByRole("button", { name: "New Customer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save customer" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Name is required");
  await dialog
    .getByLabel("Name *", { exact: true })
    .fill("Demo Orchard Client");
  await dialog.getByLabel("Main contact *", { exact: true }).fill("Avery Demo");
  await dialog
    .getByLabel("Email *", { exact: true })
    .fill("avery@demo.example");
  await dialog.getByRole("button", { name: "Save customer" }).click();
  await expect(
    page.getByRole("button", { name: "DO Demo Orchard Client" }),
  ).toBeVisible();
});
