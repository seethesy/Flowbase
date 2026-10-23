import { test, expect } from "@playwright/test";
import { lead, mockLeadsApi } from "./mock-api";

const maya = () => lead({ name: "Maya Ortiz", source: "Bark" });
const noah = () =>
  lead({
    name: "Noah Kim",
    source: "Thumbtack",
    channel: "collector",
    eventDate: null,
    needsReview: true,
  });
const priya = () =>
  lead({
    name: "Priya Shah",
    source: "Referral",
    channel: "manual",
    status: "contacted",
    assignedSalespersonId: "a0000000-0000-4000-8000-000000000003",
  });
const dana = () =>
  lead({ name: "Dana Cole", source: "Bark", email: "", phone: "", needsReview: true });
const row = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("link", { name, exact: true });

test("inbox filters by source, channel and status, with a needs review view", async ({
  page,
}) => {
  await mockLeadsApi(page, [maya(), noah(), priya(), dana()]);
  await page.goto("/#/leads");
  await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
  for (const name of ["Maya Ortiz", "Noah Kim", "Priya Shah", "Dana Cole"])
    await expect(row(page, name)).toBeVisible();

  await page.getByLabel("Sources", { exact: true }).selectOption("Thumbtack");
  await expect(row(page, "Noah Kim")).toBeVisible();
  await expect(row(page, "Maya Ortiz")).toHaveCount(0);
  await page.getByLabel("Sources", { exact: true }).selectOption("");

  await page.getByLabel("Channels", { exact: true }).selectOption("Manual");
  await expect(row(page, "Priya Shah")).toBeVisible();
  await expect(row(page, "Noah Kim")).toHaveCount(0);
  await page.getByLabel("Channels", { exact: true }).selectOption("");

  await page.getByLabel("Statuses", { exact: true }).selectOption("Contacted");
  await expect(row(page, "Priya Shah")).toBeVisible();
  await expect(row(page, "Maya Ortiz")).toHaveCount(0);
  await page.getByLabel("Statuses", { exact: true }).selectOption("");

  await page.getByRole("tab", { name: "Needs review" }).click();
  await expect(row(page, "Noah Kim")).toBeVisible();
  await expect(row(page, "Dana Cole")).toBeVisible();
  await expect(row(page, "Maya Ortiz")).toHaveCount(0);
  await expect(row(page, "Priya Shah")).toHaveCount(0);
});

test("triage queue shows unassigned open leads and bulk assigns them", async ({
  page,
}) => {
  await mockLeadsApi(page, [maya(), noah(), priya()]);
  await page.goto("/#/leads");
  await page.getByRole("tab", { name: "Triage" }).click();
  await expect(row(page, "Maya Ortiz")).toBeVisible();
  await expect(row(page, "Noah Kim")).toBeVisible();
  await expect(row(page, "Priya Shah")).toHaveCount(0);

  await page.getByLabel("Select Maya Ortiz").check();
  await page.getByLabel("Select Noah Kim").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page
    .getByLabel("Assign selected to (user ID)")
    .fill("a0000000-0000-4000-8000-000000000004");
  await page.getByRole("button", { name: "Assign selected" }).click();
  await expect(row(page, "Maya Ortiz")).toHaveCount(0);
  await expect(row(page, "Noah Kim")).toHaveCount(0);
});

test("a lead moves through the statuses and a lost reason is required", async ({
  page,
}) => {
  await mockLeadsApi(page, [maya()]);
  await page.goto("/#/leads");
  await row(page, "Maya Ortiz").click();
  await expect(page.getByRole("heading", { name: "Maya Ortiz", level: 1 })).toBeVisible();
  await expect(page.getByText("Not yet")).toBeVisible();

  await page.getByRole("button", { name: "Mark contacted" }).click();
  await expect(page.getByText("Contacted", { exact: true })).toBeVisible();
  await expect(page.getByText("Not yet")).toHaveCount(0);
  await page.getByRole("button", { name: "Mark qualified" }).click();
  await expect(page.getByText("Qualified", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark lost" }).click();
  await page.getByRole("button", { name: "Confirm lost" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "A reason is required when marking a lead lost.",
  );
  await page.getByLabel("Lost reason *").fill("Booked another caterer");
  await page.getByRole("button", { name: "Confirm lost" }).click();
  await expect(page.getByText("Lost", { exact: true })).toBeVisible();
  await expect(page.getByText("Booked another caterer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark lost" })).toHaveCount(0);
});

test("a qualified lead converts from the inbox", async ({ page }) => {
  await mockLeadsApi(page, [
    lead({ name: "Maya Ortiz", status: "qualified", eventType: "Wedding" }),
  ]);
  await page.goto("/#/leads");
  await page.getByRole("button", { name: "Convert Maya Ortiz" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Client name *")).toHaveValue("Maya Ortiz");
  await expect(dialog.getByLabel("Event date *")).toHaveValue("2026-12-05");
  await dialog.getByRole("button", { name: "Convert lead" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a start time.");
  await dialog.getByLabel("Start time *").fill("18:00");
  await dialog.getByRole("button", { name: "Convert lead" }).click();
  await expect(page).toHaveURL(/#\/events\/[0-9a-f-]+$/);
});

test("possible duplicates are merged into one lead that keeps both source links", async ({
  page,
}) => {
  const bark = lead({ name: "Maya Ortiz", source: "Bark", sourceLeadId: "bark-77" });
  const thumbtack = lead({
    name: "Maya O.",
    source: "Thumbtack",
    sourceLeadId: "tt-88",
    email: bark.email,
  });
  await mockLeadsApi(
    page,
    [bark, thumbtack],
    [{ leadId: thumbtack.id, matchedLeadId: bark.id, reason: "email" }],
  );
  await page.goto("/#/leads");
  await page.getByRole("tab", { name: "Duplicates" }).click();
  const queue = page.getByRole("list", { name: "Possible duplicates" });
  await expect(queue.getByText("Same email")).toBeVisible();
  await expect(queue.getByRole("link", { name: "Maya O." })).toBeVisible();

  await queue.getByRole("link", { name: "Maya Ortiz" }).click();
  const section = page.locator("section", { hasText: "Possible duplicates" });
  await expect(section.getByRole("link", { name: "Maya O." })).toBeVisible();
  await section.getByRole("button", { name: "Merge into this lead" }).click();
  await expect(page.getByText("Possible duplicates")).toHaveCount(0);
  const links = page.getByRole("list", { name: "Source links" });
  await expect(links.getByText("bark-77")).toBeVisible();
  await expect(links.getByText("tt-88")).toBeVisible();
  await expect(links.getByText(/merged/)).toBeVisible();

  await page.goto("/#/leads");
  await expect(row(page, "Maya Ortiz")).toBeVisible();
  await expect(row(page, "Maya O.")).toHaveCount(0);
});
