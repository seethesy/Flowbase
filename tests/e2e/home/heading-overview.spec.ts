import { test, expect, mockBrowserAuth } from "../auth-fixture";
import type { Page } from "@playwright/test";
import { seedUsers } from "../../../worker/db/seed";
import { choose } from "../dropdown";

// FLOW-295 on the real Worker and database: Sales, Marketing, Documents and
// Reports open on an Overview tab that starts empty, an Admin adds a card there
// in live edit that everyone then sees, and the other tabs keep their URLs.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;

const tabs = (page: Page, heading: string) =>
  page.getByRole("navigation", { name: `${heading} pages` }).getByRole("link");

test("each heading opens on its Overview, and the old tabs keep their URLs (AC1, AC3)", async ({ page, isMobile }) => {
  for (const [heading, url, rest] of [
    // FLOW-328/329: Leads and Proposals moved to the Leads heading; Pricing is new.
    ["Sales", "/sales/overview", ["Clients", "Sales tracker", "Venues", "Pricing"]],
    ["Marketing", "/marketing/overview", ["Photos"]],
    ["Documents", "/documents/overview", ["Documents", "Templates"]],
    ["Reports", "/reports/overview", ["Time tracking", "Operational reports"]],
  ] as const) {
    await page.goto("/");
    if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: heading, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${url}$`));
    await expect(tabs(page, heading)).toHaveText(["Overview", ...rest]);
    await expect(tabs(page, heading).filter({ hasText: "Overview" })).toHaveAttribute("aria-current", "page");
    // Sales › Overview lists the late-stage leads (FLOW-328); the others start empty.
    if (heading === "Sales") await expect(page.getByLabel("Statuses", { exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  }
  await page.goto("/#/sales");
  await expect(tabs(page, "Sales").filter({ hasText: "Sales tracker" })).toHaveAttribute("aria-current", "page");
  await page.goto("/#/documents");
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await page.goto("/#/reports/operations");
  await expect(tabs(page, "Reports").filter({ hasText: "Operational reports" })).toHaveAttribute("aria-current", "page");
  await page.goto("/#/marketing");
  await expect(tabs(page, "Marketing").filter({ hasText: "Photos" })).toHaveAttribute("aria-current", "page");
});

test("an Admin adds a card to the Sales overview that everyone sees (AC2)", async ({ page, browser }) => {
  await page.goto("/#/sales/overview");
  // The leads table is there from the start (FLOW-328); the card goes around it.
  await expect(page.getByLabel("Statuses", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Add card" }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Pipeline at a glance");
  // A table card needs at least one column before Done.
  await choose(builder.getByRole("combobox", { name: "Source" }), "list:leads");
  await builder.getByRole("checkbox", { name: "Show Client" }).click();
  await builder.getByRole("button", { name: "Done" }).click();
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
