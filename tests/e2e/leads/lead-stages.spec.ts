import { choose, optionTexts } from "../dropdown";
import { test, expect, type Page } from "../auth-fixture";
import { lead } from "../fixtures";
import { seedLeads } from "../database";

// FLOW-328/351: Leads › Overview lists every lead whatever its status (Lost only
// through the status filter), Sales › Overview only the late stages.
const leadRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

test("Leads › Overview lists every stage but Lost, and Sales › Overview only the late ones (FLOW-351 AC2, AC3)", async ({ page }) => {
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
  await expect(leadRow(page, "Nia Negotiation")).toBeVisible();
  await expect(leadRow(page, "Cal Closed")).toBeVisible();
  // Lost leads wait behind the status filter (FLOW-351 A1).
  await expect(leadRow(page, "Lou Lost")).toHaveCount(0);
  await expect.poll(() => optionTexts(page.getByLabel("Statuses", { exact: true })))
    .toEqual(expect.arrayContaining(["Inquiry", "Pitching", "P Creation", "P Sent", "Negotiation", "Closing", "Closed", "Lost"]));
  await page.keyboard.press("Escape");
  await choose(page.getByLabel("Statuses", { exact: true }), "Lost");
  await expect(leadRow(page, "Lou Lost")).toBeVisible();
  await expect(leadRow(page, "Iris Inquiry")).toHaveCount(0);
  await choose(page.getByLabel("Statuses", { exact: true }), "Closed");
  await expect(leadRow(page, "Cal Closed")).toBeVisible();
  await expect(leadRow(page, "Nia Negotiation")).toHaveCount(0);
  await choose(page.getByLabel("Statuses", { exact: true }), "");

  await page.goto("/#/sales/overview");
  await expect(leadRow(page, "Nia Negotiation")).toBeVisible();
  await expect(leadRow(page, "Cal Closed")).toBeVisible();
  await expect(leadRow(page, "Sol Sent")).toHaveCount(0);
  await expect(leadRow(page, "Iris Inquiry")).toHaveCount(0);
  await expect(leadRow(page, "Lou Lost")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveText(/Workspace\s*\/\s*Sales\s*\/\s*Overview/);
});

test("a lead moved to Closing, then Closed, stays on Leads › Overview (FLOW-351 AC1)", async ({ page }) => {
  const target = lead({ name: "Cora Closing", status: "p_creation", eventType: "Wedding" });
  await seedLeads([target]);
  await page.goto(`/#/leads/${target.id}`);
  await page.getByRole("combobox", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Closing" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to Closing" });
  await dialog.getByLabel("Start time *").fill("18:00");
  await dialog.getByRole("button", { name: "Confirm Closing" }).click();
  await expect(page).toHaveURL(/#\/events\/[0-9a-f-]+$/);

  await page.goto("/#/leads");
  await expect(leadRow(page, "Cora Closing")).toBeVisible();

  await page.goto(`/#/leads/${target.id}`);
  const closed = page.waitForResponse((response) => response.url().includes("/status") && response.request().method() === "POST");
  await page.getByRole("combobox", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Closed" }).click();
  expect((await closed).ok()).toBeTruthy();

  await page.goto("/#/leads");
  await expect(leadRow(page, "Cora Closing")).toBeVisible();
});
