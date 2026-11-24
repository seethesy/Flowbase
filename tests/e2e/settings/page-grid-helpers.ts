import { expect, type Locator, type Page } from "@playwright/test";
import type { LayoutBlock, LayoutDoc } from "../../../shared/layout";

// Page grid (FLOW-319 to 322) helpers for the specs in this folder: seeding a
// layout through the real API, entering and saving live edit, and measuring a
// grid's tracks and boxes.

export const GAP = 12;

// A version 2 document: shares in basis points, blocks in track coordinates.
export const gridDoc = (
  cols: number[],
  rows: number[],
  blocks: LayoutBlock[],
  regions: LayoutDoc["grid"]["regions"] = [],
): LayoutDoc => ({ version: 2, grid: { cols, rows, regions }, blocks, tables: {}, fieldBoxes: {} });
export const builtin = (id: string, x: number, y: number, w = 1, h = 1, extra: Partial<LayoutBlock> = {}) =>
  ({ kind: "builtin", id, x, y, w, h, ...extra }) as LayoutBlock;

// PUT /api/layout/:pageKey as the signed-in browser user.
export async function putLayout(page: Page, pageKey: string, layout: unknown) {
  return page.evaluate(
    async ({ pageKey, layout }) => {
      const token = JSON.parse(localStorage.getItem("sb-test-auth-token") ?? "{}").access_token as string;
      const response = await fetch(`/api/layout/${pageKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(layout),
      });
      return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
    },
    { pageKey, layout },
  );
}

export const edit = (page: Page) => page.getByRole("button", { name: "Edit screen text" }).click();
export async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
}
export const toolbar = (page: Page, pageKey: string) => page.locator(`[data-page-layout="${pageKey}"] > [role="toolbar"]`);
// Applies the edit the toolbar previews.
export async function apply(page: Page, pageKey: string) {
  await toolbar(page, pageKey).getByRole("button", { name: "Apply", exact: true }).click();
}

// The grid element: the frame in edit mode, the grid itself in view mode.
export const viewGrid = (page: Page, pageKey: string) => page.locator(`.page-grid[data-page-layout="${pageKey}"]`);
export const editGrid = (page: Page, pageKey: string) => page.locator(`[data-page-layout="${pageKey}"] > .page-grid-frame`);
export const viewBlock = (page: Page, pageKey: string, id: string) => page.locator(`.page-grid[data-page-layout="${pageKey}"] > [data-block-id="${id}"]`);
export const editBlock = (page: Page, pageKey: string, id: string) => editGrid(page, pageKey).locator(`> [data-block-id="${id}"]`);
// A block in edit mode by its name (its frame's label starts "<name>, row").
export const namedBlock = (page: Page, pageKey: string, name: string) =>
  editGrid(page, pageKey)
    .locator("> [data-block-id]")
    .and(page.getByLabel(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, rows? \\d`)));
// Adds a column right of column 1 (every block, in column 1, is then half
// width) and moves the block down a row with the keyboard (FLOW-321).
export async function halfWidthAndDown(page: Page, pageKey: string, name: string) {
  const root = page.locator(`[data-page-layout="${pageKey}"]`);
  await editGrid(page, pageKey).locator("> .layout-grid-guides").getByRole("button", { name: "Add column right of column 1", exact: true }).click();
  await root.locator("> [role=toolbar]").getByRole("button", { name: "Apply", exact: true }).click();
  const item = namedBlock(page, pageKey, name);
  await item.press("Enter");
  await item.press("ArrowDown");
  await item.press("Enter");
}

// Boxes are in page coordinates, so a grid taller than the viewport (rows of
// at least 56px) measures the same however far the page has scrolled.
export type Box = { x: number; y: number; width: number; height: number };
// The grid's box and its resolved track sizes in px.
export async function measure(grid: Locator) {
  await grid.scrollIntoViewIfNeeded();
  return grid.evaluate((element) => {
    const style = getComputedStyle(element);
    const px = (value: string) => value.split(" ").filter(Boolean).map((part) => parseFloat(part));
    const box = element.getBoundingClientRect();
    return {
      box: { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height },
      cols: px(style.gridTemplateColumns),
      rows: px(style.gridTemplateRows),
    };
  });
}
// A rectangle of tracks as a box, from a grid's measure.
export function cellBox(grid: Awaited<ReturnType<typeof measure>>, r: { x: number; y: number; w: number; h: number }): Box {
  const offset = (sizes: number[], index: number) => sizes.slice(0, index).reduce((a, b) => a + b, 0) + GAP * index;
  const size = (sizes: number[], from: number, count: number) => sizes.slice(from, from + count).reduce((a, b) => a + b, 0) + GAP * (count - 1);
  return {
    x: grid.box.x + offset(grid.cols, r.x),
    y: grid.box.y + offset(grid.rows, r.y),
    width: size(grid.cols, r.x, r.w),
    height: size(grid.rows, r.y, r.h),
  };
}
export async function boxOf(locator: Locator): Promise<Box> {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height };
  });
}
// A page-coordinate box's centre in the viewport, for the mouse.
export async function centre(page: Page, box: Box) {
  const [x, y] = await page.evaluate(() => [window.scrollX, window.scrollY]);
  return { x: box.x + box.width / 2 - x, y: box.y + box.height / 2 - y };
}
// The grid's own boundaries (a table's column handles are separators too).
export const dividers = (grid: Locator) => grid.locator("> .layout-grid-guides > .layout-divider");
// Two boxes within 1px on every edge.
export function expectSameBox(actual: Box, expected: Box, label: string) {
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}: ${actual[key]} vs ${expected[key]}`).toBeLessThanOrEqual(1);
}
// The usable height (FLOW-320 A1): the viewport below the grid's top, less the
// main area's bottom padding, never under 480px nor so short that a row goes
// under 56px.
export async function usableHeight(grid: Locator) {
  return grid.evaluate((element) => {
    const main = element.closest("main");
    const padding = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    const top = element.getBoundingClientRect().top + window.scrollY;
    const rows = getComputedStyle(element).gridTemplateRows.split(" ").filter(Boolean).map((part) => parseFloat(part));
    const total = rows.reduce((a, b) => a + b, 0);
    const forRows = rows.length ? Math.ceil((56 * total) / Math.min(...rows) + 12 * (rows.length - 1)) : 0;
    return Math.max(480, Math.floor(window.innerHeight - top - padding), forRows);
  });
}
// A track's share of the usable size (gaps excluded).
export const share = (sizes: number[], index: number) => sizes[index] / sizes.reduce((a, b) => a + b, 0);
