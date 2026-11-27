import { choose } from "../dropdown";
import { test, expect } from "../auth-fixture";
import { browserDb, seedLeads, seedRecords } from "../database";
import { fallGala, juniper, lead } from "../fixtures";
import { seedUsers } from "../../../worker/db/seed";
import { createTask } from "../../../worker/records/tasks/tasks";
import { taskInputSchema, type TaskInput } from "../../../shared/tasks";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { calendarWhenParts } from "../../../src/features/events/calendar-entries";

// FLOW-296 and FLOW-297 on the real Worker and database: a dropdown in a table
// row changes its value without opening the record, a click elsewhere on the
// row still opens it, an Admin resizes columns on tables registered by this
// ticket, and a date with a time shows (and edits) as one cell.

const admin = seedUsers[0];
const seedTasks = (inputs: TaskInput[]) =>
  browserDb(async (db) => {
    const ids: string[] = [];
    for (const input of inputs) ids.push(await createTask(db, null, taskInputSchema.parse(input)));
    return ids;
  });
const today = () => utcToBusinessTime(new Date()).date;

test("choosing a Leads status keeps the table open; a click on the row opens the lead (FLOW-296 AC3)", async ({ page }) => {
  const maya = lead({ name: "Maya Ortiz", phone: "202-555-0177" });
  await seedLeads([maya]);
  await page.goto("/#/leads");
  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/leads/${maya.id}/status`) && response.request().method() === "POST");
  await choose(page.getByRole("combobox", { name: "Status for Maya Ortiz" }), "Pitching");
  expect((await saved).ok()).toBeTruthy();
  await expect(page).toHaveURL(/#\/leads$/);
  await expect(page.getByRole("combobox", { name: "Status for Maya Ortiz" })).toHaveAttribute("data-value", "pitching");

  await page.getByRole("row", { name: /Maya Ortiz/ }).getByRole("cell", { name: "202-555-0177" }).click();
  await expect(page).toHaveURL(new RegExp(`#/leads/${maya.id}$`));
});

test("My Dashboard tasks are a table: status changes in place, the row opens the task (FLOW-297, FLOW-296 AC3)", async ({ page }) => {
  const due = businessTimeToUtc(addLocalDays(today(), 3), "14:30").toISOString();
  const [taskId] = await seedTasks([{ title: "Fold napkins", assigneeIds: [admin.id], dueAt: due }]);
  await page.goto("/#/tasks");
  // My Tasks is one task table (FLOW-345).
  const mine = page.getByRole("region", { name: "My Tasks" });
  const row = mine.getByRole("row", { name: /Fold napkins/ });
  await expect(mine.getByRole("columnheader", { name: "Due" })).toBeVisible();
  const headers = (await mine.locator("thead th").allTextContents()).map((text) => text.replace(/[↑↓]/g, "").trim());
  const assignee = (r: typeof row) => r.getByRole("cell").nth(headers.indexOf("Assignee"));
  await expect(assignee(row)).not.toHaveText("Unassigned");
  // The due date with its time beneath it (FLOW-296 AC2).
  await expect(row.locator(".date-time-cell__time")).toHaveText("14:30");

  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/tasks/${taskId}`) && response.request().method() === "PATCH");
  await row.getByRole("button", { name: "To do" }).click();
  await page.getByRole("listbox").last().getByRole("option", { name: "In progress", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page).toHaveURL(/#\/tasks$/);

  await mine.getByRole("row", { name: /Fold napkins/ }).getByRole("cell").nth(headers.indexOf("Type")).click();
  await expect(page).toHaveURL(new RegExp(`#/tasks/${taskId}$`));
});

test("the events table shows the date with the start time beneath, and edits both (FLOW-296 AC2)", async ({ page }) => {
  const event = { ...fallGala(), date: today(), startTime: "18:00" };
  await seedRecords({ clients: [juniper()], events: [event] });
  // The events table on Events › Overview (FLOW-349 retired the /events list).
  await page.goto("/#/events/overview");
  const row = page.getByRole("row", { name: /Fall gala/ });
  await expect(page.getByRole("columnheader", { name: "Start" })).toHaveCount(0);
  await expect(row.locator(".date-time-cell__date")).toHaveText(calendarWhenParts({ start: `${today()}T18:00` }).date);
  await expect(row.locator(".date-time-cell__time")).toHaveText("6:00 PM");

  const next = addLocalDays(today(), 1);
  await row.locator(".table-edit-trigger").filter({ has: page.locator(".date-time-cell") }).click();
  await row.getByLabel("Date", { exact: true }).fill(next);
  await row.getByLabel("Time", { exact: true }).fill("19:30");
  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/events/${event.id}`) && response.request().method() === "PUT");
  await row.getByLabel("Time", { exact: true }).press("Enter");
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  const after = page.getByRole("row", { name: /Fall gala/ });
  await expect(after.locator(".date-time-cell__date")).toHaveText(calendarWhenParts({ start: `${next}T19:30` }).date);
  await expect(after.locator(".date-time-cell__time")).toHaveText("7:30 PM");
});

test("an Admin resizes columns on SOPs and My Dashboard tasks, for everyone (FLOW-296 AC1)", async ({ page }) => {
  await seedTasks([{ title: "Fold napkins", assigneeIds: [admin.id], dueAt: businessTimeToUtc(addLocalDays(today(), 3), "12:00").toISOString() }]);
  await page.goto("/#/sops/new");
  await page.getByLabel("Title").fill("Truck loading procedure");
  await page.getByLabel("Category").fill("Production");
  await page.getByRole("textbox", { name: "SOP content" }).fill("Verify every crate against the manifest.");
  await page.getByRole("button", { name: "Save SOP" }).click();
  await expect(page.getByRole("heading", { name: "Truck loading procedure" })).toBeVisible();
  for (const [path, column] of [["/#/tasks", "Due"], ["/#/sops", "Title"]] as const) {
    await page.goto(path);
    await page.getByRole("button", { name: "Edit screen text" }).click();
    const handle = page.getByRole("separator", { name: `Resize ${column}` }).first();
    await handle.focus();
    for (let i = 0; i < 5; i += 1) await handle.press("ArrowRight");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit screen text" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("columnheader", { name: column }).first()).toHaveAttribute("style", /width: \d+px/);
    await expect(page.getByRole("separator", { name: `Resize ${column}` })).toHaveCount(0);
  }
});
