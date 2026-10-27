import { databaseTest as test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";

test("part-time kitchen staff can read venues without creation or user management", async ({
  page,
}) => {
  await mockBrowserAuth(page, {
    userId: seedUsers.find(
      (u) => u.role === "kitchen_staff" && u.employmentType === "part_time",
    )!.id,
  });
  await page.goto("/#/venues");
  await expect(
    page.getByRole("heading", { name: "Venues", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 venues", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Venue" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await expect(
    page.getByRole("link", { name: "Employee profile" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage users" })).toHaveCount(0);
});
