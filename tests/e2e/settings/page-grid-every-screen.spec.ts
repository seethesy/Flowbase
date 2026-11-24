import { inArray } from "drizzle-orm";
import { test, expect, type Page } from "../auth-fixture";
import { browserDb, seedLeads, seedRecords } from "../database";
import { fallGala, juniper, lead } from "../fixtures";
import { uiLayout } from "../../../worker/db/schema";

// FLOW-322 AC5, extending layout-every-screen.spec.ts: every screen's page
// grids enter live edit with their guides drawn, take an edit, and save as
// version 2 without a validation error. Print, sign-in and offline screens
// have no page grid (FLOW-283).

const screens = [
  "/", "/leads", "/leads/dashboard", "/clients", "/contracts", "/proposals", "/sales", "/sales/reports",
  "/sales/overview", "/marketing/overview", "/documents/overview", "/reports/overview",
  "/inventory", "/inventory/order", "/inventory/orders", "/purchasing", "/inventory/low-stock", "/kitchen/orders",
  "/approvals", "/kitchen/ingredients", "/inventory/bar", "/inventory/master", "/inventory/counts", "/inventory/sections",
  "/recipes", "/kitchen/overview", "/kitchen/menus", "/recipes/client", "/events", "/events/overview", "/calendar",
  "/beos", "/day-of", "/production", "/venues", "/vendors", "/staff", "/staffing/schedule", "/staffing/payroll",
  "/marketing", "/kitchen/photos", "/documents", "/profile", "/tasks", "/tasks/all", "/tasks/templates", "/sops",
  "/reports", "/reports/operations", "/settings", "/settings/imports", "/settings/inventory-categories",
  "/settings/locations", "/settings/collector", "/settings/usage", "/settings/operations", "/settings/users",
  "/settings/permissions", "/settings/archived",
];

async function editAndSave(page: Page, path: string) {
  await page.goto(`/#${path}`);
  await page.getByRole("button", { name: "Edit screen text" }).click();
  const grids = page.locator(".page-grid-editing");
  await expect(grids.first(), path).toBeVisible();
  const keys: string[] = [];
  for (const grid of await grids.all()) {
    const key = (await grid.getAttribute("data-page-layout"))!;
    keys.push(key);
    // The guides: a frame with its track labels, and every boundary or empty
    // cell drawn.
    const frame = grid.locator("> .page-grid-frame");
    await expect(frame, key).toBeVisible();
    await expect(frame.locator("> .layout-grid-guides > .layout-track-label").first(), key).toBeAttached();
    // An edit to save: Hide on phone on the grid's first block.
    const toggle = frame.locator("> [data-block-id] > .layout-block-bar").first().getByRole("button", { name: /^Hide on phone: / });
    if (await toggle.count()) await toggle.click();
  }
  const save = page.getByRole("button", { name: "Save", exact: true });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByRole("button", { name: "Edit screen text" }), path).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /layout|grid|cell|row|column/i }), path).toHaveCount(0);
  } else await page.getByRole("group", { name: "Editing screen text" }).getByRole("button", { name: "Cancel", exact: true }).click();
  const saved = await browserDb((db) => db.select().from(uiLayout).where(inArray(uiLayout.pageKey, keys)));
  for (const row of saved) expect(row.layout.version, `${path} ${row.pageKey}`).toBe(2);
}

test("every main screen's page grids show guides and save as version 2 (AC5)", async ({ page, isMobile }) => {
  test.skip(isMobile, "One viewport is enough for this sweep.");
  test.setTimeout(10 * 60_000);
  for (const path of screens) await editAndSave(page, path);
});

test("record pages' page grids, nested event tab grids included, show guides and save as version 2 (AC5)", async ({ page, isMobile }) => {
  test.skip(isMobile, "One viewport is enough for this sweep.");
  test.setTimeout(5 * 60_000);
  const record = lead({ name: "Grid sweep lead" });
  await seedLeads([record]);
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  for (const path of [`/leads/${record.id}`, `/clients/${juniper().id}`, `/events/${fallGala().id}`]) await editAndSave(page, path);
});
