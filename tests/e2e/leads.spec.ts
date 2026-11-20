import { test, expect } from "./auth-fixture";
import { lead } from "./fixtures";
import { seedLeads } from "./database";

const maya = () => lead({ name: "Maya Ortiz", source: "Bark" });
const noah = () => lead({ name: "Noah Kim", source: "Thumbtack", channel: "collector", eventDate: null, needsReview: true });
const priya = () => lead({ name: "Priya Shah", source: "Referral", channel: "manual", status: "pitching", assignedSalespersonId: "a0000000-0000-4000-8000-000000000003" });
const leadRow = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) });

test("pipeline inbox filters by source, owner and status", async ({ page }) => {
  await seedLeads([maya(), noah(), priya()]);
  await page.goto("/#/leads");
  await expect(leadRow(page, "Maya Ortiz")).toBeVisible();
  await expect(leadRow(page, "Noah Kim")).toBeVisible();
  await page.getByLabel("Sources", { exact: true }).selectOption("Thumbtack");
  await expect(leadRow(page, "Noah Kim")).toBeVisible();
  await expect(leadRow(page, "Maya Ortiz")).toHaveCount(0);
  await page.getByLabel("Sources", { exact: true }).selectOption("");
  await page.getByLabel("Owners", { exact: true }).selectOption("unassigned");
  await expect(leadRow(page, "Priya Shah")).toHaveCount(0);
  await page.getByLabel("Owners", { exact: true }).selectOption("");
  await page.getByLabel("Statuses", { exact: true }).selectOption("Pitching");
  await expect(leadRow(page, "Priya Shah")).toBeVisible();
  await expect(leadRow(page, "Maya Ortiz")).toHaveCount(0);
});

test("bulk assigns selected unassigned leads", async ({ page }) => {
  await seedLeads([maya(), noah(), priya()]);
  await page.goto("/#/leads");
  await page.getByLabel("Owners", { exact: true }).selectOption("unassigned");
  await page.getByLabel("Select Maya Ortiz").check();
  await page.getByLabel("Select Noah Kim").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByLabel("Assign selected to").selectOption("a0000000-0000-4000-8000-000000000004");
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect(leadRow(page, "Maya Ortiz")).toHaveCount(0);
  await expect(leadRow(page, "Noah Kim")).toHaveCount(0);
});

test("edits lead details and requires a lost reason", async ({ page }) => {
  await seedLeads([maya()]);
  await page.goto(`/#/leads/${maya().id}`);
  await expect(page.getByRole("heading", { name: "Maya Ortiz", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Phone").first().fill("2025550199");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("2025550199")).toBeVisible();
  await page.getByRole("button", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Pitching" }).click();
  await expect(page.getByText("Pitching", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Booked another caterer"));
  await page.getByRole("button", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Lost" }).click();
  await expect(page.getByText("Booked another caterer")).toBeVisible();
});

test("Closing requires a start time when no event exists", async ({ page }) => {
  const target = lead({ name: "Maya Ortiz", status: "p_creation", eventType: "Wedding" });
  await seedLeads([target]);
  await page.goto(`/#/leads/${target.id}`);
  await page.getByRole("button", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Closing" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to Closing" });
  await dialog.getByRole("button", { name: "Confirm Closing" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a start time.");
  await dialog.getByLabel("Start time *").fill("18:00");
  await dialog.getByRole("button", { name: "Confirm Closing" }).click();
  await expect(page).toHaveURL(/#\/events\/[0-9a-f-]+$/);
});

test("possible duplicates can be merged from lead detail", async ({ page }) => {
  const bark = lead({ name: "Maya Ortiz", source: "Bark", sourceLeadId: "bark-77" });
  const thumbtack = lead({ name: "Maya O.", source: "Thumbtack", sourceLeadId: "tt-88", email: bark.email });
  await seedLeads([bark, thumbtack], [{ leadId: thumbtack.id, matchedLeadId: bark.id, reason: "email" }]);
  await page.goto(`/#/leads/${bark.id}`);
  const section = page.locator("section", { hasText: "Possible duplicates" });
  await expect(section.getByRole("link", { name: "Maya O." })).toBeVisible();
  await section.getByRole("button", { name: "Merge into this lead" }).click();
  await expect(page.getByText("Possible duplicates")).toHaveCount(0);
  const links = page.getByRole("list", { name: "Source links" });
  await expect(links.getByText("bark-77")).toBeVisible();
  await expect(links.getByText("tt-88")).toBeVisible();
});

test("logging a call with a follow-up shows it in the lead's log and creates a task (FLOW-120)", async ({
  page,
}) => {
  await seedLeads([maya()]);
  await page.goto("/#/leads");
  await leadRow(page, "Maya Ortiz").click();
  await expect(
    page.getByRole("heading", { name: "Maya Ortiz", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Nothing logged yet.")).toBeVisible();

  await page.getByRole("button", { name: "Log conversation" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a summary.");
  await page.getByLabel("Summary *").fill("Wants a tasting before booking.");
  await page.getByLabel("Next follow-up").fill("2030-06-14");
  await page.getByRole("button", { name: "Log conversation" }).click();

  const entry = page.locator(".communication-log li");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Call");
  await expect(entry).toContainText("Wants a tasting before booking.");
  await expect(entry).toContainText("Follow-up Jun 14, 2030 · open");
  await entry.getByRole("link", { name: "View task" }).click();
  await expect(
    page.getByRole("heading", { name: "Follow up: Maya Ortiz", level: 1 }),
  ).toBeVisible();
});
