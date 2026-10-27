import { test as base, expect, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { seedUsers } from "../../worker/db/seed";
import { userSchema } from "../../shared/users";
import { resetBrowserDatabase } from "./database";
import { defaultSections } from "./fixtures";
import { testIssuer, testSigningKey } from "./test-auth";
import { responseSchema } from "./response-contracts";

export const signedInUser = userSchema.parse({
  ...seedUsers[0],
  name: "Test Admin",
  invitedAt: "2026-10-20T00:00:00.000Z",
  activatedAt: "2026-10-20T00:00:00.000Z",
});

// Simulate only the external OAuth provider. All /api requests reach the Worker,
// including /auth/config and /auth/me; allowlist and permissions are real.
export async function mockBrowserAuth(
  page: Page,
  { signedIn = true, allowed = true, userId = signedInUser.id } = {},
) {
  const staff = seedUsers.find((u) => u.id === userId)!;
  const sub = allowed ? staff.authId : "ffffffff-0000-4000-8000-000000000001";
  const email = allowed ? staff.email : "not-invited@flowbase.example";
  const name = userId === signedInUser.id ? "Test Admin" : staff.name;
  const accessToken = await new SignJWT({
    email,
    user_metadata: { full_name: name },
    role: "authenticated",
    app_metadata: { providers: ["google"] },
    amr: [{ method: "oauth" }],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(testIssuer)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(testSigningKey);
  const user = {
    id: sub,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { providers: ["google"] },
    user_metadata: { full_name: name },
    created_at: signedInUser.invitedAt,
  };
  const session = {
    access_token: accessToken,
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 7200,
    user,
  };
  await page.addInitScript(
    ({ signedIn, session }) => {
      if (!localStorage.getItem("auth-fixture-initialized")) {
        localStorage.setItem("auth-fixture-initialized", "1");
        if (signedIn)
          localStorage.setItem(
            "sb-test-auth-token",
            JSON.stringify({
              ...session,
              expires_at: Math.floor(Date.now() / 1000) + 7200,
            }),
          );
      }
    },
    { signedIn, session },
  );
  await page.route("https://test.supabase.co/auth/v1/**", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        route.request().headers()["access-control-request-headers"] ||
        "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (
      route.request().method() === "OPTIONS" ||
      route.request().url().includes("/logout")
    )
      return route.fulfill({ status: 204, headers });
    // Supabase's third-party SDK protocol has no Flowbase shared response schema.
    return route.fulfill({
      json: route.request().url().includes("/token") ? session : user,
      headers,
    });
  });
}

export const databaseTest = base.extend<{ database: void; contracts: void }>({
  database: [
    async ({ request }, use) => {
      void request;
      await resetBrowserDatabase(defaultSections);
      await use();
    },
    { auto: true },
  ],
  contracts: [
    async ({ page }, use) => {
      const failures: string[] = [];
      // Forward actual Worker responses without synthesizing data. Reading the
      // upstream body before forwarding also covers fetch/keepalive callers that
      // don't consume their response and avoids CDP body reads hanging on reload.
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        try {
          const response = await route.fetch({ timeout: 10_000 });
          if (response.status() !== 204)
            responseSchema(
              new URL(request.url()).pathname,
              request.method(),
              response.status(),
            ).parse(await response.json());
          await route.fulfill({ response });
        } catch (error) {
          if (!request.failure())
            failures.push(`${request.url()}: ${String(error)}`);
          await route.abort().catch(() => undefined);
        }
      });
      await use();
      await page.unrouteAll({ behavior: "wait" });
      expect(
        failures,
        "Every browser API response must match its shared contract",
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export const test = databaseTest.extend<{ authenticatedWorkspace: void }>({
  authenticatedWorkspace: [
    async ({ page, database }, use) => {
      void database;
      await mockBrowserAuth(page);
      await use();
    },
    { auto: true },
  ],
});
export { expect };
export type { Page } from "@playwright/test";
