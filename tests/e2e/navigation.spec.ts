import { test, expect, databaseTest, mockBrowserAuth } from "./auth-fixture";
import type { Page } from "@playwright/test";
import { seedUsers } from "../../worker/db/seed";

// FLOW-246 (sidebar headings, tabs, collapse edge) and FLOW-247 (breadcrumb,
// header cleanup, profile menu). seedUsers: each role full-time then part-time.
const salesperson = seedUsers.find((u) => u.role === "salesperson")!;
const partTimeStaff = seedUsers.find((u) => u.role === "part_time_staff")!;

const allHeadings = ["Dashboard", "Sales", "Events", "Staffing", "Inventory", "Kitchen", "Marketing", "Documents", "Reports"];
async function headings(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  return page.getByRole("navigation", { name: "Main" }).getByRole("link").allTextContents();
}
const tabs = (page: Page, heading: string) =>
  page.getByRole("navigation", { name: `${heading} pages` }).getByRole("link");

test("admin sees every heading and tab, and tabs deep-link", async ({ page, isMobile }) => {
  await page.goto("/#/reports/operations");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(/Workspace\s*\/\s*Reports\s*\/\s*Operational reports/);
  await expect(tabs(page, "Reports")).toHaveText(["Time tracking", "Operational reports"]);
  await expect(tabs(page, "Reports").filter({ hasText: "Operational reports" })).toHaveAttribute("aria-current", "page");
  expect(await headings(page, isMobile)).toEqual(allHeadings);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Help & resources", exact: true })).toBeVisible();
});

test("a heading opens its first tab; placeholders say Coming soon", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Staffing", exact: true }).click();
  await expect(page).toHaveURL(/#\/staffing\/schedule$/);
  await expect(page.getByRole("heading", { name: "Coming soon" })).toBeVisible();
  await expect(tabs(page, "Staffing")).toHaveText(["Schedule", "Staff directory", "SOPs"]);
  await page.goto("/#/marketing");
  await expect(page.getByRole("heading", { name: "Coming soon" })).toBeVisible();
  // Documents is a live library since FLOW-263, no longer a placeholder.
  await page.goto("/#/documents");
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
});

databaseTest("a salesperson sees Sales but not operational reports", async ({ page, isMobile }) => {
  await mockBrowserAuth(page, { userId: salesperson.id });
  await page.goto("/#/leads");
  await expect(tabs(page, "Sales")).toHaveText(["Leads", "Clients", "Proposals", "Sales tracker", "Venues"]);
  expect(await headings(page, isMobile)).toEqual(allHeadings);
  await page.goto("/#/reports");
  await expect(page.getByRole("navigation", { name: "Reports pages" })).toHaveCount(0);
});

databaseTest("part-time staff only see the tabs they can open", async ({ page, isMobile }) => {
  await mockBrowserAuth(page, { userId: partTimeStaff.id });
  await page.goto("/#/venues");
  await expect(page.getByRole("heading", { name: "Venues", exact: true })).toBeVisible();
  // Venues is the only Sales tab left, so there is no tab row.
  await expect(page.getByRole("navigation", { name: "Sales pages" })).toHaveCount(0);
  await page.goto("/#/inventory");
  await expect(tabs(page, "Inventory")).toHaveText(["Inventory", "Purchasing", "Vendors"]);
  expect(await headings(page, isMobile)).toEqual(allHeadings);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sales", exact: true })).toHaveAttribute("href", "#/venues");
});

test("the right edge collapses and expands the sidebar, and it is remembered", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones open the sidebar as a drawer instead.");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).not.toHaveClass(/collapsed/);
  const box = (await sidebar.boundingBox())!;
  // Hovering the right eighth shows the bar.
  await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
  const edge = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(edge.locator(".sidebar-edge-bar")).toHaveCSS("opacity", "1");
  await edge.click();
  await expect(sidebar).toHaveClass(/collapsed/);
  await page.reload();
  await expect(page.locator("aside.sidebar")).toHaveClass(/collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator("aside.sidebar")).not.toHaveClass(/collapsed/);
});

test("breadcrumb segments link back up the path", async ({ page, isMobile }) => {
  await page.goto("/#/approvals");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  // Phones hide the Workspace segment to save room.
  await expect(crumbs.getByRole("link")).toHaveText(isMobile ? ["Dashboard"] : ["Workspace", "Dashboard"]);
  await crumbs.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator("header .global-search-trigger kbd")).toHaveCount(0);
  await expect(page.locator("header").getByText("DEMO", { exact: true })).toHaveCount(0);
});

test("the profile menu closes on an outside click, Escape and navigation", async ({ page }) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Open profile menu" });
  const item = page.getByRole("link", { name: "Employee profile" });
  await menuButton.click();
  await expect(item).toBeVisible();
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(item).toHaveCount(0);
  await menuButton.click();
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);
  await menuButton.click();
  await page.evaluate(() => (window.location.hash = "#/settings"));
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(item).toHaveCount(0);
});
