import { test, expect } from "@playwright/test";
test("sidebar, client search, detail tabs, and browser history", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByPlaceholder("Search clients or contacts…").fill("Juniper");
  await page.getByRole("button", { name: "JC Juniper & Co." }).click();
  await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  await expect(page.getByText("Olivia Bennett", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(page.getByText("Event brief.pdf")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
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
test("proposal status rules and lost reason confirmation", async ({ page }) => {
  await page.goto("/#/proposals?view=table");
  await page.getByRole("button", { name: "FB-2026", exact: true }).click();
  await page
    .getByLabel("Proposal stage", { exact: true })
    .selectOption("Signed");
  await expect(page.getByRole("alert")).toContainText(
    "Cannot move Draft to Signed",
  );
  await page.getByLabel("Proposal stage", { exact: true }).selectOption("Sent");
  await expect(page.getByLabel("Proposal stage", { exact: true })).toHaveValue(
    "Sent",
  );
  await page.getByLabel("Proposal stage", { exact: true }).selectOption("Lost");
  await page
    .getByLabel("Loss reason", { exact: true })
    .fill("Client event postponed");
  await page.getByRole("button", { name: "Confirm Lost" }).click();
  await expect(page.getByLabel("Proposal stage", { exact: true })).toHaveValue(
    "Lost",
  );
});
test("client creation validates and saves in memory", async ({ page }) => {
  await page.goto("/#/clients");
  await page.getByRole("button", { name: "New Client", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save client" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Name is required");
  await dialog
    .getByLabel("Name *", { exact: true })
    .fill("Demo Orchard Client");
  await dialog.getByLabel("Main contact *", { exact: true }).fill("Avery Demo");
  await dialog
    .getByLabel("Email *", { exact: true })
    .fill("avery@demo.example");
  await dialog.getByRole("button", { name: "Save client" }).click();
  await expect(
    page.getByRole("button", { name: "DO Demo Orchard Client" }),
  ).toBeVisible();
});

test("Worker health and SPA share an origin", async ({ page, request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    ok: true,
    version: "0.1.0",
    database: "not_configured",
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("legacy routes redirect and retain proposal filters", async ({ page }) => {
  await page.goto("/#/crm/cus-1");
  await expect(page).toHaveURL(/#\/clients\/cli-1$/);
  await expect(
    page.getByRole("heading", { name: "Juniper & Co.", exact: true }),
  ).toBeVisible();
  await page.goto("/#/contracts?view=table&stage=Sent");
  await expect(page).toHaveURL(/#\/proposals\?view=table&stage=Sent$/);
  await expect(
    page.getByRole("heading", { name: "Proposals", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contracts", exact: true }),
  ).toHaveCount(0);
});
