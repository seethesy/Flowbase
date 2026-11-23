import { test, expect, mockBrowserAuth, type Page } from "./auth-fixture";
import { browserDb, seedLeads } from "./database";
import { lead } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";
import { uiLayout, leads, auditLog } from "../../worker/db/schema";
import { emptyLayout, type LayoutDoc } from "../../shared/layout";
import { eq } from "drizzle-orm";
const edit = (page: Page) => page.getByRole("button", { name: "Edit screen text" }).click();
const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
};
async function remove(page: Page, name: string, permanent = false) {
  await page.getByRole("button", { name: `${permanent ? "Delete permanently" : "Delete"} ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `${permanent ? "Delete permanently" : "Delete"} ${name}?`, exact: true });
  if (permanent) await expect(dialog.getByText(/This can't be undone/)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
}
async function saved(pageKey: string) {
  return browserDb(async (db) => (await db.select().from(uiLayout).where(eq(uiLayout.pageKey, pageKey)))[0]?.layout);
}
for (const entry of [
  { key: "dashboard.home", path: "/#/", id: "my-tasks", name: "My Tasks" },
  { key: "leads.detail", path: "lead", id: "notes", name: "Notes" },
  { key: "staff.list", path: "/#/staff", id: "filters", name: "Filters" },
]) test(`FLOW-282: delete, restore, permanently remove, reset and cancel on ${entry.key} (AC1-6)`, async ({ page, browser }) => {
  const record = lead({ name: "Lifecycle record" }); await seedLeads([record]);
  const path = entry.path === "lead" ? `/#/leads/${record.id}` : entry.path;
  const doc: LayoutDoc = { ...emptyLayout(), blocks: [
    { kind: "builtin", id: entry.id, x: 0, y: 0, w: 6, h: 12, style: { background: "#ffffff" }, visibleTo: ["admin", "sales_manager"] },
    { kind: "text", id: "note-1", variant: "note", text: "Layout note", x: 0, y: 100, w: 6, h: 3 },
    { kind: "card", id: "card-1", x: 6, y: 100, w: 6, h: 8, card: { title: "Lifecycle custom", source: { type: "list", list: "events" }, limit: 5, filters: [], display: { type: "table", columns: [{ key: "title" }] } } },
  ] };
  await browserDb((db) => db.insert(uiLayout).values({ pageKey: entry.key, layout: doc }));
  await page.goto(path); await edit(page);
  // Materialize any newly added code blocks before measuring the last saved position.
  await page.getByRole("button", { name: `Half width: ${entry.name}`, exact: true }).click(); await save(page);
  const original = (await saved(entry.key)).blocks.find((b) => b.id === entry.id);
  await edit(page); await remove(page, entry.name);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  expect((await saved(entry.key)).blocks.find((b) => b.id === entry.id)?.deleted).toBeUndefined();
  await edit(page);
  for (const name of [entry.name, "Note", "Lifecycle custom"]) await remove(page, name);
  await page.getByRole("button", { name: "Deleted items (3)", exact: true }).click();
  const tray = page.getByRole("dialog", { name: "Deleted items", exact: true });
  await expect(tray.getByText(/Deleted by/)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Hidden items (0)", exact: true })).toBeVisible();
  await save(page);
  const otherContext = await browser.newContext(); const other = await otherContext.newPage();
  await mockBrowserAuth(other, { userId: seedUsers.find((u) => u.role === "sales_manager")!.id });
  await other.goto(path);
  await expect(other.locator(`[data-page-layout="${entry.key}"]`)).toBeVisible();
  for (const id of [entry.id, "note-1", "card-1"]) await expect(other.locator(`[data-page-layout="${entry.key}"] > [data-block-id="${id}"]`)).toHaveCount(0);
  await expect(other.getByRole("button", { name: /Delete|Deleted items|Hidden items/ })).toHaveCount(0);
  await otherContext.close();
  await edit(page); await page.getByRole("button", { name: "Deleted items (3)", exact: true }).click();
  for (let n = 0; n < 3; n++) await tray.getByRole("button", { name: "Restore", exact: true }).first().click();
  await save(page);
  expect((await saved(entry.key)).blocks.find((b) => b.id === entry.id)).toEqual(original);
  await edit(page);
  for (const name of [entry.name, "Note", "Lifecycle custom"]) await remove(page, name);
  await page.getByRole("button", { name: "Deleted items (3)", exact: true }).click();
  for (const name of [entry.name, "Note", "Lifecycle custom"]) await remove(page, name, true);
  await save(page);
  const permanent = await saved(entry.key);
  expect(permanent.blocks.find((b) => b.id === entry.id)?.removed).toBe(true);
  expect(permanent.blocks.some((b) => b.id === "note-1" || b.id === "card-1")).toBe(false);
  await page.reload(); await edit(page);
  await expect(page.getByRole("button", { name: "Deleted items (0)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset page layout", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByText(/Permanently removed built-in items return/)).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click(); await save(page);
  expect(await saved(entry.key)).toBeUndefined();
  const audits = await browserDb((db) => db.select().from(auditLog).where(eq(auditLog.entityType, "ui_layout")));
  const changes = JSON.stringify(audits);
  for (const action of ["delete", "restore", "permanent-delete"]) expect(changes).toContain(action);
});

test("FLOW-282: independent table, section header and optional field deletion preserves lead data", async ({ page }) => {
  const record = lead({ name: "Unchanged lead", phone: "555-0100" }); await seedLeads([record]);
  const before = await browserDb((db) => db.select().from(leads));
  await page.goto(`/#/leads/${record.id}`); await edit(page);
  await remove(page, "Notes header");
  await remove(page, "Phone");
  await save(page);
  await expect(page.locator('#notes').getByRole("heading", { name: "Notes", exact: true })).toHaveCount(0);
  expect((await saved("leads.detail")).fieldBoxes["lead-facts"].boxes.find((b) => b.field === "phone")?.deleted).toBeTruthy();
  expect(await browserDb((db) => db.select().from(leads))).toEqual(before);
  await page.goto("/#/staff"); await edit(page);
  await remove(page, "staff.staff-directory table"); await remove(page, "Page subtitle"); await save(page);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect((await saved("staff.list")).tables["staff.staff-directory"].deleted).toBeTruthy();
  await edit(page); await page.getByRole("button", { name: "Deleted items (2)" }).click();
  const tray = page.getByRole("dialog", { name: "Deleted items", exact: true });
  await tray.getByRole("button", { name: "Restore", exact: true }).first().click();
  await tray.getByRole("button", { name: "Restore", exact: true }).first().click(); await save(page);
  await expect(page.getByRole("table")).toBeVisible();
});
