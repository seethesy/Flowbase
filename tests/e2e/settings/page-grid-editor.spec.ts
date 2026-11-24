import { eq } from "drizzle-orm";
import { test, expect, type Page } from "../auth-fixture";
import type { Locator } from "@playwright/test";
import { browserDb } from "../database";
import { uiLayout } from "../../../worker/db/schema";
import { seedUsers } from "../../../worker/db/seed";
import {
  apply,
  boxOf,
  cellBox,
  centre,
  dividers,
  edit,
  editBlock,
  editGrid,
  expectSameBox,
  measure,
  putLayout,
  save,
  toolbar,
  usableHeight,
  viewBlock,
  viewGrid,
  type Box,
} from "./page-grid-helpers";

// FLOW-321 against the real Worker and database: the live-edit page grid
// editor. Guides show only in live edit; tracks resize by divider and by exact
// percentage; rows and columns are added and removed; cells merge and
// unmerge; blocks go to an exact cell with the target highlighted; every edit
// is previewed; it all works from the keyboard; saved version 1 layouts move
// over.

const KEY = "inventory.bar";
const PATH = "/#/inventory/bar";
const status = (page: Page) => toolbar(page, KEY).getByRole("status");
const input = (page: Page, name: string) => page.getByRole("textbox", { name });
const shares = async (page: Page, axis: "Row" | "Column", count: number) => {
  const values: number[] = [];
  for (let n = 1; n <= count; n++) values.push(Number(await input(page, `${axis} ${n} ${axis === "Row" ? "height" : "width"} (%)`).inputValue()));
  return values;
};
// A previewed track or merge edit, applied.
async function ask(page: Page, button: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await apply(page, KEY);
}
async function drag(page: Page, from: Locator, to: Box, during?: () => Promise<void>) {
  // Mid-screen, clear of the toolbar fixed to the bottom.
  await from.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const start = await centre(page, await boxOf(from));
  const end = await centre(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  if (during) await during();
  await page.mouse.up();
}
const handle = (page: Page, id: string) => editBlock(page, KEY, id).locator(".layout-handle");
const emptyCell = (page: Page, x: number, y: number) => editGrid(page, KEY).locator(`[data-empty-cell="${x},${y}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("guides show every boundary, empty cell and merged area in live edit only (AC1)", async ({ page }) => {
  await page.goto(PATH);
  await edit(page);
  const grid = editGrid(page, KEY);
  // The code default: one column, Filters and List in a row each.
  await expect(dividers(grid)).toHaveCount(1);
  await expect(input(page, "Row 1 height (%)")).toHaveValue("11.11");
  await expect(input(page, "Row 2 height (%)")).toHaveValue("88.89");
  await ask(page, "Add column right of column 1");
  await ask(page, "Add row below row 2");
  await expect(dividers(grid)).toHaveCount(3);
  await expect(grid.locator("[data-empty-cell]")).toHaveCount(4);
  // Merge the bottom row: one merged area.
  await emptyCell(page, 0, 2).click();
  await emptyCell(page, 1, 2).click({ modifiers: ["Shift"] });
  await ask(page, "Merge");
  await expect(grid.locator(".layout-grid-cell.is-merged")).toHaveCount(1);
  // Guides are dotted, unlike any block's dashed or solid border.
  const guide = await emptyCell(page, 1, 0).evaluate((element) => getComputedStyle(element).outlineStyle);
  const frame = await editBlock(page, KEY, "list").evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(guide).toBe("dotted");
  expect(frame).not.toBe("dotted");
  await save(page);
  await expect(page.locator(".layout-divider, .layout-grid-cell, .layout-track-label")).toHaveCount(0);
  await expect(viewGrid(page, KEY)).toBeVisible();
});

test("a divider changes only its two tracks; an exact percentage rescales the rest and survives a reload (AC2)", async ({ page }) => {
  await page.goto(PATH);
  await edit(page);
  await ask(page, "Add row below row 2");
  const before = await shares(page, "Row", 3);
  const divider = page.getByRole("separator", { name: "Divider between row 2 and row 3" });
  const box = await boxOf(divider);
  await drag(page, divider, { x: box.x, y: box.y + 60, width: box.width, height: box.height }, async () => {
    // Both percentages show while dragging.
    await expect(divider).toHaveAttribute("aria-valuetext", /^Row 2 [\d.]+%, row 3 [\d.]+%$/);
  });
  const after = await shares(page, "Row", 3);
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBeGreaterThan(before[1]);
  expect(after[1] + after[2]).toBeCloseTo(before[1] + before[2], 2);

  await input(page, "Row 1 height (%)").fill("30");
  await input(page, "Row 1 height (%)").press("Enter");
  const exact = await shares(page, "Row", 3);
  expect(exact[0]).toBe(30);
  expect(exact[1] + exact[2]).toBeCloseTo(70, 2);
  // The others keep their ratio.
  expect(exact[1] / exact[2]).toBeCloseTo(after[1] / after[2], 1);
  await save(page);
  await page.reload();
  const m = await measure(viewGrid(page, KEY));
  expect(Math.abs(m.rows[0] - (m.box.height - 24) * 0.3)).toBeLessThanOrEqual(1);
  await edit(page);
  await expect(input(page, "Row 1 height (%)")).toHaveValue("30");
});

test("adds and removes rows and columns, merges and unmerges, previewing each and refusing with no change (AC3)", async ({ page }) => {
  await page.goto(PATH);
  await edit(page);
  const grid = editGrid(page, KEY);
  await ask(page, "Add column right of column 1");
  await ask(page, "Add row below row 2");
  // A preview draws its outcome but changes nothing until Apply.
  await page.getByRole("button", { name: "Add row below row 3", exact: true }).click();
  await expect(status(page)).toHaveText("Add row 4; the other rows shrink to make room.");
  await expect(grid.locator('[data-highlight="preview"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("separator", { name: /^Divider between row/ })).toHaveCount(2);
  await ask(page, "Add row below row 3");
  await expect(grid.getByRole("separator", { name: /^Divider between row/ })).toHaveCount(3);

  // Merge a 2 × 2 of empty cells.
  await emptyCell(page, 0, 2).click();
  await emptyCell(page, 1, 3).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(status(page)).toHaveText("Merge rows 3–4, columns 1–2 into one area.");
  await apply(page, KEY);
  await expect(grid.locator(".layout-grid-cell.is-merged")).toHaveCount(1);

  // Move List into it, then unmerge: List goes to the top-left cell.
  await drag(page, handle(page, "list"), await boxOf(emptyCell(page, 0, 2)));
  const listBox = await boxOf(editBlock(page, KEY, "list"));
  expectSameBox(listBox, cellBox(await measure(grid), { x: 0, y: 2, w: 2, h: 2 }), "list in the merged area");
  // Select the merged area: arrow down onto it from the cell above.
  await emptyCell(page, 0, 1).focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "Unmerge", exact: true }).click();
  await expect(status(page)).toHaveText("Unmerge rows 3–4, columns 1–2; List moves to row 3, column 1.");
  await apply(page, KEY);
  expectSameBox(await boxOf(editBlock(page, KEY, "list")), cellBox(await measure(grid), { x: 0, y: 2, w: 1, h: 1 }), "list unmerged");

  // Remove column 2 and row 4.
  await ask(page, "Remove column 2");
  await ask(page, "Remove row 4");
  await expect(dividers(grid)).toHaveCount(2);

  // Refusals change nothing: Filters sits only in row 1.
  await page.getByRole("button", { name: "Remove row 1", exact: true }).click();
  await expect(status(page)).toHaveText("Move Filters out of row 1 first.");
  await expect(toolbar(page, KEY).getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await toolbar(page, KEY).getByRole("button", { name: "OK", exact: true }).click();
  await expect(dividers(grid)).toHaveCount(2);
  await expect(editBlock(page, KEY, "filters")).toBeVisible();
});

test("a dragged block lands exactly on the one highlighted cell, swapping with what's there, and stays after reload (AC4)", async ({ page }) => {
  await page.goto(PATH);
  await edit(page);
  await ask(page, "Add column right of column 1");
  const grid = editGrid(page, KEY);
  const target = await boxOf(emptyCell(page, 1, 0));
  await drag(page, handle(page, "list"), target, async () => {
    const highlights = grid.locator('[data-highlight="target"]');
    await expect(highlights).toHaveCount(1);
    expectSameBox(await boxOf(highlights), target, "highlight");
  });
  expectSameBox(await boxOf(editBlock(page, KEY, "list")), target, "dropped list");
  // Onto an occupied cell: the highlight shows the swap, and the drop swaps.
  const filtersBox = await boxOf(editBlock(page, KEY, "filters"));
  await drag(page, handle(page, "list"), filtersBox, async () => {
    await expect(status(page)).toHaveText(/^Swap List with Filters/);
  });
  expectSameBox(await boxOf(editBlock(page, KEY, "list")), filtersBox, "swapped list");
  expectSameBox(await boxOf(editBlock(page, KEY, "filters")), target, "swapped filters");
  await save(page);
  await page.reload();
  const m = await measure(viewGrid(page, KEY));
  expectSameBox(await boxOf(viewBlock(page, KEY, "list")), cellBox(m, { x: 0, y: 0, w: 1, h: 1 }), "list after reload");
  expectSameBox(await boxOf(viewBlock(page, KEY, "filters")), cellBox(m, { x: 1, y: 0, w: 1, h: 1 }), "filters after reload");
});

test("Inventory Bar: a card added in the cell below List starts on the previewed boundary, in edit and after reload (AC5)", async ({ page }) => {
  await page.goto(PATH);
  await edit(page);
  await ask(page, "Add row below row 2");
  await toolbar(page, KEY).getByRole("button", { name: "Add card", exact: true }).click();
  const cell = emptyCell(page, 0, 2);
  await expect(cell).toHaveAttribute("aria-label", "Place here: Empty cell, row 3, column 1");
  const previewed = await boxOf(cell);
  await cell.click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Reorder soon");
  await builder.getByRole("checkbox", { name: /^Show / }).first().click();
  await builder.getByRole("button", { name: "Save card" }).click();
  const card = editGrid(page, KEY).locator("[data-block-id^=card-]");
  expect(Math.abs((await boxOf(card)).y - previewed.y)).toBeLessThanOrEqual(1);
  await save(page);
  await page.reload();
  const grid = viewGrid(page, KEY);
  const m = await measure(grid);
  const viewCard = grid.locator("> [data-block-id^=card-]");
  expect(Math.abs((await boxOf(viewCard)).y - previewed.y)).toBeLessThanOrEqual(1);
  expectSameBox(await boxOf(viewCard), cellBox(m, { x: 0, y: 2, w: 1, h: 1 }), "card");
  // Nothing outside the authored tracks: the grid ends at the usable height.
  expect(Math.abs(m.box.height - (await usableHeight(grid)))).toBeLessThanOrEqual(1);
});

test("keyboard only: resize, exact percentage, move, merge, unmerge and add a card into a chosen cell (AC6)", async ({ page }) => {
  await page.goto(PATH);
  const press = async (locator: Locator, key: string) => {
    await locator.focus();
    await page.keyboard.press(key);
  };
  await press(page.getByRole("button", { name: "Edit screen text" }), "Enter");
  // Resize: the divider's arrow keys, 1% a step.
  const divider = page.getByRole("separator", { name: "Divider between row 1 and row 2" });
  await expect(divider).toHaveAttribute("aria-valuenow", "11.11");
  await press(divider, "ArrowDown");
  await expect(divider).toHaveAttribute("aria-valuenow", "12.11");
  await expect(status(page)).toHaveText("Row 1 12.11%, row 2 87.89%.");
  // Exact percentage.
  await input(page, "Row 1 height (%)").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await expect(input(page, "Row 2 height (%)")).toHaveValue("80");
  // A column, by its button, previewed and applied.
  await press(page.getByRole("button", { name: "Add column right of column 1" }), "Enter");
  await press(toolbar(page, KEY).getByRole("button", { name: "Apply", exact: true }), "Enter");
  // Move List one cell right.
  const list = editBlock(page, KEY, "list");
  await press(list, "Enter");
  await expect(status(page)).toHaveText(/^Picked up List/);
  await page.keyboard.press("ArrowRight");
  await expect(status(page)).toHaveText("Move List to row 2, column 2.");
  await page.keyboard.press("Enter");
  await expect(list).toHaveAttribute("data-slot", "1,1");
  // Merge row 2: the empty cell and List's cell.
  await emptyCell(page, 0, 1).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await press(toolbar(page, KEY).getByRole("button", { name: "Merge", exact: true }), "Enter");
  await press(toolbar(page, KEY).getByRole("button", { name: "Apply", exact: true }), "Enter");
  await expect(list).toHaveAttribute("data-slot", "0,1");
  await expect(status(page)).toHaveText("Done: Merge row 2, columns 1–2; List fills it.");
  // Unmerge it: arrow from the cell above onto the merged area selects it.
  await emptyCell(page, 1, 0).focus();
  await page.keyboard.press("ArrowDown");
  await press(toolbar(page, KEY).getByRole("button", { name: "Unmerge", exact: true }), "Enter");
  await press(toolbar(page, KEY).getByRole("button", { name: "Apply", exact: true }), "Enter");
  await expect(editGrid(page, KEY).locator(".layout-grid-cell.is-merged")).toHaveCount(0);
  // Add a card into a chosen cell.
  await press(toolbar(page, KEY).getByRole("button", { name: "Add card", exact: true }), "Enter");
  await press(emptyCell(page, 1, 1), "Enter");
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Keyboard card");
  await press(builder.getByRole("checkbox", { name: /^Show / }).first(), "Space");
  await press(builder.getByRole("button", { name: "Save card" }), "Enter");
  await expect(editGrid(page, KEY).locator("[data-block-id^=card-]")).toHaveAttribute("data-slot", "1,1");
  await press(page.getByRole("button", { name: "Save", exact: true }), "Enter");
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  await expect(viewGrid(page, KEY).getByRole("heading", { name: "Keyboard card" })).toBeVisible();
});

test("a saved version 1 layout renders converted, restores, saves as version 2 and resets; a version 1 PUT is refused (AC7)", async ({ page }) => {
  const deleted = { at: "2026-11-24T10:00:00.000Z", by: seedUsers[0].id, name: "Working Staff" };
  await browserDb((db) =>
    db.insert(uiLayout).values({
      pageKey: "dashboard.home",
      updatedBy: seedUsers[0].id,
      layout: {
        version: 1,
        // Every dashboard card, so none is added as new; the middle band is
        // left free for the hidden and the deleted card.
        blocks: [
          { kind: "builtin", id: "my-leads", x: 0, y: 0, w: 6, h: 12 },
          { kind: "builtin", id: "my-tasks", x: 6, y: 0, w: 6, h: 12 },
          { kind: "builtin", id: "upcoming-events", x: 0, y: 12, w: 6, h: 12, hidden: true },
          { kind: "builtin", id: "working-staff", x: 6, y: 12, w: 6, h: 12, deleted },
          { kind: "text", id: "note-1", variant: "note", text: "Seeded note", x: 0, y: 24, w: 6, h: 12 },
          { kind: "builtin", id: "all-tasks", x: 6, y: 24, w: 6, h: 12 },
        ],
        tables: {},
        fieldBoxes: {},
      },
    }),
  );
  await page.goto("/#/");
  const grid = viewGrid(page, "dashboard.home");
  await expect(grid.getByText("Seeded note")).toBeVisible();
  // Two 50% columns and three equal rows; the middle row is empty.
  let m = await measure(grid);
  expect(m.cols).toHaveLength(2);
  expect(m.rows).toHaveLength(3);
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "my-tasks")), cellBox(m, { x: 1, y: 0, w: 1, h: 1 }), "my tasks");
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "note-1")), cellBox(m, { x: 0, y: 2, w: 1, h: 1 }), "note");
  await expect(viewBlock(page, "dashboard.home", "upcoming-events")).toHaveCount(0);

  await edit(page);
  await page.getByRole("button", { name: "Deleted items (1)", exact: true }).click();
  await page.getByRole("dialog", { name: "Deleted items" }).getByRole("button", { name: "Restore", exact: true }).click();
  // Close the Deleted items tray before opening Hidden items.
  await page.getByRole("button", { name: "Deleted items (0)", exact: true }).click();
  await page.getByRole("button", { name: "Hidden items (1)", exact: true }).click();
  await page.getByRole("dialog", { name: "Hidden items" }).getByRole("button", { name: "Show", exact: true }).click();
  await save(page);
  m = await measure(grid);
  // Each back in its last place.
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "working-staff")), cellBox(m, { x: 1, y: 1, w: 1, h: 1 }), "working staff");
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "upcoming-events")), cellBox(m, { x: 0, y: 1, w: 1, h: 1 }), "upcoming events");
  const stored = await browserDb(async (db) => (await db.select().from(uiLayout).where(eq(uiLayout.pageKey, "dashboard.home")))[0]?.layout);
  expect(stored?.version).toBe(2);

  // Reset: back to the native page.
  await edit(page);
  await page.getByRole("button", { name: "Reset page layout", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Reset page layout?" }).getByRole("button", { name: "Reset" }).click();
  await save(page);
  await expect(grid).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My Tasks" })).toBeVisible();

  const refused = await putLayout(page, "dashboard.home", { version: 1, blocks: [], tables: {}, fieldBoxes: {} });
  expect(refused.status).toBe(400);
});
