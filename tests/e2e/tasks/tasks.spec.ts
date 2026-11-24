import { choose } from "../dropdown";
import { test, expect, databaseTest, mockBrowserAuth } from "../auth-fixture";
import { browserDb, seedRecords } from "../database";
import { fallGala, juniper } from "../fixtures";
import { seedUsers } from "../../../worker/db/seed";
import { createTask } from "../../../worker/records/tasks/tasks";
import { taskInputSchema, type TaskInput } from "../../../shared/tasks";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";

// Task lists, delegation, the dashboard and templates (FLOW-59/60/61/62) on the
// real Worker and database. seedUsers: each role full-time then part-time.

const admin = seedUsers[0];
const kitchenLead = seedUsers.find(
  (u) => u.role === "kitchen_lead",
)!;
const fullTimeStaff = seedUsers.find(
  (u) => u.role === "staff",
)!;
const partTimeStaff = seedUsers.find(
  (u) => u.role === "part_time_staff",
)!;

const seedTasks = (inputs: TaskInput[]) =>
  browserDb(async (db) => {
    const ids: string[] = [];
    for (const input of inputs)
      ids.push(await createTask(db, null, taskInputSchema.parse("managerIds" in input || "overseerId" in input ? input : { ...input, managerIds: [] })));
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
  await choose(form.getByLabel("Type"), { label: "General" });
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(form).toBeHidden();
  await expect(tasks.getByRole("link", { name: "Call the florist" })).toBeVisible();

  // Pick up: the Admin is now on it, so Pick up goes away.
  await page.getByRole("button", { name: "Pick up Polish chafing dishes" }).click();
  await expect(page.getByRole("button", { name: "Pick up Polish chafing dishes" })).toHaveCount(0);

  // Filters combine, and a saved view brings them back.
  await choose(page.getByLabel("Type"), { label: "Kitchen" });
  await choose(page.getByLabel("Assignee"), admin.id);
  await expect(tasks.getByRole("link")).toHaveText(["Polish chafing dishes"]);
  await page.getByLabel("View name").fill("My kitchen work");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByLabel("Saved view")).toHaveAttribute("data-value", /.+/);
  await choose(page.getByLabel("Type"), { label: "All types" });
  await choose(page.getByLabel("Assignee"), { label: "Anyone" });
  await expect(tasks.getByRole("link")).toHaveCount(3);
  await choose(page.getByLabel("Saved view"), { label: "My kitchen work" });
  await expect(tasks.getByRole("link")).toHaveText(["Polish chafing dishes"]);

  // Complete: done tasks leave the open list.
  await page.getByRole("button", { name: "Complete Polish chafing dishes" }).click();
  await expect(page.getByText("No tasks match these filters.")).toBeVisible();
  await choose(page.getByLabel("Status"), { label: "Done" });
  await expect(tasks.getByRole("link")).toHaveText(["Polish chafing dishes"]);
});

test("FLOW-324: new tasks prefill Admins, then use the saved named managers", async ({ page }) => {
  const admins = seedUsers.filter((user) => user.role === "admin");
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "New task" }).click();
  const drawer = page.getByRole("dialog");
  const managers = drawer.getByLabel("Managers");
  await expect.poll(async () => (await managers.getAttribute("data-value"))?.split(",").sort())
    .toEqual(admins.map((user) => user.id).sort());
  await drawer.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/#/settings");
  await choose(page.getByLabel("Default task managers"), { label: "Specific people" });
  const named = [seedUsers.find((user) => user.role === "kitchen_lead")!, seedUsers.find((user) => user.role === "sales_manager")!];
  await choose(page.getByLabel("Specific task managers"), named.map((user) => user.id));
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Defaults saved." })).toBeVisible();

  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "New task" }).click();
  await expect.poll(async () => (await page.getByRole("dialog").getByLabel("Managers").getAttribute("data-value"))?.split(",").sort())
    .toEqual(named.map((user) => user.id).sort());
});

databaseTest("part-time staff see their own and unassigned tasks, and pick one up (FLOW-59 AC1, FLOW-272)", async ({ page }) => {
  await mockBrowserAuth(page, { userId: partTimeStaff.id });
  await seedTasks([
    { title: "Fold napkins", assigneeIds: [partTimeStaff.id], dueAt: inDays(1) },
    { title: "Someone else's task", assigneeIds: [fullTimeStaff.id] },
    { title: "Sweep the loading dock" },
  ]);
  await page.goto("/#/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team tasks" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Upcoming" })).toContainText("Fold napkins");
  await page.getByRole("link", { name: "All tasks" }).click();
  await expect(page.getByRole("heading", { name: "All tasks" })).toBeVisible();
  const tasks = page.getByRole("list", { name: "Tasks" });
  await expect(tasks.getByRole("link")).toHaveText(["Sweep the loading dock", "Fold napkins"]);
  // Nothing on someone else's task offers a way to take it.
  await expect(page.getByRole("button", { name: /^(Pick up|Claim) Someone else's task/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Claim Fold napkins" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pick up Sweep the loading dock" }).click();
  await expect(page.getByRole("button", { name: "Pick up Sweep the loading dock" })).toHaveCount(0);
  await page.goto("/#/tasks");
  await expect(page.getByRole("region", { name: "Upcoming" })).toContainText("Sweep the loading dock");
});

databaseTest("a Sales Manager can take a task someone else holds (FLOW-272 AC2)", async ({ page }) => {
  const manager = seedUsers.find((u) => u.role === "sales_manager")!;
  await mockBrowserAuth(page, { userId: manager.id });
  const [taskId] = await seedTasks([{ title: "Hold the door", assigneeIds: [fullTimeStaff.id] }]);
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "Claim Hold the door" }).click();
  await expect(page.getByRole("button", { name: "Claim Hold the door" })).toHaveCount(0);
  await page.goto(`/#/tasks/${taskId}`);
  await expect(page.locator("dd").filter({ hasText: manager.name })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: fullTimeStaff.name })).toHaveCount(0);
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
  await choose(needs.getByLabel("Assign Build the bar to"), fullTimeStaff.id);
  await needs.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(needs).toContainText("Every task coming up has someone on it.");
  // The Admin assigned it, so the Admin oversees it (AC1).
  const overseeing = page.getByRole("region", { name: "Tasks I manage" });
  await expect(overseeing).toContainText("Build the bar");
  await expect(overseeing).toContainText(fullTimeStaff.name);

  // The count links to the same list (FLOW-61 AC2).
  await page.getByRole("region", { name: "Overdue" }).getByRole("link", { name: "View all" }).click();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("link")).toHaveText(["Late task"]);

  await page.goto("/#/tasks");
  await overseeing.getByRole("link", { name: "Build the bar" }).click();
  const reassign = page.getByRole("form", { name: "Reassign" });
  await choose(reassign.getByLabel("Assigned to"), [kitchenLead.id]);
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
  await choose(page.getByLabel("Task template"), { label: "Balloon arch (Large)" });
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
