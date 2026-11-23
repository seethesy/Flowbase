import { eq } from "drizzle-orm";
import { test, expect, mockBrowserAuth } from "./auth-fixture";
import type { Page } from "@playwright/test";
import { seedUsers } from "../../worker/db/seed";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

// FLOW-278 against the real Worker and database: the newly wrapped screens move
// and resize (width presets and the arrow keys), the new style options save for
// everyone, and phones stack blocks and drop the ones hidden on phone.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;
const manager = seedUsers.find((user) => user.role === "sales_manager") ?? salesperson;

// Six columns wide, as the inline style the browser serializes (grid-area or
// grid-column).
const halfWidth = /grid-column: \d+ \/ span 6|grid-area: [^;]*\/ span 6;/;

const block = (page: Page, pageKey: string, id: string) =>
  page.locator(`[data-page-layout="${pageKey}"] > [data-block-id="${id}"]`);

async function halfWidthAndDown(page: Page, name: string) {
  await page.getByRole("button", { name: `Half width: ${name}` }).click();
  // The arrow keys move a focused block one row (AC2).
  const item = page.getByLabel(`${name}: arrow keys move, Shift and arrow keys resize`);
  await item.focus();
  await item.press("ArrowDown");
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
}

const screens = [
  { title: "Events overview", path: "/#/events/overview", pageKey: "calendar.page", id: "calendar", name: "Calendar" },
  { title: "Tasks", path: "/#/tasks", pageKey: "tasks.dashboard", id: "my-tasks", name: "My tasks" },
  { title: "Recipes", path: "/#/recipes", pageKey: "recipes.list", id: "list", name: "List" },
  // /proposals is the file library (FLOW-276); the Sales tracker moved to /sales.
  { title: "Proposals list", path: "/#/proposals", pageKey: "proposals.library", id: "files", name: "Proposal files" },
  { title: "Sales tracker", path: "/#/sales", pageKey: "sales.tracker", id: "table", name: "Sales table" },
];

for (const screen of screens)
  test(`moves and resizes a card on ${screen.title} for everyone (FLOW-278 AC1, AC2)`, async ({ page, browser, isMobile }) => {
    test.skip(isMobile, "Phones stack blocks full width (AC5 has its own 390px test).");
    await page.goto(screen.path);
    await page.getByRole("button", { name: "Edit screen text" }).click();
    await halfWidthAndDown(page, screen.name);
    await save(page);
    await expect(block(page, screen.pageKey, screen.id)).toHaveAttribute("style", halfWidth);
    const placed = await block(page, screen.pageKey, screen.id).getAttribute("style");

    const context = await browser.newContext();
    const other = await context.newPage();
    await mockBrowserAuth(other, { userId: manager.id });
    await other.goto(screen.path);
    const seen = block(other, screen.pageKey, screen.id);
    await expect(seen).toHaveAttribute("style", halfWidth);
    expect(await seen.getAttribute("style")).toBe(placed);
    await context.close();
  });

test("moves a card on an event tab without moving the tab (FLOW-278 AC1)", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones stack blocks full width (AC5 has its own 390px test).");
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb((db) => db.update(s.events).set({ status: "preparation" }).where(eq(s.events.id, fallGala().id)));
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(page.getByRole("heading", { name: "Closeout and returns" })).toBeVisible();
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await halfWidthAndDown(page, "Final notes");
  await save(page);
  await expect(block(page, "events.closeout", "finish")).toHaveAttribute("style", halfWidth);
  await page.reload();
  await expect(block(page, "events.closeout", "finish")).toHaveAttribute("style", halfWidth);
  await expect(page.getByLabel("Final notes")).toBeVisible();
});

test("saves the new style options and Default look restores the card (FLOW-278 AC3)", async ({ page, browser }) => {
  await page.goto("/#/recipes");
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Style List" }).click();
  const style = page.getByRole("dialog", { name: "Style" });
  await style.getByRole("button", { name: "Highlight" }).click();
  await style.getByRole("group", { name: "Corners" }).getByRole("button", { name: "Square" }).click();
  await style.getByRole("group", { name: "Padding" }).getByRole("button", { name: "Compact" }).click();
  await style.getByRole("group", { name: "Title size" }).getByRole("button", { name: "Large" }).click();
  await style.getByRole("button", { name: "No border" }).click();
  // Low contrast is refused before saving.
  await style.getByRole("textbox", { name: "Text color hex" }).fill("#eef3ee");
  await expect(style.getByRole("alert")).toContainText("hard to read");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await style.getByRole("textbox", { name: "Text color hex" }).fill("#1f2a24");
  await expect(style.getByRole("alert")).toHaveCount(0);
  await style.getByRole("button", { name: "Done" }).click();
  await save(page);

  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/recipes");
  const list = block(other, "recipes.list", "list");
  for (const name of ["layout-radius-none", "layout-padding-compact", "layout-title-large", "layout-border-none", "layout-styled-accent"])
    await expect(list).toHaveClass(new RegExp(name));
  await context.close();

  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Style List" }).click();
  await page.getByRole("dialog", { name: "Style" }).getByRole("button", { name: "Default look" }).click();
  await page.getByRole("dialog", { name: "Style" }).getByRole("button", { name: "Done" }).click();
  await save(page);
  await expect(block(page, "recipes.list", "list")).not.toHaveClass(/layout-radius|layout-styled/);
});

test.describe("on a phone (FLOW-278 AC5)", () => {
  test("stacks blocks in saved order and drops only the ones hidden on phone", async ({ page, browser }) => {
    await page.goto("/#/tasks");
    await page.getByRole("button", { name: "Edit screen text" }).click();
    // Half width on desktop; a phone still shows it full width.
    await page.getByRole("button", { name: "Half width: My tasks" }).click();
    await page.getByRole("button", { name: "Hide on phone: Overseeing" }).click();
    await save(page);
    await expect(block(page, "tasks.dashboard", "overseeing")).toBeVisible();

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await context.newPage();
    await mockBrowserAuth(phone);
    await phone.goto("/#/tasks");
    await expect(block(phone, "tasks.dashboard", "my-tasks")).toBeVisible();
    await expect(block(phone, "tasks.dashboard", "overseeing")).toBeHidden();
    // Saved reading order, one column.
    const ids = await phone.locator('[data-page-layout="tasks.dashboard"] > [data-block-id]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-block-id")),
    );
    expect(ids.slice(0, 2)).toEqual(["my-tasks", "overseeing"]);
    const box = await block(phone, "tasks.dashboard", "my-tasks").boundingBox();
    expect(box!.width).toBeGreaterThan(300);
    await context.close();
  });
});
