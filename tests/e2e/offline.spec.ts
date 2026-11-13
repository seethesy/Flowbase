import { test as base, expect } from "@playwright/test";
import { mockBrowserAuth, signedInUser } from "./auth-fixture";
import * as s from "../../worker/db/schema";
import { defaultSections, fallGala, juniper } from "./fixtures";
import { browserDb, resetBrowserDatabase, seedRecords } from "./database";

// Offline BEO access (FLOW-150, ADR-18), in WebKit: Safari is the browser the crew
// uses. The service worker keeps the app available, and the BEO is read from the
// copy saved in IndexedDB. This spec turns the service worker on (see the
// webkit-offline project) and goes offline mid-test, so the shared "every API
// response matches its contract" check is replaced by plain assertions.
const test = base.extend<{ workspace: void }>({
  workspace: [
    async ({ page }, use) => {
      await resetBrowserDatabase(defaultSections);
      await mockBrowserAuth(page);
      await use();
    },
    { auto: true },
  ],
});

const savedBeoCount = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("flowbase-offline");
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("beos")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction("beos").objectStore("beos").count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
  );

test("an assigned BEO opens with the network off, shows when it was synced, and signing out removes it", async ({
  page,
  context,
}) => {
  // An event the signed-in person leads, two days from now.
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await seedRecords({
    clients: [juniper()],
    events: [{ ...fallGala(), date, productionLeadId: signedInUser.id }],
  });
  await browserDb(async (db) => {
    await db
      .insert(s.beos)
      .values({ eventId: fallGala().id, status: "approved", approvedAt: new Date() });
  });

  // One online visit: the app is cached and the BEO is saved.
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => savedBeoCount(page), { timeout: 20_000 }).toBe(1);

  // AC1: with the network off, the BEO still opens.
  await context.setOffline(true);
  await page.goto("/");
  await expect(page).toHaveURL(/#\/offline$/);
  await expect(page.getByRole("heading", { name: "BEOs available offline" })).toBeVisible();
  await page.getByRole("link", { name: "Fall gala" }).click();
  await expect(page.getByRole("heading", { name: "Fall gala", level: 1 })).toBeVisible();
  await expect(page.getByText("Banquet event order").first()).toBeVisible();
  // It is read-only offline.
  await expect(page.getByRole("button", { name: "Edit setup details and notes" })).toHaveCount(0);
  // AC2: the last-synced time.
  await expect(page.getByTestId("offline-status")).toContainText("Available offline · last synced");

  // AC3: signing out removes the saved BEOs.
  await context.setOffline(false);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(() => savedBeoCount(page), { timeout: 10_000 }).toBe(0);
});
