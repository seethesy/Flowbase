import { test, expect, type Page } from "../auth-fixture";
import { browserDb } from "../database";
import * as s from "../../../worker/db/schema";

// FLOW-277: saved edits that no longer match a screen, on the real Worker and
// database (AC3), and the nav label kept by its fixed key (AC5).
const notice = (page: Page) => page.getByRole("region", { name: "Saved edits that no longer match a screen" });

test("lists orphaned edits; Delete removes one and Move to key re-keys another (AC3)", async ({ page }) => {
  await browserDb(async (db) => {
    await db.insert(s.uiCopy).values([
      { key: "retired.screen.title", text: "Old title" },
      { key: "retired.screen.heading", text: "Our venues" },
    ]);
    await db.insert(s.uiLayout).values({
      pageKey: "venues.list",
      layout: { version: 1, blocks: [{ kind: "builtin", id: "gone-section", x: 0, y: 0, w: 12, h: 8 }], tables: {}, fieldBoxes: {} },
    });
  });
  await page.goto("/#/venues");
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await notice(page).getByRole("button", { name: "3 saved edits no longer match a screen" }).click();

  const title = notice(page).getByRole("listitem").filter({ hasText: "Old title" });
  await title.getByRole("button", { name: "Delete" }).click();
  await expect(notice(page).getByRole("button", { name: "2 saved edits no longer match a screen" })).toBeVisible();

  const heading = notice(page).getByRole("listitem").filter({ hasText: "Our venues" });
  await heading.getByRole("button", { name: "Move to key" }).click();
  await heading.getByRole("textbox", { name: "New wording key" }).fill("nav.venues");
  await heading.getByRole("button", { name: "Move", exact: true }).click();
  await expect(notice(page).getByRole("button", { name: "1 saved edit no longer matches a screen" })).toBeVisible();
  // The moved text now names the Venues tab.
  await expect(page.getByRole("navigation", { name: "Sales pages" }).getByText("Our venues")).toBeVisible();

  await notice(page).getByRole("listitem").filter({ hasText: "gone-section" }).getByRole("button", { name: "Delete" }).click();
  await expect(notice(page)).toHaveCount(0);
  const rows = await browserDb((db) => db.select({ key: s.uiCopy.key }).from(s.uiCopy));
  expect(rows.map((row) => row.key)).toEqual(["nav.venues"]);
});

test("keeps the saved Approvals label under its fixed key (AC5)", async ({ page, isMobile }) => {
  test.skip(isMobile, "The section tabs are the same on phones; one viewport is enough.");
  await browserDb((db) => db.insert(s.uiCopy).values({ key: "nav.approvals", text: "Today" }));
  await page.goto("/#/approvals");
  await expect(page.getByRole("navigation", { name: "Dashboard pages" }).getByText("Today", { exact: true })).toBeVisible();
});
