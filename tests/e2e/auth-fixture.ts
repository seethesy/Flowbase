import { test as base, expect, type Page } from "@playwright/test";
import { clients, proposals, inventory } from "../../src/data/mock/fixtures";

export const signedInUser = {
  id: "36000000-0000-4000-8000-000000000003",
  name: "Test Admin",
  email: "admin@gmail.com",
  role: "admin",
  employmentType: "full_time",
  mobile: "2025550101",
  status: "active",
  invitedAt: "2026-10-20T00:00:00.000Z",
  activatedAt: "2026-10-20T00:00:00.000Z",
};
export async function mockBrowserAuth(
  page: Page,
  { signedIn = true, allowed = true } = {},
) {
  const user = {
    id: signedInUser.id,
    aud: "authenticated",
    role: "authenticated",
    email: signedInUser.email,
    app_metadata: { providers: ["google"] },
    user_metadata: { full_name: signedInUser.name },
    created_at: signedInUser.invitedAt,
  };
  const session = {
    access_token: "mock-access-token",
    refresh_token: "mock-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  await page.addInitScript(
    ({ signedIn, session }) => {
      // Seed only once per browser context, so sign-out survives a reload.
      if (!localStorage.getItem("auth-fixture-initialized")) {
        localStorage.setItem("auth-fixture-initialized", "1");
        if (signedIn)
          localStorage.setItem(
            "sb-test-auth-token",
            JSON.stringify({
              ...session,
              // Use the browser's clock, including the tracking suite's fake date.
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            }),
          );
      }
    },
    { signedIn, session },
  );
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({
      json: {
        url: "https://test.supabase.co",
        publishableKey: "test-publishable-key",
      },
    }),
  );
  await page.route("https://test.supabase.co/auth/v1/**", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        route.request().headers()["access-control-request-headers"] ||
        "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (route.request().url().includes("/logout"))
      return route.fulfill({ status: 204, headers });
    if (route.request().url().includes("/token"))
      return route.fulfill({ json: session, headers });
    return route.fulfill({ json: user, headers });
  });
  await page.route("**/api/auth/me", async (route) => {
    if (allowed) {
      expect(route.request().headers().authorization).toBe(
        "Bearer mock-access-token",
      );
      return route.fulfill({ json: signedInUser });
    }
    return route.fulfill({
      status: 403,
      json: {
        error: {
          code: "ACCOUNT_NOT_ALLOWED",
          message:
            "Your account isn't invited or is inactive. Contact your Admin.",
          requestId: "auth-test",
        },
      },
    });
  });
  // Other browser suites exercise their existing fake record APIs. Keep demo
  // fixtures here too: the real Worker now requires a verifiable JWT for them.
  const fixtures = { clients, proposals, inventory };
  await page.route("**/api/demo/**", (route) => {
    const resource = new URL(route.request().url()).pathname.split(
      "/",
    )[3] as keyof typeof fixtures;
    const method = route.request().method();
    if (method === "DELETE") return route.fulfill({ status: 204 });
    return route.fulfill({
      json:
        method === "GET" ? fixtures[resource] : route.request().postDataJSON(),
    });
  });
}

export const test = base.extend<{ authenticatedWorkspace: void }>({
  authenticatedWorkspace: [
    async ({ page }, use) => {
      await mockBrowserAuth(page);
      await use();
    },
    { auto: true },
  ],
});
export { expect };
export type { Page } from "@playwright/test";
