import { test, expect, databaseTest, mockBrowserAuth } from "./auth-fixture";
import { browserDb, seedRecords } from "./database";
import { fallGala, juniper } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";
import { createTask } from "../../worker/records/tasks";
import { taskInputSchema, type TaskInput } from "../../shared/tasks";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";

// Task lists, delegation, the dashboard and templates (FLOW-59/60/61/62) on the
// real Worker and database. seedUsers: each role full-time then part-time.

const admin = seedUsers[0];
const kitchenLead = seedUsers.find(
  (u) => u.role === "kitchen_lead" && u.employmentType === "full_time",
)!;
const fullTimeStaff = seedUsers.find(
  (u) => u.role === "staff" && u.employmentType === "full_time",
)!;
const partTimeStaff = seedUsers.find(
  (u) => u.role === "staff" && u.employmentType === "part_time",
)!;

const seedTasks = (inputs: TaskInput[]) =>
  browserDb(async (db) => {
    const ids: string[] = [];
    for (const input of inputs)
      ids.push(await createTask(db, null, taskInputSchema.parse(input)));
    return ids;
  });
const today = () => utcToBusinessTime(new Date()).date;
const inDays = (days: number, time = "12:00") =>
  businessTimeToUtc(addLocalDays(today(), days), time).toISOString();

test("adds, claims, completes and filters tasks, and saves a view (FLOW-59)", async ({
  page,
}) => {
  await seedTasks([
    { title: "Polish chafing dishes", type: "kitchen", overseerId: kitchenLead.id },
    { title: "Load truck 2", type: "truck_load", assigneeIds: [fullTimeStaff.id] },
  ]);
  await page.goto("/#/tasks/all");
  await expect(page.getByRole("heading", { name: "Team tasks" })).toBeVisible();
  const tasks = page.getByRole("list", { name: "Tasks" });
  await expect(tasks.getByRole("link")).toHaveText(["Load truck 2", "Polish chafing dishes"]);

  await page.getByRole("button", { name: "New task" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Title").fill("Call the florist");
  await form.getByLabel("Type").selectOption({ label: "General" });
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(form).toBeHidden();
  await expect(tasks.getByRole("link", { name: "Call the florist" })).toBeVisible();

  // Claim: the Admin is now on it, so Claim goes away.
  await page.getByRole("button", { name: "Claim Polish chafing dishes" }).click();
  await expect(page.getByRole("button", { name: "Claim Polish chafing dishes" })).toHaveCount(0);

  // Filters combine, and a saved view brings them back.
  await page.getByLabel("Type").selectOption({ label: "Kitchen" });
  await page.getByLabel("Assignee").selectOption(admin.id);
  await expect(tasks.getByRole("link")).toHaveText(["Polish chafing dishes"]);
  await page.getByLabel("View name").fill("My kitchen work");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByLabel("Saved view")).toHaveValue(/.+/);
  await page.getByLabel("Type").selectOption({ label: "All types" });
  await page.getByLabel("Assignee").selectOption({ label: "Anyone" });
  await expect(tasks.getByRole("link")).toHaveCount(3);
  await page.getByLabel("Saved view").selectOption({ label: "My kitchen work" });
  await expect(tasks.getByRole("link")).toHaveText(["Polish chafing dishes"]);

  // Complete: done tasks leave the open list.
  await page.getByRole("button", { name: "Complete Polish chafing dishes" }).click();
  await expect(page.getByText("No tasks match these filters.")).toBeVisible();
  await page.getByLabel("Status").selectOption({ label: "Done" });
  await expect(tasks.getByRole("link")).toHaveText(["Polish chafing dishes"]);
});

databaseTest("part-time staff see only their own tasks (FLOW-59 AC1)", async ({ page }) => {
  await mockBrowserAuth(page, { userId: partTimeStaff.id });
  await seedTasks([
    { title: "Fold napkins", assigneeIds: [partTimeStaff.id], dueAt: inDays(1) },
    { title: "Someone else's task", assigneeIds: [fullTimeStaff.id] },
  ]);
  await page.goto("/#/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team tasks" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Upcoming" })).toContainText("Fold napkins");
  await page.goto("/#/tasks/all");
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
  const tasks = page.getByRole("list", { name: "Tasks" });
  await expect(tasks.getByRole("link")).toHaveText(["Fold napkins"]);
});

test("delegates from Needs delegation, then reassigns on the task (FLOW-60/61)", async ({
  page,
}) => {
  const event = { ...fallGala(), date: addLocalDays(today(), 5) };
  await seedRecords({ clients: [juniper()], events: [event] });
  await seedTasks([
    { title: "Build the bar", type: "production", eventId: event.id },
    { title: "Late task", assigneeIds: [admin.id], dueAt: inDays(-1) },
  ]);
  await page.goto("/#/tasks");
  await expect(page.getByRole("region", { name: "Overdue" })).toContainText("Overdue (1)");
  const needs = page.getByRole("region", { name: "Unassigned in the next 14 days" });
  await expect(needs).toContainText("Build the bar");
  await needs.getByLabel("Assign Build the bar to").selectOption(fullTimeStaff.id);
  await needs.getByRole("button", { name: "Assign" }).click();
  await expect(needs).toContainText("Every task coming up has someone on it.");
  // The Admin assigned it, so the Admin oversees it (AC1).
  const overseeing = page.getByRole("region", { name: "Tasks I oversee" });
  await expect(overseeing).toContainText("Build the bar");
  await expect(overseeing).toContainText(fullTimeStaff.name);

  // The count links to the same list (FLOW-61 AC2).
  await page.getByRole("region", { name: "Overdue" }).getByRole("link", { name: "View all" }).click();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("link")).toHaveText(["Late task"]);

  await page.goto("/#/tasks");
  await overseeing.getByRole("link", { name: "Build the bar" }).click();
  const reassign = page.getByRole("form", { name: "Reassign" });
  await reassign.getByLabel("Assigned to").selectOption([kitchenLead.id]);
  await reassign.getByRole("button", { name: "Save assignment" }).click();
  await expect(page.locator("dd").filter({ hasText: kitchenLead.name })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: fullTimeStaff.name })).toHaveCount(0);
});

test("builds a task template and applies it to an event once (FLOW-62)", async ({ page }) => {
  const event = { ...fallGala(), date: "2026-09-17", startTime: "18:00" };
  await seedRecords({ clients: [juniper()], events: [event] });
  await page.goto("/#/tasks/templates");
  await page.getByRole("button", { name: "New template" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Template name").fill("Balloon arch (Large)");
  const first = editor.getByRole("listitem", { name: "Task 1" });
  await first.getByLabel("Task", { exact: true }).fill("Order balloons");
  await first.getByLabel("Days", { exact: true }).fill("14");
  await editor.getByRole("button", { name: "Add another task" }).click();
  const second = editor.getByRole("listitem", { name: "Task 2" });
  await second.getByLabel("Task", { exact: true }).fill("Inflate and build the frame");
  await second.getByLabel("Time").fill("16:00");
  await expect(second).toContainText("Day before 4:00 PM");
  await editor.getByRole("button", { name: "Save template" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("heading", { name: "Balloon arch (Large)" })).toBeVisible();
  await expect(page.getByText("T-14 days · Production")).toBeVisible();

  await page.goto(`/#/events/${event.id}`);
  await page.getByLabel("Task template").selectOption({ label: "Balloon arch (Large)" });
  await page.getByRole("button", { name: "Apply template" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 2 tasks." })).toBeVisible();
  const tasks = page.getByRole("list", { name: "Event tasks" });
  await expect(tasks.getByRole("listitem").filter({ hasText: "Order balloons" })).toContainText(
    "Due 2026-09-03 18:00",
  );
  await expect(
    tasks.getByRole("listitem").filter({ hasText: "Inflate and build the frame" }),
  ).toContainText("Due 2026-09-16 16:00");
  await page.getByRole("button", { name: "Apply template" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added 0 tasks; 2 already on this event." }),
  ).toBeVisible();
  await expect(tasks.getByRole("listitem")).toHaveCount(2);
});
