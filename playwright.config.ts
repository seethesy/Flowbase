import { defineConfig, devices } from "@playwright/test";
import { assertTestDatabaseUrl } from "./tests/db/test-database";
const browserDatabaseUrl = assertTestDatabaseUrl(process.env.DATABASE_URL);
export default defineConfig({
  testDir: "./tests/e2e",
  // One disposable database, one Worker, deterministic per-test fixture resets.
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  retries: process.env.CI ? 2 : 0,
  // Stop repeated systemic failures early instead of exhausting the CI budget.
  maxFailures: process.env.CI ? 3 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command:
      "npm run dev:worker -- --config tests/e2e/wrangler.jsonc --local --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    env: {
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
        browserDatabaseUrl,
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
