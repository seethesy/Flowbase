import { test, expect, mockBrowserAuth } from "../auth-fixture";
import { seedUsers } from "../../../worker/db/seed";
import { fallGala, juniper, lead } from "../fixtures";
import { seedLeads, seedRecords } from "../database";
import {
  boxOf,
  builtin,
  cellBox,
  contentWidth,
  edit,
  editGrid,
  expectRowHeights,
  expectSameBox,
  gridDoc,
  GAP,
  measure,
  putLayout,
  screenHeight,
  share,
  viewBlock,
  viewGrid,
} from "./page-grid-helpers";

// FLOW-320 against the real Worker and database: a page grid seeded through
// PUT /api/layout keeps its column shares of the content width at every
// viewport, each row is exactly its percentage of the screen height (FLOW-357),
// blocks fill their cells, empty cells and rows keep their space, phones keep
// the arrangement, absent blocks collapse their tracks, and view mode has no
// editor chrome. Record pages' grids span the full content width (FLOW-358).

const KEY = "inventory.bar";
const PATH = "/#/inventory/bar";
// Rows 25% and 70% of the screen, columns 25/75: Filters top left, List
// filling the right column, the bottom-left cell empty.
const rows2570 = gridDoc([2500, 7500], [2500, 7000], [builtin("filters", 0, 0), builtin("list", 1, 0, 1, 2)], [{ x: 1, y: 0, w: 1, h: 2 }]);

async function seed(page: import("@playwright/test").Page, doc: unknown, path = PATH, key = KEY) {
  await page.goto(path);
  expect((await putLayout(page, key, doc)).status).toBe(200);
  // The page read its layout before the PUT.
  await page.reload();
}

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1024, height: 700 },
])
  test(`each row is its % of the screen height and columns keep their shares at ${viewport.width}×${viewport.height} (FLOW-357 AC2, AC3)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, rows2570);
    const screen = await screenHeight(page);
    for (const pass of ["loaded", "reloaded"]) {
      if (pass === "reloaded") await page.reload();
      const grid = viewGrid(page, KEY);
      await expect(viewBlock(page, KEY, "list")).toBeVisible();
      const m = await measure(grid);
      // A 25% row is 25% of the screen height (±1px), the 70% row 70%: no
      // floor, minimum or stretching changes them.
      expectRowHeights(m.rows, [25, 70], screen, pass);
      expect(Math.abs(m.box.height - (screen * 0.95 + GAP)), pass).toBeLessThanOrEqual(1);
      expect(Math.abs(m.cols[0] - (m.box.width - 12) * 0.25), pass).toBeLessThanOrEqual(1);
      // List fills its merged column; a long list scrolls inside it (A2).
      expectSameBox(await boxOf(viewBlock(page, KEY, "list")), cellBox(m, { x: 1, y: 0, w: 1, h: 2 }), `${pass} list`);
      expectSameBox(await boxOf(viewBlock(page, KEY, "filters")), cellBox(m, { x: 0, y: 0, w: 1, h: 1 }), `${pass} filters`);
      // No guides, labels or controls in view mode (AC7).
      await expect(page.locator(".layout-divider, .layout-grid-cell, .layout-track-label, .layout-grid-highlight")).toHaveCount(0);
      await expect(page.getByRole("toolbar", { name: "Page layout" })).toHaveCount(0);
    }
  });

test("rows adding up to more than the screen make the page scroll; nothing is squeezed (FLOW-357 AC4)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, gridDoc([10000], [8000, 9000], [builtin("filters", 0, 0), builtin("list", 0, 1)]));
  const screen = await screenHeight(page);
  const m = await measure(viewGrid(page, KEY));
  expectRowHeights(m.rows, [80, 90], screen);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
});

test("a block fills its 2×2 merged area; an empty cell and an empty row keep their space (AC2)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Rows 20/20/30/30% of the screen: List fills rows 1–2 of both columns,
  // row 3 is empty, Filters sits bottom left beside an empty cell.
  await seed(
    page,
    gridDoc([5000, 5000], [2000, 2000, 3000, 3000], [builtin("list", 0, 0, 2, 2), builtin("filters", 0, 3)], [{ x: 0, y: 0, w: 2, h: 2 }]),
  );
  const m = await measure(viewGrid(page, KEY));
  expectRowHeights(m.rows, [20, 20, 30, 30], await screenHeight(page));
  expectSameBox(await boxOf(viewBlock(page, KEY, "list")), cellBox(m, { x: 0, y: 0, w: 2, h: 2 }), "list");
  expectSameBox(await boxOf(viewBlock(page, KEY, "filters")), cellBox(m, { x: 0, y: 3, w: 1, h: 1 }), "filters");
  expect(Math.abs(share(m.cols, 1) - 0.5)).toBeLessThan(0.005);
});

test("a phone keeps the arrangement, column shares and row percentages, with no stacking (AC4)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, rows2570);
  const m = await measure(viewGrid(page, KEY));
  expectRowHeights(m.rows, [25, 70], await screenHeight(page));
  expect(Math.abs(share(m.cols, 0) - 0.25)).toBeLessThan(0.01);
  const filters = await boxOf(viewBlock(page, KEY, "filters"));
  const list = await boxOf(viewBlock(page, KEY, "list"));
  // Side by side, as authored.
  expect(Math.abs(filters.y - list.y)).toBeLessThanOrEqual(1);
  expect(list.x).toBeGreaterThan(filters.x + filters.width);
  expectSameBox(list, cellBox(m, { x: 1, y: 0, w: 1, h: 2 }), "list");
});

test("a track whose only blocks are absent collapses; the other rows keep their heights (AC6)", async ({ page, browser }) => {
  await seedRecords({ clients: [juniper()] });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/clients/${juniper().id}`);
  // Row 1: the Overview facts. Row 2: Contacts (its own tab). Row 3: Upcoming
  // events, for Admins only. Rows 20/30/50% of the screen.
  const doc = gridDoc([10000], [2000, 3000, 5000], [
    builtin("client-facts", 0, 0),
    builtin("contacts", 0, 1),
    builtin("upcoming-events", 0, 2, 1, 1, { visibleTo: ["admin"] }),
  ]);
  expect((await putLayout(page, "clients.detail", doc)).status).toBe(200);
  await page.reload();
  const grid = viewGrid(page, "clients.detail");
  await expect(viewBlock(page, "clients.detail", "client-facts")).toBeVisible();
  const screen = await screenHeight(page);
  // Overview: Contacts isn't rendered, so its row collapses; 20% and 50% hold.
  let m = await measure(grid);
  expectRowHeights(m.rows, [20, 50], screen);
  // Contacts tab: only its row is left.
  await page.getByRole("tab", { name: "Contacts" }).click();
  await expect(viewBlock(page, "clients.detail", "contacts")).toBeVisible();
  m = await measure(grid);
  expectRowHeights(m.rows, [30], screen);

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

// FLOW-358: the record heading and tab bar stay above (A1); the grid below
// spans the content area's full width, on every tab and in edit mode too.
test("a client page's grid spans the full content width on every tab, in view and edit mode (FLOW-358 AC1, AC3)", async ({ page }) => {
  await seedRecords({ clients: [juniper()] });
  await page.setViewportSize({ width: 1440, height: 900 });
  const doc = gridDoc([10000], [3000, 3000, 3000], [builtin("client-facts", 0, 0), builtin("upcoming-events", 0, 1), builtin("contacts", 0, 2)]);
  await seed(page, doc, `/#/clients/${juniper().id}`, "clients.detail");
  const width = await contentWidth(page);
  for (const tab of ["Overview", "Contacts"]) {
    await page.getByRole("tab", { name: tab }).click();
    const block = viewBlock(page, "clients.detail", tab === "Overview" ? "client-facts" : "contacts");
    await expect(block).toBeVisible();
    expect(Math.abs((await boxOf(viewGrid(page, "clients.detail"))).width - width), tab).toBeLessThanOrEqual(1);
    expect(Math.abs((await boxOf(block)).width - width), `${tab} block`).toBeLessThanOrEqual(1);
  }
  await page.getByRole("tab", { name: "Overview" }).click();
  const view = await measure(viewGrid(page, "clients.detail"));
  await edit(page);
  const frame = await measure(editGrid(page, "clients.detail"));
  expect(Math.abs(frame.box.width - view.box.width)).toBeLessThanOrEqual(1);
  // Edit mode draws every authored row at the view's heights (FLOW-357).
  expectRowHeights(frame.rows, [30, 30, 30], await screenHeight(page), "edit");
});

test("lead and event pages' grids span the full content width (FLOW-358 AC2)", async ({ page }) => {
  const picked = lead();
  await seedLeads([picked]);
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [path, key, id] of [
    [`/#/leads/${picked.id}`, "leads.detail", "lead-facts"],
    [`/#/events/${fallGala().id}`, "events.detail", "details"],
  ] as const) {
    await seed(page, gridDoc([10000], [4000], [builtin(id, 0, 0)]), path, key);
    await expect(viewBlock(page, key, id)).toBeVisible();
    expect(Math.abs((await boxOf(viewGrid(page, key))).width - (await contentWidth(page))), key).toBeLessThanOrEqual(1);
  }
});

// FLOW-357 A2: a card's boxes sit at their saved top and height in pixels,
// with no snapping to rows, in view mode and in the field card editor alike.
test("field boxes show at their exact pixel top and height, in view and edit mode (FLOW-357 A2)", async ({ page }) => {
  const picked = lead();
  await seedLeads([picked]);
  await page.setViewportSize({ width: 1440, height: 900 });
  const doc = {
    ...gridDoc([10000], [8000], [builtin("lead-facts", 0, 0)]),
    fieldBoxes: { "lead-facts": { boxes: [
      { id: "field-1", kind: "field", field: "name", x: 0, y: 0, w: 6, h: 50 },
      { id: "field-2", kind: "field", field: "email", x: 6, y: 0, w: 6, h: 97 },
      { id: "note-1", kind: "note", text: "Exact", x: 0, y: 113, w: 12, h: 41 },
    ] } },
  };
  await seed(page, doc, `/#/leads/${picked.id}`, "leads.detail");
  const box = (id: string) => page.locator(`[data-field-card="lead-facts"] [data-box-id="${id}"]`);
  await expect(box("note-1")).toBeVisible();
  const [name, email, note] = [await boxOf(box("field-1")), await boxOf(box("field-2")), await boxOf(box("note-1"))];
  expect(Math.abs(name.height - 50)).toBeLessThanOrEqual(1);
  expect(Math.abs(email.height - 97)).toBeLessThanOrEqual(1);
  expect(Math.abs(note.height - 41)).toBeLessThanOrEqual(1);
  expect(Math.abs(note.y - name.y - 113)).toBeLessThanOrEqual(1);
  // Edit mode: the same heights; Shift and the down arrow adds exactly 8px.
  await edit(page);
  const item = page.locator(`[data-field-card="lead-facts"] .layout-grid-item[data-layout-id="field-2"]`);
  expect(Math.abs((await boxOf(item)).height - 97)).toBeLessThanOrEqual(1);
  await item.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => Math.round((await boxOf(item)).height)).toBe(105);
});
