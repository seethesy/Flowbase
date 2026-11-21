import { databaseTest as test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import type { Role } from "../../shared/access";

const expected: Record<Role, string[]> = {
  admin: ["My Leads", "My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  technical: ["My Leads", "My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  sales_manager: ["My Leads", "My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  salesperson: ["My Leads", "My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  kitchen_lead: ["My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  kitchen_staff: ["My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  staff: ["My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
  part_time_staff: ["My Tasks", "All Tasks", "Upcoming Events", "Working Staff"],
};

for (const [role, labels] of Object.entries(expected) as [Role, string[]][]) {
  test(`${role} sees its permitted dashboard cards`, async ({ page }) => {
    const user = seedUsers.find((candidate) => candidate.role === role)!;
    await mockBrowserAuth(page, { userId: user.id });
    await page.goto("/#/");
    const cards = page.locator(".dashboard-card");
    await expect(cards).toHaveCount(labels.length);
    for (const label of labels) await expect(cards.getByRole("heading", { name: new RegExp(label) })).toBeVisible();
  });
}

test("manager can filter and export operational reports", async ({ page }) => {
  const user = seedUsers.find((candidate) => candidate.role === "sales_manager")!;
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
