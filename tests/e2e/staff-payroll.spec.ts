import { eq } from "drizzle-orm";
import { test, expect, mockBrowserAuth, type Page } from "./auth-fixture";
import { browserDb } from "./database";
import { choose } from "./dropdown";
import * as s from "../../worker/db/schema";
import { seedUsers } from "../../worker/db/seed";

// Staff directory, staff without accounts and the Payroll tab (FLOW-270) on the
// real Worker and database: as Admin (the default sign-in), Technical and
// Sales Manager.

const technical = seedUsers.find((user) => user.role === "technical")!;
const salesManager = seedUsers.find((user) => user.role === "sales_manager")!;

async function asUser(browser: import("@playwright/test").Browser, userId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await mockBrowserAuth(page, { userId });
  return { page, close: () => context.close() };
}
const headers = async (page: Page) =>
  (await page.locator("thead th").allTextContents()).map((text) => text.replace(/[↑↓]/g, "").trim()).filter(Boolean);

test("the directory shows Name, Positions, Role, Phone, Email and Status, and a row click opens the profile (AC3, AC5)", async ({ page }) => {
  const [server] = seedUsers.filter((user) => user.role === "staff");
  await browserDb((db) => db.update(s.users).set({ positions: ["Server"] }).where(eq(s.users.id, server.id)));
  await page.goto("/#/staff");
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  expect(await headers(page)).toEqual(["Name", "Positions", "Role", "Phone", "Email", "Status"]);
  await expect(page.getByRole("columnheader", { name: "Open" })).toHaveCount(0);
  const row = page.getByRole("row", { name: new RegExp(server.name.replace(/[()]/g, "\\$&")) });
  // Positions show as chips; the Part-time Staff role is listed too.
  await expect(row.locator(".staff-position-chips .badge")).toHaveText(["Server"]);
  await expect(page.getByRole("row", { name: /Part Time Staff/ }).first()).toBeVisible();
  // Clicking anywhere on the row (here, the Status cell) opens the profile.
  await row.getByRole("cell").last().click();
  await expect(page).toHaveURL(new RegExp(`#/staff/${server.id}$`));
});

test("an Admin adds a staff member without an account: no email and a blank role (AC4)", async ({ page }) => {
  await page.goto("/#/staff");
  await page.getByRole("button", { name: "Add staff without an account" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Name").fill("Robin Runner");
  await drawer.getByLabel("Phone number").fill("2025550142");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/staff") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "Add staff" }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Robin Runner" })).toBeVisible();
  await expect(page.getByText("No Flowbase account").first()).toBeVisible();
  await page.goto("/#/staff");
  // The directory shows 8 rows a page; search so Robin is on the first.
  await page.getByPlaceholder("Search name or email…").fill("Robin");
  const row = page.getByRole("row", { name: /Robin Runner/ });
  await expect(row).toBeVisible();
  const cells = row.getByRole("cell");
  const index = (await headers(page)).indexOf("Role");
  await expect(cells.nth(index)).toHaveText("");
  // The Role filter (Admin and Technical) finds people without an account.
  await choose(page.getByLabel("Role", { exact: true }), { label: "No account" });
  await expect(page.getByText("1 staff", { exact: true })).toBeVisible();
});

test("Admin edits pay type and rate on Payroll and the change persists (AC1)", async ({ page }) => {
  const [server] = seedUsers.filter((user) => user.role === "staff");
  await page.goto("/#/staffing/payroll");
  await expect(page.getByRole("heading", { name: "Payroll", level: 1 })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(server.name.replace(/[()]/g, "\\$&")) });
  // Read the headers once the Pay table has loaded, not while it's a skeleton.
  await expect(row).toBeVisible();
  const columns = await headers(page);
  expect(columns).toContain("Pay type");
  const saved = () => page.waitForResponse((response) => response.url().endsWith("/api/staff-pay") && response.request().method() === "PUT");
  let done = saved();
  await row.getByRole("cell").nth(columns.indexOf("Pay type")).getByRole("button").click();
  await page.getByRole("listbox").last().getByRole("option", { name: "Hourly", exact: true }).click();
  expect((await done).ok()).toBeTruthy();
  done = saved();
  await row.getByRole("cell").nth(columns.indexOf("Rate")).getByRole("button").click();
  await page.locator("tbody tr input.table-edit-input").fill("28");
  await page.locator("tbody tr input.table-edit-input").press("Enter");
  expect((await done).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("row", { name: new RegExp(server.name.replace(/[()]/g, "\\$&")) })).toContainText("$28.00 / hr");
});

test("Technical sees Payroll and the Role column; a Sales Manager sees neither and gets no pay (AC1, AC2)", async ({ browser }) => {
  const tech = await asUser(browser, technical.id);
  await tech.page.goto("/#/staff");
  await expect(tech.page.getByRole("columnheader", { name: "Role" })).toBeVisible();
  await expect(tech.page.getByRole("link", { name: "Payroll", exact: true }).first()).toBeVisible();
  await tech.page.goto("/#/staffing/payroll");
  await expect(tech.page.getByRole("heading", { name: "Payroll", level: 1 })).toBeVisible();
  await tech.close();

  const manager = await asUser(browser, salesManager.id);
  const staffResponse = manager.page.waitForResponse((response) => response.url().endsWith("/api/staff") && response.request().method() === "GET");
  await manager.page.goto("/#/staff");
  expect(await (await staffResponse).text()).not.toMatch(/payType|payRate/);
  await expect(manager.page.getByRole("columnheader", { name: "Name" })).toBeVisible();
  await expect(manager.page.getByRole("columnheader", { name: "Role" })).toHaveCount(0);
  await expect(manager.page.getByLabel("Role", { exact: true })).toHaveCount(0);
  await expect(manager.page.getByRole("link", { name: "Payroll", exact: true })).toHaveCount(0);
  await manager.close();
});
