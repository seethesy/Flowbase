import { test, expect } from "@playwright/test";
import { mockBrowserAuth, signedInUser } from "./auth-fixture";

test("an invited Google account reaches its current route and can sign out", async ({
  page,
}) => {
  await mockBrowserAuth(page);
  await page.goto("/#/profile");
  await expect(page.getByRole("heading", { name: "Test Admin" })).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Flowbase" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/profile$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to Flowbase" }),
  ).toBeVisible();
});
test("an uninvited account sees a clear refusal without mounting the workspace", async ({
  page,
}) => {
  await mockBrowserAuth(page, { allowed: false });
  await page.goto("/#/proposals?view=table");
  await expect(page.getByRole("alert")).toContainText(
    "isn't invited or is inactive",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Proposals", exact: true }),
  ).toHaveCount(0);
});
test("OAuth callback errors clear the callback and show an invitation message", async ({
  page,
}) => {
  await mockBrowserAuth(page, { signedIn: false });
  await page.goto("/?error=access_denied&error_description=not_invited");
  await expect(page.getByRole("alert")).toContainText("isn't invited");
  await expect(page).not.toHaveURL(/error_description/);
});
test("a 401 returns to Google sign-in and retains the route and its filters", async ({
  page,
}) => {
  await mockBrowserAuth(page);
  await page.route("**/api/admin/users", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Expired session.",
          requestId: "expired-test",
        },
      },
    }),
  );
  await page.goto("/#/settings/users?status=pending");
  await expect(
    page.getByRole("heading", { name: "Sign in to Flowbase" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("flowbase.return-route")),
  ).toBe("#/settings/users?status=pending");
});
test("a PKCE callback returns an invited user to the saved route", async ({
  page,
}) => {
  await mockBrowserAuth(page, { signedIn: false });
  await page.addInitScript(() => {
    sessionStorage.setItem("flowbase.return-route", "#/profile");
    localStorage.setItem(
      "sb-test-auth-token-code-verifier",
      JSON.stringify("test-code-verifier"),
    );
  });
  await page.goto("/?code=mock-oauth-code");
  await expect(page.getByRole("heading", { name: "Test Admin" })).toBeVisible();
  await expect(page).toHaveURL(/#\/profile$/);
});

test("Admin can invite staff, resend/revoke pending invites, and deactivate/reactivate active users", async ({
  page,
}) => {
  await mockBrowserAuth(page);
  let staff = {
    ...signedInUser,
    id: "36000000-0000-4000-8000-000000000004",
    name: "staff@gmail.com",
    email: "staff@gmail.com",
    status: "pending",
    role: "staff",
  };
  let added = false;
  await page.route("**/api/admin/users**", async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method === "GET") return route.fulfill({ json: added ? [staff] : [] });
    if (path === "/api/admin/users") {
      expect(route.request().postDataJSON()).toMatchObject({
        email: staff.email,
        role: "staff",
        employmentType: "part_time",
        mobile: "2025550102",
      });
      staff = { ...staff, ...route.request().postDataJSON() };
      added = true;
    } else {
      const action = path.split("/").at(-1);
      if (action === "revoke") staff.status = "revoked";
      if (action === "deactivate") staff.status = "deactivated";
      if (action === "reactivate") staff.status = "active";
    }
    return route.fulfill({
      json: staff,
      status: path === "/api/admin/users" ? 201 : 200,
    });
  });
  await page.goto("/#/settings/users");
  await page.getByLabel("Email", { exact: true }).fill(staff.email);
  await page.getByLabel("Employment type").selectOption("part_time");
  await page.getByLabel("Mobile number").fill("2025550102");
  await page.getByRole("button", { name: "Send invite", exact: true }).click();
  await expect(
    page.getByText("staff@gmail.com", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resend invite" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Invitation email sent.",
  );
  await page.getByRole("button", { name: "Revoke invite" }).click();
  await expect(page.getByText("2025550102 · Revoked")).toBeVisible();
  staff = { ...staff, name: "Staff Person", status: "active" };
  await page.reload();
  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByText("2025550102 · Deactivated")).toBeVisible();
  await page.getByRole("button", { name: "Reactivate", exact: true }).click();
  await expect(page.getByText("Staff Person", { exact: true })).toBeVisible();
  await expect(page.getByText("2025550102 · Active")).toBeVisible();
});
