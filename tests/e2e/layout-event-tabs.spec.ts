import { eq } from "drizzle-orm";
import { test, expect, mockBrowserAuth } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

const sections = [
  ["events.staff", "leads", "Production leads"],
  ["events.trucks", "assignments", "Truck assignments"],
  ["events.payments", "summary", "Payment summary"],
  ["events.timeline", "timeline", "Event timeline"],
  ["events.preparation", "progress", "Planning progress"],
  ["events.activity", "history", "Event history"],
  ["events.beo", "summary", "Event summary"],
] as const;
for (const [pageKey, id, name] of sections) {
  test(`FLOW-280: ${pageKey} saves independently for another user`, async ({ page, browser }) => {
    await seedRecords({ clients: [juniper()], events: [fallGala()] });
    await browserDb((db) => db.update(s.events).set({ status: "preparation" }).where(eq(s.events.id, fallGala().id)));
    await page.goto(`/#/events/${fallGala().id}`);
    await page.getByRole("button", { name: "Edit screen text" }).click();
    const section = page.locator(`[data-page-layout="${pageKey}"]`);
    await section.getByRole("button", { name: `Half width: ${name}`, exact: true }).click();
    const moving = section.getByLabel(`${name}: arrow keys move, Shift and arrow keys resize`, { exact: true });
    await moving.focus();
    await moving.press("ArrowDown");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
    const selector = `[data-page-layout="${pageKey}"] > [data-block-id="${id}"]`;
    await expect(page.locator(selector)).toHaveCSS("grid-column-end", "span 6");
    const placed = await page.locator(selector).getAttribute("style");
    const context = await browser.newContext();
    const other = await context.newPage();
    await mockBrowserAuth(other, { userId: seedUsers.find((u) => u.role === "sales_manager")!.id });
    await other.goto(`/#/events/${fallGala().id}`);
    await expect(other.locator(selector)).toHaveCSS("grid-column-end", "span 6");
    expect(await other.locator(selector).getAttribute("style")).toBe(placed);
    await expect(other.locator('[data-page-layout="events.detail"]')).toHaveCount(0);
    await context.close();
  });
}
for (const [path, pageKey] of [["staff", "staff.list"], ["inventory", "inventory.list"]]) {
  test(`FLOW-280: ${path} preserves the saved list id and moves filters`, async ({ page }) => {
    await browserDb((db) => db.insert(s.uiLayout).values({ pageKey, updatedBy: seedUsers[0].id,
      layout: { version: 1, blocks: [{ kind: "builtin", id: "list", x: 0, y: 0, w: 12, h: 24 }], tables: {}, fieldBoxes: {} } }));
    await page.goto(`/#/${path}`);
    await expect(page.locator(`[data-page-layout="${pageKey}"] > [data-block-id="list"]`)).toBeVisible();
    await page.getByRole("button", { name: "Edit screen text" }).click();
    await page.getByRole("button", { name: "Half width: Filters" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.reload();
    await expect(page.locator(`[data-page-layout="${pageKey}"] > [data-block-id="filters"]`)).toHaveCSS("grid-column-end", "span 6");
    await expect(page.locator(`[data-page-layout="${pageKey}"] > [data-block-id="list"]`)).toBeVisible();
  });
}

