import { eq } from "drizzle-orm";
import { test, expect, type Page } from "../auth-fixture";
import { browserDb, seedRecords } from "../database";
import { juniper } from "../fixtures";
import { uiLayout } from "../../../worker/db/schema";
import { seedUsers } from "../../../worker/db/seed";
import {
  apply,
  boxOf,
  cellBox,
  edit,
  editBlock,
  editGrid,
  expectSameBox,
  measure,
  save,
  share,
  toolbar,
  usableHeight,
  viewBlock,
  viewGrid,
} from "./page-grid-helpers";

// FLOW-322: end-to-end proof, on the real Worker and database, that a grid
// authored in the editor keeps its proportions at two viewports, survives a
// reload, looks the same in edit and view, and that layouts saved before the
// page grid carry over. Synthetic fixtures only (ADR-27).

const KEY = "inventory.bar";
const PATH = "/#/inventory/bar";
const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
];
const ask = async (page: Page, button: string) => {
  await page.getByRole("button", { name: button, exact: true }).click();
  await apply(page, KEY);
};
const exact = async (page: Page, name: string, value: string) => {
  const input = page.getByRole("textbox", { name });
  await input.fill(value);
  await input.press("Enter");
  await expect(input).toHaveValue(value);
};
const emptyCell = (page: Page, x: number, y: number) => editGrid(page, KEY).locator(`[data-empty-cell="${x},${y}"]`);

// Rows: 1 Filters | empty cell; 2–3 List in a 2 × 2 merged area; 4 empty row.
async function author(page: Page) {
  await page.goto(PATH);
  await edit(page);
  await ask(page, "Add column right of column 1");
  await ask(page, "Add row below row 2");
  await ask(page, "Add row below row 3");
  // Select from List's cell to the cell diagonally below it, by keyboard.
  await emptyCell(page, 0, 2).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await toolbar(page, KEY).getByRole("button", { name: "Merge", exact: true }).click();
  await expect(toolbar(page, KEY).getByRole("status")).toHaveText("Merge rows 2–3, columns 1–2; List fills it.");
  await apply(page, KEY);
  await exact(page, "Row 1 height (%)", "30");
  await exact(page, "Column 1 width (%)", "40");
  await save(page);
}

// Every block's and empty cell's box, from the view grid's tracks.
const layoutCells = { filters: { x: 0, y: 0, w: 1, h: 1 }, list: { x: 0, y: 1, w: 2, h: 2 } };
const emptyCells = { "1,0": { x: 1, y: 0, w: 1, h: 1 }, "0,3": { x: 0, y: 3, w: 1, h: 1 }, "1,3": { x: 1, y: 3, w: 1, h: 1 } };

test("an authored grid keeps its shares, merged area, empty cell and empty row at two viewports, in view and edit alike (AC1, AC2)", async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await author(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    const label = `${viewport.width}×${viewport.height}`;
    const grid = viewGrid(page, KEY);
    await expect(viewBlock(page, KEY, "list")).toBeVisible();
    const view = await measure(grid);
    expect(view.rows, label).toHaveLength(4);
    expect(Math.abs(view.box.height - (await usableHeight(grid))), label).toBeLessThanOrEqual(1);
    expect(Math.abs(view.rows[0] - (view.box.height - 36) * 0.3), `${label} row 1`).toBeLessThanOrEqual(1);
    expect(Math.abs(view.cols[0] - (view.box.width - 12) * 0.4), `${label} column 1`).toBeLessThanOrEqual(1);
    const viewBoxes: Record<string, Awaited<ReturnType<typeof boxOf>>> = {};
    for (const [id, cell] of Object.entries(layoutCells)) {
      viewBoxes[id] = await boxOf(viewBlock(page, KEY, id));
      expectSameBox(viewBoxes[id], cellBox(view, cell), `${label} view ${id}`);
    }
    // The empty row keeps its share.
    expect(share(view.rows, 3), label).toBeGreaterThan(0.05);

    await edit(page);
    const frame = await measure(editGrid(page, KEY));
    expectSameBox(frame.box, view.box, `${label} frame`);
    for (const id of Object.keys(layoutCells)) expectSameBox(await boxOf(editBlock(page, KEY, id)), viewBoxes[id], `${label} edit ${id}`);
    for (const [key, cell] of Object.entries(emptyCells)) {
      const [x, y] = key.split(",").map(Number);
      expectSameBox(await boxOf(emptyCell(page, x, y)), cellBox(view, cell), `${label} empty ${key}`);
    }
    await page.getByRole("group", { name: "Editing screen text" }).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  }
});

test("Inventory Bar: a card added below List starts on the previewed boundary at both viewports after save and reload (AC3)", async ({ page }) => {
  await page.setViewportSize(viewports[0]);
  await page.goto(PATH);
  await edit(page);
  await ask(page, "Add row below row 2");
  await toolbar(page, KEY).getByRole("button", { name: "Add card", exact: true }).click();
  const previewed = await boxOf(emptyCell(page, 0, 2));
  await emptyCell(page, 0, 2).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Below the list");
  await builder.getByRole("checkbox", { name: /^Show / }).first().click();
  await builder.getByRole("button", { name: "Save card" }).click();
  expect(Math.abs((await boxOf(editGrid(page, KEY).locator("> [data-block-id^=card-]"))).y - previewed.y)).toBeLessThanOrEqual(1);
  await save(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    const grid = viewGrid(page, KEY);
    const card = grid.locator("> [data-block-id^=card-]");
    await expect(card).toBeVisible();
    const m = await measure(grid);
    const label = `${viewport.width}×${viewport.height}`;
    // Its top is the boundary below List.
    expectSameBox(await boxOf(card), cellBox(m, { x: 0, y: 2, w: 1, h: 1 }), `${label} card`);
    const list = await boxOf(viewBlock(page, KEY, "list"));
    expect(Math.abs((await boxOf(card)).y - (list.y + list.height + 12)), label).toBeLessThanOrEqual(1);
    // Nothing outside the authored tracks.
    expect(Math.abs(m.box.height - (await usableHeight(grid))), label).toBeLessThanOrEqual(1);
  }
});

test("layouts saved before the page grid convert, keep hidden and deleted items, save as version 2 and reset (AC4)", async ({ page }) => {
  await seedRecords({ clients: [juniper()] });
  const deleted = { at: "2026-11-24T10:00:00.000Z", by: seedUsers[0].id, name: "Working Staff" };
  await browserDb((db) =>
    db.insert(uiLayout).values([
      {
        pageKey: "inventory.bar",
        updatedBy: seedUsers[0].id,
        layout: { version: 1, blocks: [{ kind: "builtin", id: "filters", x: 0, y: 0, w: 12, h: 3 }, { kind: "builtin", id: "list", x: 0, y: 3, w: 12, h: 24 }], tables: {}, fieldBoxes: {} },
      },
      {
        pageKey: "dashboard.home",
        updatedBy: seedUsers[0].id,
        layout: {
          version: 1,
          blocks: [
            { kind: "builtin", id: "my-leads", x: 0, y: 0, w: 6, h: 12 },
            { kind: "builtin", id: "my-tasks", x: 6, y: 0, w: 6, h: 12, hidden: true },
            { kind: "builtin", id: "upcoming-events", x: 0, y: 12, w: 6, h: 12 },
            { kind: "builtin", id: "working-staff", x: 6, y: 12, w: 6, h: 12, deleted },
            { kind: "builtin", id: "all-tasks", x: 0, y: 24, w: 6, h: 12 },
            { kind: "text", id: "note-1", variant: "note", text: "Migrated note", x: 6, y: 24, w: 6, h: 4 },
            {
              kind: "card",
              id: "card-1",
              x: 6,
              y: 28,
              w: 6,
              h: 8,
              card: { title: "Migrated card", source: { type: "list", list: "events" }, filters: [], limit: 5, display: { type: "table", columns: [{ key: "title" }] } },
            },
          ],
          tables: {},
          fieldBoxes: {},
        },
      },
      {
        pageKey: "clients.detail",
        updatedBy: seedUsers[0].id,
        layout: {
          version: 1,
          blocks: [
            { kind: "builtin", id: "client-facts", x: 0, y: 0, w: 6, h: 12 },
            { kind: "builtin", id: "upcoming-events", x: 6, y: 0, w: 6, h: 12 },
            { kind: "builtin", id: "contacts", x: 0, y: 12, w: 12, h: 12 },
            { kind: "builtin", id: "files", x: 0, y: 24, w: 12, h: 12 },
          ],
          tables: {},
          fieldBoxes: {},
        },
      },
    ]),
  );
  const stored = async (pageKey: string) =>
    browserDb(async (db) => (await db.select().from(uiLayout).where(eq(uiLayout.pageKey, pageKey)))[0]?.layout);
  await page.setViewportSize(viewports[0]);

  // Inventory Bar: the code-default shape, rows 11.11/88.89.
  await page.goto(PATH);
  let m = await measure(viewGrid(page, KEY));
  expect(m.rows).toHaveLength(2);
  expect(Math.abs(share(m.rows, 0) - 0.1111)).toBeLessThan(0.001);
  await edit(page);
  await expect(page.getByRole("textbox", { name: "Row 1 height (%)" })).toHaveValue("11.11");
  await page.getByRole("button", { name: "Hide on phone: Filters" }).click();
  await save(page);
  expect((await stored(KEY))?.version).toBe(2);

  // Dashboard: same arrangement, hidden and deleted items in their trays and
  // back in their places on restore; saves as version 2; Reset goes native.
  await page.goto("/#/");
  const dash = viewGrid(page, "dashboard.home");
  await expect(dash.getByText("Migrated note")).toBeVisible();
  await expect(dash.getByRole("heading", { name: "Migrated card" })).toBeVisible();
  m = await measure(dash);
  expect(m.cols).toHaveLength(2);
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "upcoming-events")), cellBox(m, { x: 0, y: 1, w: 1, h: 1 }), "upcoming events");
  await edit(page);
  await expect(page.getByRole("button", { name: "Hidden items (1)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Deleted items (1)", exact: true }).click();
  await page.getByRole("dialog", { name: "Deleted items" }).getByRole("button", { name: "Restore", exact: true }).click();
  // Close the Deleted items tray before opening Hidden items.
  await page.getByRole("button", { name: "Deleted items (0)", exact: true }).click();
  await page.getByRole("button", { name: "Hidden items (1)", exact: true }).click();
  await page.getByRole("dialog", { name: "Hidden items" }).getByRole("button", { name: "Show", exact: true }).click();
  await save(page);
  m = await measure(dash);
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "my-tasks")), cellBox(m, { x: 1, y: 0, w: 1, h: 1 }), "my tasks restored");
  expectSameBox(await boxOf(viewBlock(page, "dashboard.home", "working-staff")), cellBox(m, { x: 1, y: 1, w: 1, h: 1 }), "working staff restored");
  expect((await stored("dashboard.home"))?.version).toBe(2);
  await edit(page);
  await page.getByRole("button", { name: "Reset page layout", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Reset page layout?" }).getByRole("button", { name: "Reset" }).click();
  await save(page);
  await expect(dash).toHaveCount(0);
  expect(await stored("dashboard.home")).toBeUndefined();

  // A client: blocks on several tabs keep their places; each tab collapses
  // the others' rows.
  await page.goto(`/#/clients/${juniper().id}`);
  const client = viewGrid(page, "clients.detail");
  await expect(viewBlock(page, "clients.detail", "client-facts")).toBeVisible();
  m = await measure(client);
  expect(m.cols).toHaveLength(2);
  expect(m.rows).toHaveLength(1);
  expectSameBox(await boxOf(viewBlock(page, "clients.detail", "upcoming-events")), cellBox(m, { x: 1, y: 0, w: 1, h: 1 }), "client upcoming events");
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(viewBlock(page, "clients.detail", "files")).toBeVisible();
  await edit(page);
  await page.getByRole("button", { name: "Hide on phone: Files" }).click();
  await save(page);
  const client2 = await stored("clients.detail");
  expect(client2?.version).toBe(2);
  expect(client2?.blocks.map((block) => block.id)).toEqual(expect.arrayContaining(["client-facts", "contacts", "files", "upcoming-events"]));
});
