import { choose } from "./dropdown";
import { test, expect } from "./auth-fixture";
import { seedUsers } from "../../worker/db/seed";
import { lead } from "./fixtures";
import { seedLeads } from "./database";

const maya = () => lead({ name: "Maya Ortiz", source: "Bark" });
const noah = () => lead({ name: "Noah Kim", source: "Thumbtack", channel: "collector", eventDate: null, needsReview: true });
const priya = () => lead({ name: "Priya Shah", source: "Referral", channel: "manual", status: "pitching", assignedSalespersonId: "a0000000-0000-4000-8000-000000000003" });
const leadRow = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
// FLOW-260/264: Ctrl/Cmd+click on a row (outside Status and links) selects it.
const ctrlSelect = (page: import("@playwright/test").Page, name: string) =>
  leadRow(page, name).getByRole("cell").nth(1).click({ modifiers: ["ControlOrMeta"] });

test("pipeline inbox filters by source, owner and status", async ({ page }) => {
  await seedLeads([maya(), noah(), priya()]);
  await page.goto("/#/leads");
  await expect(leadRow(page, "Maya Ortiz")).toBeVisible();
  await expect(leadRow(page, "Noah Kim")).toBeVisible();
  await choose(page.getByLabel("Sources", { exact: true }), "Thumbtack");
  await expect(leadRow(page, "Noah Kim")).toBeVisible();
  await expect(leadRow(page, "Maya Ortiz")).toHaveCount(0);
  await choose(page.getByLabel("Sources", { exact: true }), "");
  await choose(page.getByLabel("Owners", { exact: true }), "unassigned");
  await expect(leadRow(page, "Priya Shah")).toHaveCount(0);
  await choose(page.getByLabel("Owners", { exact: true }), "");
  await choose(page.getByLabel("Statuses", { exact: true }), "Pitching");
  await expect(leadRow(page, "Priya Shah")).toBeVisible();
  await expect(leadRow(page, "Maya Ortiz")).toHaveCount(0);
});

test("bulk assigns selected unassigned leads", async ({ page }) => {
  await seedLeads([maya(), noah(), priya()]);
  await page.goto("/#/leads");
  await choose(page.getByLabel("Owners", { exact: true }), "unassigned");
  await ctrlSelect(page, "Maya Ortiz");
  await ctrlSelect(page, "Noah Kim");
  await expect(page).toHaveURL(/#\/leads$/);
  await expect(page.getByText("2 selected")).toBeVisible();
  // Owners are active sales users (FLOW-250).
  const owner = seedUsers.find((user) => user.role === "salesperson")!;
  await choose(page.getByLabel("Assign selected to"), owner.id);
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect(leadRow(page, "Maya Ortiz")).toHaveCount(0);
  await expect(leadRow(page, "Noah Kim")).toHaveCount(0);
});

test("edits lead details and requires a lost reason", async ({ page }) => {
  // Each fixture call takes a new id, so keep the seeded one.
  const seeded = maya();
  await seedLeads([seeded]);
  await page.goto(`/#/leads/${seeded.id}`);
  await expect(page.getByRole("heading", { name: "Maya Ortiz", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Phone").first().fill("2025550199");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("2025550199")).toBeVisible();
  await page.getByRole("combobox", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Pitching" }).click();
  await expect(page.getByText("Pitching", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Booked another caterer"));
  await page.getByRole("combobox", { name: "Lead status" }).click();
  await page.getByRole("option", { name: "Lost" }).click();
  await expect(page.getByText("Booked another caterer")).toBeVisible();
});

test("Closing requires a start time when no event exists", async ({ page }) => {
  const target = lead({ name: "Maya Ortiz", status: "p_creation", eventType: "Wedding" });
  await seedLeads([target]);
  await page.goto(`/#/leads/${target.id}`);
  await page.getByRole("combobox", { name: "Lead status" }).click();
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
  // The client name links to the lead after the Open column was removed (FLOW-264).
  await page.getByRole("link", { name: "Maya Ortiz" }).click();
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

test("FLOW-264: a row click opens the lead, only Status edits in the table, and selecting doesn't navigate", async ({ page }) => {
  await seedLeads([maya(), noah(), priya()]);
  await page.goto("/#/leads");
  const table = page.locator("table.lead-pipeline-table");
  // AC1: no Open column.
  await expect(table.getByRole("columnheader", { name: "Open" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "BEO" })).toBeVisible();
  // AC2: Status is the only control in a row besides links.
  await expect(leadRow(page, "Maya Ortiz").getByRole("textbox")).toHaveCount(0);
  await expect(leadRow(page, "Maya Ortiz").getByRole("combobox")).toHaveCount(1);
  // The BEO cell shows — when there's none.
  await expect(leadRow(page, "Maya Ortiz").getByRole("cell").last()).toHaveText("—");

  // AC3: drag and Shift select instead of opening.
  const cell = (name: string) => leadRow(page, name).getByRole("cell").nth(1);
  await cell("Maya Ortiz").hover();
  await page.mouse.down();
  await cell("Noah Kim").hover();
  await page.mouse.up();
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page).toHaveURL(/#\/leads$/);
  await cell("Priya Shah").click({ modifiers: ["Shift"] });
  await expect(page).toHaveURL(/#\/leads$/);
  await page.getByRole("button", { name: "Clear" }).click();

  // Opening the Status dropdown doesn't open the lead.
  await leadRow(page, "Maya Ortiz").getByRole("combobox").click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/leads$/);

  // AC1: a plain click anywhere else on the row opens the lead.
  await cell("Maya Ortiz").click();
  await expect(page).toHaveURL(/#\/leads\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Maya Ortiz", level: 1 })).toBeVisible();
});
