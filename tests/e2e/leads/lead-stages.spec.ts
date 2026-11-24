import { choose, optionTexts } from "../dropdown";
import { test, expect, type Page } from "../auth-fixture";
import { lead } from "../fixtures";
import { seedLeads } from "../database";

// FLOW-328: Leads › Overview lists the early pipeline stages, Sales › Overview the
// late ones, and a lead moves between them when its status changes.
const leadRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

test("each heading's Overview lists its own stages, and a status change moves the lead (AC2, AC3)", async ({ page }) => {
  await seedLeads([
    lead({ name: "Iris Inquiry", status: "inquiry" }),
    lead({ name: "Sol Sent", status: "p_sent" }),
    lead({ name: "Lou Lost", status: "lost", lostReason: "Booked elsewhere" }),
    lead({ name: "Nia Negotiation", status: "negotiation" }),
    lead({ name: "Cal Closed", status: "closed" }),
  ]);

  await page.goto("/#/leads");
  await expect(leadRow(page, "Iris Inquiry")).toBeVisible();
  await expect(leadRow(page, "Sol Sent")).toBeVisible();
  // Lost leads wait behind the status filter (A2); late stages are under Sales.
  await expect(leadRow(page, "Lou Lost")).toHaveCount(0);
  await expect(leadRow(page, "Nia Negotiation")).toHaveCount(0);
  await expect(leadRow(page, "Cal Closed")).toHaveCount(0);
  await expect.poll(() => optionTexts(page.getByLabel("Statuses", { exact: true })))
    .toEqual(expect.arrayContaining(["Inquiry", "Pitching", "P Creation", "P Sent", "Lost"]));
  await expect.poll(() => optionTexts(page.getByLabel("Statuses", { exact: true })))
    .not.toEqual(expect.arrayContaining(["Negotiation"]));
  await page.keyboard.press("Escape");
  await choose(page.getByLabel("Statuses", { exact: true }), "Lost");
  await expect(leadRow(page, "Lou Lost")).toBeVisible();
  await expect(leadRow(page, "Iris Inquiry")).toHaveCount(0);
  await choose(page.getByLabel("Statuses", { exact: true }), "");

  await page.goto("/#/sales/overview");
  await expect(leadRow(page, "Nia Negotiation")).toBeVisible();
  await expect(leadRow(page, "Cal Closed")).toBeVisible();
  await expect(leadRow(page, "Sol Sent")).toHaveCount(0);
  await expect(leadRow(page, "Iris Inquiry")).toHaveCount(0);

  // P Sent → Negotiation moves Sol from Leads › Overview to Sales › Overview.
  await page.goto("/#/leads");
  const saved = page.waitForResponse((response) => response.url().includes("/status") && response.request().method() === "POST");
  await choose(page.getByRole("combobox", { name: "Status for Sol Sent" }), "Negotiation");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(leadRow(page, "Iris Inquiry")).toBeVisible();
  await expect(leadRow(page, "Sol Sent")).toHaveCount(0);
  await page.goto("/#/sales/overview");
  await expect(leadRow(page, "Sol Sent")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(/Workspace\s*\/\s*Sales\s*\/\s*Overview/);
});
