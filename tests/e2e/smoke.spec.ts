import { test, expect } from "./auth-fixture";
import { juniper } from "./fixtures";
import { seedRecords } from "./database";
test("sidebar, client search, detail tabs, and browser history", async ({
  page,
  isMobile,
}) => {
  await seedRecords({ clients: [juniper()] });
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
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
});
test("Worker health and SPA share an origin", async ({ page, request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    ok: true,
    version: "0.1.0",
    database: "reachable",
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});

test("legacy routes redirect and retain proposal filters", async ({ page }) => {
  await page.goto("/#/crm/cus-1");
  await expect(page).toHaveURL(/#\/clients\/cli-1$/);
  // Prototype ids aren't real client ids, so the page explains it can't load one.
  await expect(page.getByRole("link", { name: "← All clients" })).toBeVisible();
  await page.goto("/#/contracts?view=table&stage=Sent");
  await expect(page).toHaveURL(/#\/proposals\?view=table&stage=Sent$/);
  await expect(
    page.getByRole("heading", { name: "Proposals", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Contracts", exact: true }),
  ).toHaveCount(0);
});
