import { databaseTest as test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import type { Role } from "../../shared/access";

const expected: Record<Role, string[]> = {
  admin: ["Pending approvals", "Collector health", "Free-tier usage", "Leads awaiting assignment"],
  technical: ["Free-tier usage", "Collector health", "Failed jobs", "Failed ingest receipts"],
  sales_manager: ["BEO approvals", "Inventory conflicts", "Production alerts", "Upcoming events", "Leads in triage"],
  salesperson: ["New leads", "Follow-ups due", "Proposals awaiting approval", "Awaiting client response", "Unpaid balances"],
  kitchen_lead: ["Kitchen tasks", "Upcoming menus", "Low stock", "Order list status"],
  kitchen_staff: ["Kitchen tasks", "Upcoming menus", "Low stock", "Order list status"],
  staff: ["My tasks", "My shifts"],
};

for (const [role, labels] of Object.entries(expected) as [Role, string[]][]) {
  test(`${role} sees only its home widgets`, async ({ page }) => {
    const user = seedUsers.find((candidate) => candidate.role === role && candidate.employmentType === "full_time")!;
    await mockBrowserAuth(page, { userId: user.id });
    await page.goto("/#/");
    const widgets = page.locator(".home-widget");
    await expect(widgets).toHaveCount(labels.length);
    for (const label of labels) await expect(widgets.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByText("Sample data")).toHaveCount(0);
  });
}

test("manager can filter and export operational reports", async ({ page }) => {
  const user = seedUsers.find((candidate) => candidate.role === "sales_manager" && candidate.employmentType === "full_time")!;
  await mockBrowserAuth(page, { userId: user.id });
  await page.goto("/#/reports/operations");
  await expect(page.getByRole("heading", { name: "Operational reports" })).toBeVisible();
  await expect(page.getByText("Rental utilization")).toBeVisible();
  await page.getByLabel("Report from").fill("2026-10-01");
  await page.getByLabel("Report to").fill("2026-11-30");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("operational-reports.csv");
});
