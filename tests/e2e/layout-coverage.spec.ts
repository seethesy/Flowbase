import { test, expect, mockBrowserAuth, type Page } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import { choose } from "./dropdown";
import { fallGala, juniper, lead } from "./fixtures";
import { seedLeads, seedRecords } from "./database";

// FLOW-274: the layout features FLOW-273 left without Playwright coverage, on the
// real Worker and database: drag and resize, colors, restricted roles, the event
// and record pages, and custom cards.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;
const partTime = seedUsers.find((user) => user.role === "part_time_staff")!;

const edit = (page: Page) => page.getByRole("button", { name: "Edit screen text" }).click();
const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
};
async function dragBy(page: Page, handle: ReturnType<Page["locator"]>, dx: number, dy = 0) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}
async function asUser(browser: import("@playwright/test").Browser, userId: string) {
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId });
  return { page: other, close: () => context.close() };
}

test("an Admin moves and resizes a built-in card, saves, and another user sees it (AC1)", async ({ page, browser }) => {
  await page.goto("/#/venues");
  await edit(page);
  const frame = page.locator('.layout-grid-item[data-layout-id="list"]');
  await expect(frame).toBeVisible();
  // Resize from the corner: the full-width block gets narrower.
  const before = (await frame.boundingBox())!;
  await dragBy(page, frame.locator(".react-resizable-handle-se"), -Math.round(before.width / 2));
  const resized = (await frame.boundingBox())!;
  expect(resized.width).toBeLessThan(before.width * 0.75);
  // Move it right by its handle.
  await dragBy(page, frame.locator(".layout-handle"), Math.round(before.width / 3));
  const moved = (await frame.boundingBox())!;
  expect(moved.x).toBeGreaterThan(resized.x + 20);
  await save(page);

  const saved = page.locator('[data-block-id="list"]');
  await expect(saved).toHaveAttribute("style", /grid-column: (?!1 )\d+ \/ span (?!12)\d+/);
  const other = await asUser(browser, salesperson.id);
  await other.page.goto("/#/venues");
  await expect(other.page.locator('[data-block-id="list"]')).toHaveAttribute("style", /grid-column: (?!1 )\d+ \/ span (?!12)\d+/);
  await other.close();
});

test("an Admin colors a custom card and a field box, everyone sees them, Default restores the look (AC2)", async ({ page, browser }) => {
  await seedRecords({ clients: [juniper()] });
  const url = `/#/clients/${juniper().id}`;
  await page.goto(url);
  await edit(page);

  // A single field box.
  await page.getByRole("button", { name: "Style Name" }).click();
  const boxStyle = page.getByRole("dialog", { name: "Style" });
  await boxStyle.getByRole("button", { name: "Background color: Soft green" }).click();
  await boxStyle.getByRole("button", { name: "Text color: Primary" }).click();
  await boxStyle.getByRole("button", { name: "Done" }).click();

  // A custom card, with its own background.
  await page.getByRole("button", { name: "Add card" }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Client snapshot");
  await choose(builder.getByRole("combobox", { name: "Source" }), "record");
  await builder.getByRole("radio", { name: "Boxes" }).check();
  await choose(builder.getByRole("combobox", { name: "Add field" }), { label: "Name" });
  await builder.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Style Client snapshot" }).click();
  const cardStyle = page.getByRole("dialog", { name: "Style" });
  await cardStyle.getByRole("button", { name: "Background color: Soft green" }).click();
  await cardStyle.getByRole("button", { name: "Done" }).click();
  await save(page);

  const colored = (p: Page) => p.locator('[data-field-card="client-facts"] .layout-styled-bg');
  await expect(colored(page)).toHaveCount(1);
  const other = await asUser(browser, salesperson.id);
  await other.page.goto(url);
  await expect(other.page.getByRole("heading", { name: "Client snapshot" })).toBeVisible();
  await expect(colored(other.page)).toHaveCount(1);
  await other.close();

  // Default on the box restores its look.
  await edit(page);
  await page.getByRole("button", { name: "Style Name" }).click();
  const again = page.getByRole("dialog", { name: "Style" });
  await again.getByRole("group", { name: "Background color" }).getByRole("button", { name: "Default" }).click();
  await again.getByRole("group", { name: "Text color" }).getByRole("button", { name: "Default" }).click();
  await again.getByRole("button", { name: "Done" }).click();
  await save(page);
  await expect(colored(page)).toHaveCount(0);
});

test("a role that can't read a column never gets it, and Export CSV matches the visible columns (AC3)", async ({ page, browser }) => {
  await page.goto("/#/staff");
  await edit(page);
  await page.getByRole("button", { name: "Columns" }).click();
  const picker = page.getByRole("dialog", { name: "Columns" });
  // Notes is readable by full-time staff and above only.
  await picker.getByRole("checkbox", { name: "Show Notes" }).click();
  await picker.getByRole("button", { name: "Done" }).click();
  await save(page);
  await expect(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const header = (await (await download).createReadStream()!.toArray()).join("").split("\n")[0];
  expect(header).toContain("Notes");

  const other = await asUser(browser, partTime.id);
  await other.page.goto("/#/staff");
  await expect(other.page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect(other.page.getByRole("columnheader", { name: "Notes" })).toHaveCount(0);
  const otherDownload = other.page.waitForEvent("download");
  await other.page.getByRole("button", { name: "Export CSV" }).click();
  const otherHeader = (await (await otherDownload).createReadStream()!.toArray()).join("").split("\n")[0];
  expect(otherHeader).not.toContain("Notes");
  await other.close();
});

test("event page: hide a field with Edit mode matching, required fields have no ×, text persists and deletes (AC4)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Dress code").first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();

  await edit(page);
  // Required fields can't be hidden.
  await expect(page.getByRole("button", { name: "Hide Event" })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide Dress code" }).click();
  // A heading inside the card, and a note on the page.
  const card = page.locator('[data-field-card="event-facts"]');
  await choose(card.locator("xpath=ancestor::section[1]").getByRole("combobox", { name: "Add text" }), "heading");
  await page.getByRole("textbox", { name: "Heading text" }).first().fill("Gala facts");
  await choose(page.getByRole("toolbar", { name: "Page layout" }).getByRole("combobox", { name: "Add text" }), "note");
  await page.getByRole("textbox", { name: "Note text" }).last().fill("Confirm the load-in window");
  await save(page);
  await expect(page.getByRole("heading", { name: "Gala facts" })).toBeVisible();
  await expect(page.getByText("Confirm the load-in window")).toBeVisible();

  // Persist across a reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Gala facts" })).toBeVisible();
  await expect(page.getByText("Confirm the load-in window")).toBeVisible();

  // Edit mode matches: no Dress code input, Guest count stays.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Dress code")).toHaveCount(0);
  await expect(page.getByLabel("Guest count")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();

  // Delete both texts.
  await edit(page);
  await page.getByRole("button", { name: "Delete Note" }).click();
  await page.getByRole("alertdialog", { name: "Delete this text?" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete Heading" }).click();
  await page.getByRole("alertdialog", { name: "Delete Heading?" }).getByRole("button", { name: "Delete" }).click();
  await save(page);
  await expect(page.getByRole("heading", { name: "Gala facts" })).toHaveCount(0);
  await expect(page.getByText("Confirm the load-in window")).toHaveCount(0);
});

test("a restricted role never sees a field box it can't read (AC4)", async ({ page, browser }) => {
  const member = seedUsers.find((user) => user.role === "staff")!;
  await page.goto(`/#/staff/${member.id}`);
  await edit(page);
  await choose(page.getByRole("combobox", { name: "Add field" }), { label: "Notes" });
  await save(page);
  await expect(page.locator('[data-field-card="staff-facts"]').getByText("Notes", { exact: true })).toBeVisible();

  const other = await asUser(browser, partTime.id);
  await other.page.goto(`/#/staff/${member.id}`);
  await expect(other.page.locator('[data-field-card="staff-facts"]')).toBeVisible();
  await expect(other.page.locator('[data-field-card="staff-facts"]').getByText("Notes", { exact: true })).toHaveCount(0);
  await other.close();
});

test("Dashboard: an Unassigned leads card works for an Admin and a Salesperson (AC5)", async ({ page, browser }) => {
  await seedLeads([
    lead({ name: "Nobody Owns Me", assignedSalespersonId: null }),
    lead({ name: "Owned By Sam", assignedSalespersonId: salesperson.id }),
  ]);
  await page.goto("/#/");
  await edit(page);
  await page.getByRole("button", { name: "Add card" }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Unassigned leads");
  await choose(builder.getByRole("combobox", { name: "Source" }), "list:leads");
  await builder.getByRole("button", { name: "Add filter" }).click();
  await choose(builder.getByRole("combobox", { name: "Filter field" }), { label: "Salesperson" });
  await choose(builder.getByRole("combobox", { name: "Filter operator" }), { label: "is empty" });
  await builder.getByRole("checkbox", { name: "Show Client" }).click();
  await builder.getByRole("button", { name: "Done" }).click();
  await save(page);
  const card = page.locator("[data-card-id]").filter({ has: page.getByRole("heading", { name: "Unassigned leads" }) });
  await expect(card.getByText("Nobody Owns Me")).toBeVisible();
  await expect(card.getByText("Owned By Sam")).toHaveCount(0);

  const other = await asUser(browser, salesperson.id);
  await other.page.goto("/#/");
  const theirs = other.page.locator("[data-card-id]").filter({ has: other.page.getByRole("heading", { name: "Unassigned leads" }) });
  await expect(theirs).toBeVisible();
  await expect(theirs.getByText("Owned By Sam")).toHaveCount(0);
  await other.close();
});

test("a This record 2 × 2 Boxes card and an event's Tasks related list: add, edit, Cancel, delete (AC5)", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await page.goto(`/#/clients/${juniper().id}`);
  await edit(page);
  await page.getByRole("button", { name: "Add card" }).click();
  let builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("This client");
  await choose(builder.getByRole("combobox", { name: "Source" }), "record");
  await builder.getByRole("radio", { name: "Boxes" }).check();
  const add = builder.getByRole("combobox", { name: "Add field" });
  await choose(add, { label: "Name" });
  await choose(add, { label: "Type" });
  await choose(add, { label: "Notes" });
  await choose(add, { label: "Created" });
  await builder.getByRole("button", { name: "Done" }).click();
  await save(page);
  const card = page.locator("[data-card-id]").filter({ has: page.getByRole("heading", { name: "This client" }) });
  await expect(card.getByText(juniper().name)).toBeVisible();

  // Editing, then Cancel leaves the card as it was.
  await edit(page);
  await page.getByRole("button", { name: "Edit This client" }).click();
  builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Renamed card");
  await builder.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Card builder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit This client" })).toBeVisible();
  await page.getByRole("button", { name: "Edit This client" }).click();
  builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Our client");
  await builder.getByRole("button", { name: "Done" }).click();
  await save(page);
  await expect(page.getByRole("heading", { name: "Our client" })).toBeVisible();

  // Delete it.
  await edit(page);
  await page.getByRole("button", { name: "Delete Our client" }).click();
  await page.getByRole("alertdialog", { name: "Delete this card?" }).getByRole("button", { name: "Delete" }).click();
  await save(page);
  await expect(page.getByRole("heading", { name: "Our client" })).toHaveCount(0);

  // An event's related Tasks list.
  await page.goto(`/#/events/${fallGala().id}`);
  await edit(page);
  await page.getByRole("button", { name: "Add card" }).click();
  builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Event tasks");
  await choose(builder.getByRole("combobox", { name: "Source" }), "related:tasks");
  await builder.getByRole("checkbox", { name: /^Show / }).first().click();
  await builder.getByRole("button", { name: "Done" }).click();
  await save(page);
  await expect(page.getByRole("heading", { name: "Event tasks" })).toBeVisible();
});
