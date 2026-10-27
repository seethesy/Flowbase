import { databaseTest as test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedDatabase, seedId } from "../../worker/db/seed";

test("real record routes make no demo requests and inventory has no demo quick create", async ({ page }) => {
  await seedDatabase(process.env.DATABASE_URL);
  await mockBrowserAuth(page);
  const demoRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/demo/")) demoRequests.push(request.url());
  });
  await page.goto("/#/clients");
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  await page.goto(`/#/clients/${seedId(3, 1)}`);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Juniper & Co.");
  await page.goto("/#/inventory");
  await expect(page.getByRole("button", { name: /quick (new|create)/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  expect(demoRequests).toEqual([]);
});
