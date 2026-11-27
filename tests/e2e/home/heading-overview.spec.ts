import { test, expect, mockBrowserAuth } from "../auth-fixture";
import type { Page } from "@playwright/test";
import { seedUsers } from "../../../worker/db/seed";
import { choose } from "../dropdown";

// FLOW-295 on the real Worker and database: Sales, Marketing, Documents and
// These headings open on an Overview tab that starts empty, an Admin adds a card there
// in live edit that everyone then sees, and the other tabs keep their URLs.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;

const tabs = (page: Page, heading: string) =>
  page.getByRole("navigation", { name: `${heading} pages` }).getByRole("link");

test("each heading opens on its Overview, and the old tabs keep their URLs (AC1, AC3)", async ({ page, isMobile }) => {
  for (const [heading, url, rest] of [
    // FLOW-328/329: Leads and Proposals moved to the Leads heading; Pricing is new.
    // FLOW-340: Past Events, Network and Analytics; FLOW-341: Marketing's areas.
    ["Sales", "/sales/overview", ["Past Events", "Network", "Analytics", "Pricing", "Time Tracking"]],
    ["Marketing", "/marketing/overview", ["Socials", "Movies", "Other Events", "SEO", "Website", "Photos", "Analytics"]],
    ["Documents", "/documents/overview", ["Documents", "Templates"]],
  ] as const) {
    await page.goto("/");
    if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: heading, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${url}$`));
    await expect(tabs(page, heading)).toHaveText(["Overview", ...rest]);
    await expect(tabs(page, heading).filter({ hasText: "Overview" })).toHaveAttribute("aria-current", "page");
    // Sales › Overview lists the late-stage leads (FLOW-328), Marketing's has the
    // shared Notes card (FLOW-341 A2); Documents starts empty.
    if (heading === "Sales") await expect(page.getByLabel("Statuses", { exact: true })).toBeVisible();
    else if (heading === "Marketing") await expect(page.getByRole("textbox", { name: "Notes" })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  }
  // FLOW-340: the Sales tracker is under Analytics now.
  await page.goto("/#/sales");
  await expect(page).toHaveURL(/#\/sales\/analytics$/);
  await expect(tabs(page, "Sales").filter({ hasText: "Analytics" })).toHaveAttribute("aria-current", "page");
  await page.goto("/#/documents");
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await page.goto("/#/reports/operations");
  await expect(page).toHaveURL(/#\/sales\/time-tracking$/);
  await expect(tabs(page, "Sales").filter({ hasText: "Time Tracking" })).toHaveAttribute("aria-current", "page");
  await page.goto("/#/marketing");
  await expect(tabs(page, "Marketing").filter({ hasText: "Photos" })).toHaveAttribute("aria-current", "page");
});

test("an Admin adds a card to the Sales overview that everyone sees (AC2)", async ({ page, browser }) => {
  await page.goto("/#/sales/overview");
  // The leads table is there from the start (FLOW-328); the card goes around it.
  await expect(page.getByLabel("Statuses", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Add card" }).click();
  // The Leads table fills the grid, so Add card opens the builder in a new row.
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Pipeline at a glance");
  // A table card needs at least one column before Save card.
  await choose(builder.getByRole("combobox", { name: "Source" }), "list:leads");
  await builder.getByRole("checkbox", { name: "Show Client" }).click();
  await builder.getByRole("button", { name: "Save card" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pipeline at a glance" })).toBeVisible();
  await expect(page.getByLabel("Statuses", { exact: true })).toBeVisible();

  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/sales/overview");
  await expect(other.getByRole("heading", { name: "Pipeline at a glance" })).toBeVisible();
  await expect(other.getByRole("toolbar", { name: "Page layout" })).toHaveCount(0);
  await context.close();
});

// FLOW-341 AC2: each Marketing area is its own page; a card added on one shows
// there for everyone with marketing.read, and on no other tab. Socials to SEO
// start with the shared Notes card (A2), Website and Analytics empty.
test("an Admin adds a card to Marketing › Socials only (FLOW-341)", async ({ page, browser }) => {
  for (const area of ["socials", "movies", "other-events", "seo"]) {
    await page.goto(`/#/marketing/${area}`);
    await expect(page.getByRole("textbox", { name: "Notes" })).toBeVisible();
  }
  for (const area of ["website", "analytics"]) {
    await page.goto(`/#/marketing/${area}`);
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  }
  await page.goto("/#/marketing/socials");
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Add card" }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Posting plan");
  await choose(builder.getByRole("combobox", { name: "Source" }), "list:leads");
  await builder.getByRole("checkbox", { name: "Show Client" }).click();
  await builder.getByRole("button", { name: "Save card" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Posting plan" })).toBeVisible();
  await page.goto("/#/marketing/movies");
  await expect(page.getByRole("textbox", { name: "Notes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Posting plan" })).toHaveCount(0);

  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/marketing/socials");
  await expect(other.getByRole("heading", { name: "Posting plan" })).toBeVisible();
  await context.close();
});

// FLOW-341 A2: anyone who sees Marketing types in a tab's Notes, and everyone
// sees the saved text with who saved it.
test("a salesperson types Marketing › SEO notes that an Admin then sees (FLOW-341 A2)", async ({ page, browser }) => {
  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/marketing/seo");
  await other.getByRole("textbox", { name: "Notes" }).fill("Refresh the wedding page keywords.");
  await other.getByRole("button", { name: "Save notes" }).click();
  await expect(other.getByRole("status").filter({ hasText: "Notes saved." })).toBeVisible();
  await context.close();

  await page.goto("/#/marketing/seo");
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Refresh the wedding page keywords.");
  await expect(page.getByText(`Last saved by ${salesperson.name}`)).toBeVisible();
  // Each tab keeps its own notes.
  await page.goto("/#/marketing/socials");
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("");
});

// FLOW-340 A1 / FLOW-341 A1: Marketing analytics is one page in two places.
test("Marketing › Analytics and Sales › Analytics › Marketing analytics share a page (FLOW-340/341)", async ({ page }) => {
  await page.goto("/#/sales/analytics");
  await page.getByRole("tab", { name: "Marketing analytics" }).click();
  await expect(page).toHaveURL(/#\/sales\/analytics\?view=marketing$/);
  await expect(page.getByRole("heading", { name: "Marketing analytics", level: 1 })).toBeVisible();
  await page.goto("/#/marketing/analytics");
  await expect(page.getByRole("heading", { name: "Marketing analytics", level: 1 })).toBeVisible();
  await expect(tabs(page, "Marketing").filter({ hasText: "Analytics" })).toHaveAttribute("aria-current", "page");
});
