import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { seedRecords } from "./database";

// Basic calendar (FLOW-63) and reaching the event hub from it (FLOW-166). The
// browser runs in Los Angeles to show the calendar draws New York times.
test.use({ timezoneId: "America/Los_Angeles" });

// AC1: an event on 9/17 from 5 to 10 PM.
const gala = () => ({
  ...fallGala(),
  date: "2026-09-17",
  startTime: "17:00",
  endTime: "22:00",
});

test("shows an event at its New York times in every view and opens its hub", async ({
  page,
}) => {
  await seedRecords({ clients: [juniper()], events: [gala()] });
  await page.goto("/#/calendar?date=2026-09-17");
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();

  // Month
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  const day = page.locator('.fc-daygrid-day[data-date="2026-09-17"]');
  await expect(day).toContainText("Fall gala · Closed");
  await expect(day).toContainText(/5:00/);
  await expect(page.locator('.fc-daygrid-day[data-date="2026-09-18"]')).not.toContainText(
    "Fall gala",
  );

  // Week: in the 9/17 column, from 5 to 10 PM.
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const column = page.locator('.fc-timegrid-col[data-date="2026-09-17"]');
  await expect(column).toContainText("Fall gala · Closed");
  await expect(column.locator(".fc-event-time")).toHaveText(/5:00.*10:00/);
  await expect(page).toHaveURL(/view=timeGridWeek/);

  // Day
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.getByRole("heading", { name: "September 17, 2026" })).toBeVisible();
  await expect(page.locator(".fc-timegrid-event")).toContainText("Fall gala · Closed");
  await expect(page.locator(".fc-timegrid-event .fc-event-time")).toHaveText(/5:00.*10:00/);

  // List
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator('.fc-list-day[data-date="2026-09-17"]')).toBeVisible();
  const row = page.locator(".fc-list-event", { hasText: "Fall gala · Closed" });
  await expect(row.locator(".fc-list-event-time")).toHaveText(/5:00.*10:00/);
  // Navigation: next month and back. (Done last: it moves the current date to
  // the first of the month, which the week and day views above would follow.)
  await page.locator(".fc-next-button").click();
  await expect(page.getByRole("heading", { name: "October 2026" })).toBeVisible();
  await expect(page.getByText("Fall gala · Closed")).toHaveCount(0);
  await page.locator(".fc-prev-button").click();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();

  // Clicking the event opens its hub, with its tasks and history (FLOW-166).
  await row.getByText("Fall gala · Closed").click();
  await expect(page).toHaveURL(new RegExp(`#/events/${fallGala().id}$`));
  await expect(page.getByRole("heading", { name: "Fall gala", level: 1 })).toBeVisible();
  for (const section of ["Tasks", "History"])
    await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
  await expect(page.getByText("No tasks for this event.")).toBeVisible();

  // Back on the calendar, the view and date are kept.
  await page.goBack();
  await expect(page.locator('.fc-list-day[data-date="2026-09-17"]')).toBeVisible();
});

test("the sidebar opens the calendar", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
});
