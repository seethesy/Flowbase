import { choose } from "../dropdown";
import { test, expect, databaseTest, mockBrowserAuth } from "../auth-fixture";
import { browserDb, seedRecords } from "../database";
import { fallGala, juniper } from "../fixtures";
import { seedUsers } from "../../../worker/db/seed";
import { users } from "../../../worker/db/schema";
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

test("FLOW-343: All Tasks filters by several roles and remembers them on reload", async ({ page }) => {
  await seedTasks([
    { title: "Admin task", assigneeIds: [admin.id] },
    { title: "Kitchen task", assigneeIds: [kitchenLead.id] },
    { title: "Staff task", assigneeIds: [fullTimeStaff.id] },
  ]);
  await page.goto("/#/");
  const card = page.locator(".dashboard-card--all-tasks");
  const filter = card.getByRole("combobox", { name: "Filter All Tasks by role" });
  await filter.click();
  await page.getByRole("searchbox", { name: "Search options" }).fill("kitchen");
  await page.getByRole("option", { name: "Kitchen Lead" }).click();
  await page.getByRole("searchbox", { name: "Search options" }).fill("staff");
  await page.getByRole("option", { name: "Staff", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("link", { name: "Kitchen task" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Staff task" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Admin task" })).toHaveCount(0);
  await expect(page).toHaveURL(/role=kitchen_lead%2Cstaff/);
  await page.reload();
  await expect(filter).toHaveAttribute("data-value", "kitchen_lead,staff");
});

test("adds, claims, completes and filters tasks, and saves a view (FLOW-59)", async ({
  page,
}) => {
  await seedTasks([
    { title: "Polish chafing dishes", type: "kitchen", overseerId: kitchenLead.id },
    { title: "Load truck 2", type: "truck_load", assigneeIds: [fullTimeStaff.id] },
  ]);
  await page.goto("/#/tasks/all");
  await expect(page.getByRole("heading", { name: "Team tasks" })).toBeVisible();
  // The task table (FLOW-345): one title link per row.
  const tasks = page.getByRole("region", { name: "Tasks" });
  await expect(tasks.locator("a.task-title")).toHaveText(["Load truck 2", "Polish chafing dishes"]);

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
  await expect(tasks.locator("a.task-title")).toHaveText(["Polish chafing dishes"]);
  await page.getByLabel("View name").fill("My kitchen work");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByLabel("Saved view")).toHaveAttribute("data-value", /.+/);
  await choose(page.getByLabel("Type"), { label: "All types" });
  await choose(page.getByLabel("Assignee"), { label: "Anyone" });
  await expect(tasks.locator("a.task-title")).toHaveCount(3);
  await choose(page.getByLabel("Saved view"), { label: "My kitchen work" });
  await expect(tasks.locator("a.task-title")).toHaveText(["Polish chafing dishes"]);

  // The check circle marks it done (FLOW-345): done tasks leave the open list.
  await page.getByRole("checkbox", { name: "Done: Polish chafing dishes" }).check();
  await expect(page.getByText("No tasks match these filters.")).toBeVisible();
  await choose(page.getByLabel("Status"), { label: "Done" });
  await expect(tasks.locator("a.task-title")).toHaveText(["Polish chafing dishes"]);
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
  const named = admins.slice(0, 2);
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
  await expect(page.getByRole("region", { name: "My Tasks" })).toContainText("Fold napkins");
  await page.getByRole("link", { name: "All tasks" }).first().click();
  await expect(page.getByRole("heading", { name: "All tasks" })).toBeVisible();
  const tasks = page.getByRole("region", { name: "Tasks" });
  await expect(tasks.locator("a.task-title")).toHaveText(["Sweep the loading dock", "Fold napkins"]);
  // Nothing on someone else's task offers a way to take it; their own offers Drop.
  await expect(page.getByRole("button", { name: /^Pick up Someone else's task/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick up Fold napkins" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Drop Fold napkins" })).toBeVisible();
  await page.getByRole("button", { name: "Pick up Sweep the loading dock" }).click();
  await expect(page.getByRole("button", { name: "Pick up Sweep the loading dock" })).toHaveCount(0);
  await page.goto("/#/tasks");
  await expect(page.getByRole("region", { name: "My Tasks" })).toContainText("Sweep the loading dock");
});

databaseTest("a Sales Manager can join a task someone else holds (FLOW-344 AC2)", async ({ page }) => {
  const manager = seedUsers.find((u) => u.role === "sales_manager")!;
  await mockBrowserAuth(page, { userId: manager.id });
  const [taskId] = await seedTasks([{ title: "Hold the door", assigneeIds: [fullTimeStaff.id] }]);
  await page.goto("/#/tasks/all");
  await page.getByRole("button", { name: "Pick up Hold the door" }).click();
  await expect(page.getByRole("button", { name: "Drop Hold the door" })).toBeVisible();
  await page.goto(`/#/tasks/${taskId}`);
  await expect(page.locator("dd").filter({ hasText: manager.name })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: fullTimeStaff.name })).toBeVisible();
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
  // My Tasks is one table (FLOW-345): the overdue task's row is pastel red.
  const mine = page.getByRole("region", { name: "My Tasks" });
  await expect(mine.getByRole("row", { name: /Late task/ })).toHaveClass(/task-row--overdue/);
  const needs = page.getByRole("region", { name: "Needs Delegation" });
  await expect(needs).toContainText("Build the bar");
  await choose(needs.getByLabel("Assign Build the bar to"), fullTimeStaff.id);
  await needs.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(needs).toContainText("Every task coming up has someone on it.");
  // The Admin assigned it, so the Admin oversees it (AC1).
  const overseeing = page.getByRole("region", { name: "Managing" });
  await expect(overseeing).toContainText("Build the bar");
  await expect(overseeing).toContainText(fullTimeStaff.name);

  // View all opens the list of the same tasks (FLOW-61 AC2).
  await mine.getByRole("link", { name: "View all" }).click();
  await expect(page.getByRole("region", { name: "Tasks" }).locator("a.task-title")).toHaveText(["Late task"]);

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

// FLOW-345 on the Tasks subtab's tables: the check circle, row colors, Pick up /
// Drop, Delete with Undo, and the searchable assignee multi-select.
test("task tables: done turns the row green, Pick up becomes Drop, Delete has Undo (FLOW-345 AC2–AC5)", async ({ page }) => {
  await seedTasks([
    { title: "Today task", assigneeIds: [admin.id], dueAt: businessTimeToUtc(today(), "23:30").toISOString() },
    { title: "Open task", assigneeIds: [fullTimeStaff.id], dueAt: inDays(3) },
  ]);
  await page.goto("/#/tasks");
  const all = page.getByRole("region", { name: "All Tasks" });
  await expect(all.getByRole("row", { name: /Today task/ })).toHaveClass(/task-row--today/);

  // AC2: done → green, struck through, still listed.
  await all.getByRole("checkbox", { name: "Done: Today task" }).check();
  const done = all.getByRole("row", { name: /Today task/ });
  await expect(done).toHaveClass(/task-row--done/);
  await expect(done.locator("a.task-title")).toHaveCSS("text-decoration-line", "line-through");
  // Un-done brings it back to To do.
  await all.getByRole("checkbox", { name: "Done: Today task" }).uncheck();
  await expect(all.getByRole("row", { name: /Today task/ })).not.toHaveClass(/task-row--done/);

  // AC4: Pick up adds me, then Drop removes only me.
  await all.getByRole("button", { name: "Pick up Open task" }).click();
  await expect(all.getByRole("button", { name: "Drop Open task" })).toBeVisible();
  await expect(all.getByRole("row", { name: /Open task/ })).toContainText(fullTimeStaff.name);
  await all.getByRole("button", { name: "Drop Open task" }).click();
  await expect(all.getByRole("button", { name: "Pick up Open task" })).toBeVisible();
  await expect(all.getByRole("row", { name: /Open task/ })).toContainText(fullTimeStaff.name);

  // AC5: Delete removes the row; Undo restores it.
  await all.getByRole("button", { name: "Delete Open task" }).click();
  await expect(all.getByRole("row", { name: /Open task/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(all.getByRole("row", { name: /Open task/ })).toBeVisible();
});

test("assignees edit inline with the searchable multi-select, staff without accounts included (FLOW-345 AC6)", async ({ page }) => {
  // Staff without an account (FLOW-270) can be assigned too.
  await browserDb((db) =>
    db.insert(users).values({ email: "", name: "Robin Driver", mobile: "202-555-7715", role: "part_time_staff", status: "active", hasAccount: false }));
  const [taskId] = await seedTasks([{ title: "Stack chairs", assigneeIds: [fullTimeStaff.id] }]);
  await page.goto("/#/tasks/all");
  const row = page.getByRole("region", { name: "Tasks" }).getByRole("row", { name: /Stack chairs/ });
  await row.getByRole("button", { name: fullTimeStaff.name }).click();
  await page.getByRole("searchbox", { name: "Search options" }).fill("Robin");
  await page.getByRole("option", { name: "Robin Driver" }).click();
  await page.keyboard.press("Escape");
  const saved = page.waitForResponse((response) =>
    response.url().includes(`/api/tasks/${taskId}`) && response.request().method() === "PATCH");
  await row.getByRole("button", { name: "Save" }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.goto(`/#/tasks/${taskId}`);
  await expect(page.locator("dd").filter({ hasText: "Robin Driver" })).toContainText(fullTimeStaff.name);
});

// FLOW-346 and FLOW-345 A1: the task page saves people and notes, lists history
// newest first, and has Delete task at the bottom, which asks first and offers Undo.
test("the task page saves assignees, managers and notes, and deletes with a confirm and Undo (FLOW-346)", async ({ page }) => {
  const [taskId] = await seedTasks([{ title: "Print menus", assigneeIds: [fullTimeStaff.id] }]);
  await page.goto(`/#/tasks/${taskId}`);
  const reassign = page.getByRole("form", { name: "Reassign" });
  await choose(reassign.getByLabel("Assigned to"), [fullTimeStaff.id, kitchenLead.id]);
  await choose(reassign.getByLabel("Managers"), [admin.id]);
  await reassign.getByRole("button", { name: "Save assignment" }).click();
  await expect(page.locator("dd").filter({ hasText: kitchenLead.name })).toContainText(fullTimeStaff.name);
  await page.getByLabel("Task notes").fill("Use the cream card stock.");
  await page.getByRole("button", { name: "Save notes" }).click();
  await page.reload();
  await expect(page.getByLabel("Task notes")).toHaveValue("Use the cream card stock.");
  await expect(page.getByRole("list", { name: "Assignment history" }).getByRole("listitem").first()).toContainText(kitchenLead.name);

  // Delete task is the page's last control, after every card.
  const remove = page.getByRole("button", { name: "Delete task" });
  await expect(page.locator(".task-delete-footer")).toBeVisible();
  await remove.click();
  const confirm = page.getByRole("group", { name: "Delete this task?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(remove).toBeVisible();
  await remove.click();
  await page.getByRole("group", { name: "Delete this task?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task deleted." })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Delete task" })).toBeVisible();
});

databaseTest("someone who doesn't manage a task sees no Delete task, and Drop removes only them (FLOW-346)", async ({ page }) => {
  await mockBrowserAuth(page, { userId: partTimeStaff.id });
  const [taskId] = await seedTasks([{ title: "Wipe tables", assigneeIds: [partTimeStaff.id, kitchenLead.id], managerIds: [admin.id] }]);
  await page.goto(`/#/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: "Wipe tables" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete task" })).toHaveCount(0);
  await page.getByRole("button", { name: "Drop Wipe tables" }).click();
  // Only they leave; the other assignee stays.
  await expect(page.getByRole("button", { name: "Drop Wipe tables" })).toHaveCount(0);
  await expect(page.locator("dd").filter({ hasText: kitchenLead.name })).not.toContainText(partTimeStaff.name);
});
