import { test, expect, mockBrowserAuth } from "../auth-fixture";
import { seedUsers } from "../../../worker/db/seed";
import { juniper } from "../fixtures";
import { seedRecords } from "../database";
import {
  boxOf,
  builtin,
  cellBox,
  expectSameBox,
  gridDoc,
  measure,
  putLayout,
  share,
  usableHeight,
  viewBlock,
  viewGrid,
} from "./page-grid-helpers";

// FLOW-320 against the real Worker and database: a page grid seeded through
// PUT /api/layout keeps its row and column shares of the usable area at every
// viewport, blocks fill their cells, empty cells and rows keep their space,
// phones keep the arrangement, absent blocks collapse their tracks, and view
// mode has no editor chrome.

const KEY = "inventory.bar";
const PATH = "/#/inventory/bar";
// Rows 30/70, columns 25/75: Filters top left, List filling the right column,
// the bottom-left cell empty.
const thirtySeventy = gridDoc([2500, 7500], [3000, 7000], [builtin("filters", 0, 0), builtin("list", 1, 0, 1, 2)], [{ x: 1, y: 0, w: 1, h: 2 }]);

async function seed(page: import("@playwright/test").Page, doc: unknown) {
  await page.goto(PATH);
  expect((await putLayout(page, KEY, doc)).status).toBe(200);
  // The page read its layout before the PUT.
  await page.reload();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
])
  test(`rows and columns keep their shares of the usable area at ${viewport.width}×${viewport.height} (AC1, AC3, AC7)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, thirtySeventy);
    for (const pass of ["loaded", "reloaded"]) {
      if (pass === "reloaded") await page.reload();
      const grid = viewGrid(page, KEY);
      await expect(viewBlock(page, KEY, "list")).toBeVisible();
      const m = await measure(grid);
      // The grid fills the usable height and ends at its bottom (AC3).
      expect(Math.abs(m.box.height - (await usableHeight(grid))), pass).toBeLessThanOrEqual(1);
      expect(Math.abs(m.rows[0] - (m.box.height - 12) * 0.3), pass).toBeLessThanOrEqual(1);
      expect(Math.abs(m.cols[0] - (m.box.width - 12) * 0.25), pass).toBeLessThanOrEqual(1);
      // List fills its merged column; a long list scrolls inside it (A2).
      expectSameBox(await boxOf(viewBlock(page, KEY, "list")), cellBox(m, { x: 1, y: 0, w: 1, h: 2 }), `${pass} list`);
      expectSameBox(await boxOf(viewBlock(page, KEY, "filters")), cellBox(m, { x: 0, y: 0, w: 1, h: 1 }), `${pass} filters`);
      // No guides, labels or controls in view mode (AC7).
      await expect(page.locator(".layout-divider, .layout-grid-cell, .layout-track-label, .layout-grid-highlight")).toHaveCount(0);
      await expect(page.getByRole("toolbar", { name: "Page layout" })).toHaveCount(0);
    }
  });

test("a block fills its 2×2 merged area; an empty cell and an empty row keep their space (AC2)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Rows 20/20/30/30: List fills rows 1–2 of both columns, row 3 is empty,
  // Filters sits bottom left beside an empty cell.
  await seed(
    page,
    gridDoc([5000, 5000], [2000, 2000, 3000, 3000], [builtin("list", 0, 0, 2, 2), builtin("filters", 0, 3)], [{ x: 0, y: 0, w: 2, h: 2 }]),
  );
  const m = await measure(viewGrid(page, KEY));
  expect(m.rows).toHaveLength(4);
  expectSameBox(await boxOf(viewBlock(page, KEY, "list")), cellBox(m, { x: 0, y: 0, w: 2, h: 2 }), "list");
  expectSameBox(await boxOf(viewBlock(page, KEY, "filters")), cellBox(m, { x: 0, y: 3, w: 1, h: 1 }), "filters");
  expect(Math.abs(share(m.rows, 2) - 0.3)).toBeLessThan(0.005);
  expect(Math.abs(share(m.cols, 1) - 0.5)).toBeLessThan(0.005);
});

test("a phone keeps the arrangement and shares, with no stacking (AC4)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, thirtySeventy);
  const m = await measure(viewGrid(page, KEY));
  expect(Math.abs(share(m.rows, 0) - 0.3)).toBeLessThan(0.01);
  expect(Math.abs(share(m.cols, 0) - 0.25)).toBeLessThan(0.01);
  const filters = await boxOf(viewBlock(page, KEY, "filters"));
  const list = await boxOf(viewBlock(page, KEY, "list"));
  // Side by side, as authored.
  expect(Math.abs(filters.y - list.y)).toBeLessThanOrEqual(1);
  expect(list.x).toBeGreaterThan(filters.x + filters.width);
  expectSameBox(list, cellBox(m, { x: 1, y: 0, w: 1, h: 2 }), "list");
});

test("a track whose only blocks are absent collapses; the others keep their ratios (AC6)", async ({ page, browser }) => {
  await seedRecords({ clients: [juniper()] });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/clients/${juniper().id}`);
  // Row 1: the Overview facts. Row 2: Contacts (its own tab). Row 3: Upcoming
  // events, for Admins only. Rows 20/30/50.
  const doc = gridDoc([10000], [2000, 3000, 5000], [
    builtin("client-facts", 0, 0),
    builtin("contacts", 0, 1),
    builtin("upcoming-events", 0, 2, 1, 1, { visibleTo: ["admin"] }),
  ]);
  expect((await putLayout(page, "clients.detail", doc)).status).toBe(200);
  await page.reload();
  const grid = viewGrid(page, "clients.detail");
  await expect(viewBlock(page, "clients.detail", "client-facts")).toBeVisible();
  // Overview: Contacts isn't rendered, so its row collapses; 20:50 holds.
  let m = await measure(grid);
  expect(m.rows).toHaveLength(2);
  expect(Math.abs(share(m.rows, 0) - 2 / 7)).toBeLessThan(0.005);
  // Contacts tab: only its row is left.
  await page.getByRole("tab", { name: "Contacts" }).click();
  await expect(viewBlock(page, "clients.detail", "contacts")).toBeVisible();
  m = await measure(grid);
  expect(m.rows).toHaveLength(1);

  // A role the card is hidden from: its row collapses too.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: seedUsers.find((user) => user.role === "sales_manager")!.id });
  await other.goto(`/#/clients/${juniper().id}`);
  await expect(viewBlock(other, "clients.detail", "client-facts")).toBeVisible();
  await expect(viewBlock(other, "clients.detail", "upcoming-events")).toHaveCount(0);
  m = await measure(viewGrid(other, "clients.detail"));
  expect(m.rows).toHaveLength(1);
  await context.close();
});
