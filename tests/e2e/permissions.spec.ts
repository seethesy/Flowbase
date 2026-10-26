import { test, expect, signedInUser } from "./auth-fixture";

test("part-time kitchen staff can read venues without creation or user management", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        ...signedInUser,
        role: "kitchen_staff",
        employmentType: "part_time",
      },
    }),
  );
  await page.route("**/api/venues", (route) => route.fulfill({ json: [] }));
  await page.goto("/#/venues");
  await expect(
    page.getByRole("heading", { name: "Venues", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 venues", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Venue" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await expect(page.getByRole("link", { name: "Employee profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage users" })).toHaveCount(0);
});
