import { readFile } from "node:fs/promises";
import { test, expect, mockBrowserAuth, type Page } from "./auth-fixture";
import type { Browser, Download } from "@playwright/test";
import { seedUsers } from "../../worker/db/seed";
import { choose } from "./dropdown";
import { consumable, fallGala, juniper, lead } from "./fixtures";
import { seedInventory, seedLeads, seedRecords } from "./database";

// FLOW-279 against the real Worker and database: an Admin edits what a built-in
// card shows (Dashboard My Leads, a client's Events), everyone sees it, Reset
// card restores it; and the inventory tables take a column set and export it.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;

const edit = (page: Page) => page.getByRole("button", { name: "Edit screen text" }).click();
const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
};
async function asUser(browser: Browser, userId: string) {
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId });
  return { page: other, close: () => context.close() };
}
const csvHeader = async (download: Download) => (await readFile((await download.path())!, "utf8")).split(/\r?\n/)[0];

test("edits My Leads' columns, filter, sort and rows for everyone, then resets it (AC1)", async ({ page, browser }) => {
  await seedLeads([
    lead({ name: "Sam Wedding", eventName: "Spring wedding", guestCount: 120, status: "inquiry", assignedSalespersonId: salesperson.id }),
    lead({ name: "Sam Lost", eventName: "Fall party", guestCount: 40, status: "lost", assignedSalespersonId: salesperson.id }),
  ]);
  await page.goto("/#/");
  await edit(page);
  await page.getByRole("button", { name: "Edit My Leads", exact: true }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  // Source and title stay the card's own.
  await expect(builder.getByRole("combobox", { name: "Source" })).toBeDisabled();
  await expect(builder.getByLabel("Title")).toBeDisabled();
  await builder.getByRole("checkbox", { name: "Show Guests" }).click();
  await builder.getByRole("checkbox", { name: "Show Event date" }).click();
  await builder.getByRole("button", { name: "Add filter" }).click();
  const field = builder.getByRole("combobox", { name: "Filter field" }).last();
  await choose(field, { label: "Status" });
  await choose(builder.getByRole("combobox", { name: "Filter operator" }).last(), { label: "is not" });
  await choose(builder.getByRole("combobox", { name: "Filter value" }).last(), { label: "Lost" });
  await choose(builder.getByRole("combobox", { name: "Sort by" }), { label: "Guests" });
  await choose(builder.getByRole("combobox", { name: "Sort direction" }), { label: "Descending" });
  await builder.getByRole("spinbutton", { name: "Row limit" }).fill("5");
  await builder.getByRole("button", { name: "Done" }).click();
  await save(page);

  // A Salesperson sees their own leads through the edited card.
  const other = await asUser(browser, salesperson.id);
  await other.page.goto("/#/");
  const card = other.page.locator('[data-card-id="my-leads"]');
  await expect(card.getByRole("heading", { name: "My Leads" })).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Guests" })).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Event date" })).toHaveCount(0);
  await expect(card.getByText("Sam Wedding")).toBeVisible();
  await expect(card.getByText("Sam Lost")).toHaveCount(0);
  await other.close();

  // Reset card: the code's card again.
  await edit(page);
  await page.getByRole("button", { name: "Edit My Leads", exact: true }).click();
  await page.getByRole("dialog", { name: "Card builder" }).getByRole("button", { name: "Reset card" }).click();
  await save(page);
  await expect(page.locator('[data-card-id="my-leads"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /My Leads/ })).toBeVisible();
});

test("edits a client's Events related list (AC2)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/clients/${juniper().id}`);
  await page.getByRole("tab", { name: "Events" }).click();
  await edit(page);
  await page.getByRole("button", { name: "Edit Events", exact: true }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByRole("checkbox", { name: "Show Status" }).click();
  await builder.getByRole("checkbox", { name: "Show Venue" }).click();
  await builder.getByRole("button", { name: "Done" }).click();
  await save(page);
  await page.reload();
  await page.getByRole("tab", { name: "Events" }).click();
  const card = page.locator('[data-card-id="events"]');
  await expect(card.getByText("Fall gala")).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Venue" })).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Status" })).toHaveCount(0);
});

const inventoryTables = [
  { name: "Ingredients", path: "/#/inventory/ingredients", item: consumable("Synthetic flour", { unit: "lb" }), hide: "Storage" },
  {
    name: "Low stock",
    path: "/#/inventory/low-stock",
    item: consumable("Synthetic cream", { unit: "qt", onHand: 2, details: { parLevel: 6 } }),
    hide: "Vendor",
  },
];
for (const table of inventoryTables)
  test(`${table.name}: picks columns and exports what shows (AC3)`, async ({ page }) => {
    await seedInventory({ items: [table.item] });
    await page.goto(table.path);
    await expect(page.getByText(table.item.name).first()).toBeVisible();
    await edit(page);
    await page.getByRole("button", { name: "Columns" }).click();
    const picker = page.getByRole("dialog", { name: "Columns" });
    await picker.getByRole("checkbox", { name: "Show Unit", exact: true }).click();
    await picker.getByRole("checkbox", { name: `Show ${table.hide}`, exact: true }).click();
    await picker.getByRole("button", { name: "Done" }).click();
    await save(page);
    await expect(page.getByRole("columnheader", { name: "Unit", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: table.hide, exact: true })).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const header = (await csvHeader(await download)).split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    expect(header).toContain("Unit");
    expect(header).not.toContain(table.hide);
  });

for (const entry of [
  { name: "Working Staff", id: "working-staff", path: "/#/", tab: "", field: "Position" },
  { name: "Proposal tracker", id: "proposal-tracker", path: `/#/clients/${juniper().id}`, tab: "Proposal tracker", field: "Version" },
]) {
  test(`FLOW-281: ${entry.name} opens prefilled, shares and resets`, async ({ page, browser }) => {
    await seedRecords({ clients: [juniper()], events: [fallGala()] });
    await page.goto(entry.path);
    if (entry.tab) await page.getByRole("tab", { name: entry.tab, exact: true }).click();
    await edit(page);
    await page.getByRole("button", { name: `Edit ${entry.name}`, exact: true }).click();
    const builder = page.getByRole("dialog", { name: "Card builder" });
    await expect(builder.getByLabel("Title", { exact: true })).toHaveValue(entry.name);
    await expect(builder.getByRole("combobox", { name: "Source", exact: true })).toBeDisabled();
    await expect(builder.getByRole("checkbox", { name: `Show ${entry.field}`, exact: true })).toBeChecked();
    await builder.getByRole("checkbox", { name: `Show ${entry.field}`, exact: true }).click();
    await builder.getByRole("spinbutton", { name: "Row limit" }).fill("2");
    await builder.getByRole("button", { name: "Done", exact: true }).click();
    await save(page);
    const other = await asUser(browser, seedUsers.find((u) => u.role === "sales_manager")!.id);
    await other.page.goto(entry.path);
    if (entry.tab) await other.page.getByRole("tab", { name: entry.tab, exact: true }).click();
    await expect(other.page.locator(`[data-card-id="${entry.id}"]`).getByRole("heading", { name: entry.name, exact: true })).toBeVisible();
    await expect(other.page.getByRole("button", { name: "Edit screen text" })).toHaveCount(0);
    await other.close();
    await edit(page);
    await page.getByRole("button", { name: `Edit ${entry.name}`, exact: true }).click();
    await expect(builder.getByRole("spinbutton", { name: "Row limit" })).toHaveValue("2");
    await builder.getByRole("button", { name: "Reset card" }).click();
    await save(page);
    await expect(page.locator(`[data-card-id="${entry.id}"]`)).toHaveCount(0);
  });
}

test("FLOW-281: SOP columns save order and width and export only visible fields", async ({ page }) => {
  await page.goto("/#/sops/new");
  await page.getByLabel("Title", { exact: true }).fill("Sample loading procedure");
  await page.getByLabel("Category", { exact: true }).fill("Production");
  await page.getByRole("textbox", { name: "SOP content" }).fill("Count the sample boxes.");
  await page.getByRole("button", { name: "Save SOP" }).click();
  await expect(page.getByRole("heading", { name: "Sample loading procedure", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /SOP library/ }).click();
  await expect(page.getByRole("heading", { name: "SOP library", exact: true })).toBeVisible();
  await edit(page);
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Columns" });
  // Owner is shown by default (FLOW-270); Last updated is an extra SOP field.
  await picker.getByRole("checkbox", { name: "Show Owner", exact: true }).click();
  await picker.getByRole("checkbox", { name: "Show Last updated", exact: true }).click();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  const resize = page.getByRole("separator", { name: /Title/ });
  await resize.focus();
  await resize.press("ArrowRight");
  await save(page);
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "Owner", exact: true })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Last updated", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const header = await csvHeader(await download);
  expect(header).toContain("Last updated");
  expect(header).not.toContain("Owner");
});
