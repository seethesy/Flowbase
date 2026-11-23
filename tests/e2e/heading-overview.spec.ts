import { test, expect, mockBrowserAuth } from "./auth-fixture";
import type { Page } from "@playwright/test";
import { seedUsers } from "../../worker/db/seed";

// FLOW-295 on the real Worker and database: Sales, Marketing, Documents and
// Reports open on an Overview tab that starts empty, an Admin adds a card there
// in live edit that everyone then sees, and the other tabs keep their URLs.
const salesperson = seedUsers.find((user) => user.role === "salesperson")!;

const tabs = (page: Page, heading: string) =>
  page.getByRole("navigation", { name: `${heading} pages` }).getByRole("link");

test("each heading opens on its Overview, and the old tabs keep their URLs (AC1, AC3)", async ({ page, isMobile }) => {
  for (const [heading, url, rest] of [
    ["Sales", "/sales/overview", ["Leads", "Clients", "Proposals", "Sales tracker", "Venues"]],
    ["Marketing", "/marketing/overview", ["Photos"]],
    ["Documents", "/documents/overview", ["Documents"]],
    ["Reports", "/reports/overview", ["Time tracking", "Operational reports"]],
  ] as const) {
    await page.goto("/");
    if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: heading, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${url}$`));
    await expect(tabs(page, heading)).toHaveText(["Overview", ...rest]);
    await expect(tabs(page, heading).filter({ hasText: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  await page.getByRole("button", { name: "Edit screen text" }).click();
  await page.getByRole("button", { name: "Add card" }).click();
  const builder = page.getByRole("dialog", { name: "Card builder" });
  await builder.getByLabel("Title").fill("Pipeline at a glance");
  await builder.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pipeline at a glance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing here yet" })).toHaveCount(0);

  const context = await browser.newContext();
  const other = await context.newPage();
  await mockBrowserAuth(other, { userId: salesperson.id });
  await other.goto("/#/sales/overview");
  await expect(other.getByRole("heading", { name: "Pipeline at a glance" })).toBeVisible();
  await expect(other.getByRole("toolbar", { name: "Page layout" })).toHaveCount(0);
  await context.close();
});
