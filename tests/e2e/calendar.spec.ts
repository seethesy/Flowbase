import { test, expect } from "./auth-fixture";
import { chairs, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";
import { seedUsers } from "../../worker/db/seed";
import { businessTimeToUtc } from "../../shared/time";

// Basic calendar (FLOW-63), its overview mode (FLOW-64) and layers (FLOW-67), and
// reaching the event hub from it (FLOW-166). The browser runs in Los Angeles to
// show the calendar draws New York times.
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
  await expect(page.getByText("No tasks on this event yet.")).toBeVisible();

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

const salesperson = seedUsers.find((u) => u.role === "salesperson")!;
const staffer = seedUsers.find((u) => u.role === "staff")!;

// The gala with Sam's counterpart as salesperson, a setup shift the day before
// with one of two slots filled, a production task and a tentative chair hold.
async function seedSchedules() {
  await seedRecords({
    clients: [juniper()],
    events: [{ ...gala(), assignedSalespersonId: salesperson.id }],
  });
  await seedInventory({ items: [chairs()] });
  await browserDb(async (db) => {
    const [shift] = await db
      .insert(s.eventShifts)
      .values({
        eventId: fallGala().id,
        kind: "setup",
        startsAt: businessTimeToUtc("2026-09-16", "14:00"),
        endsAt: businessTimeToUtc("2026-09-16", "18:00"),
      })
      .returning();
    await db.insert(s.eventStaffSlots).values([
      { shiftId: shift.id, position: "Server", department: "service", assigneeId: staffer.id },
      { shiftId: shift.id, position: "Server", department: "service", sortOrder: 1 },
    ]);
    await db.insert(s.tasks).values({
      title: "Prep crudités",
      type: "production",
      dueAt: businessTimeToUtc("2026-09-17", "09:00"),
      eventId: fallGala().id,
    });
    await db.insert(s.reservations).values({
      eventId: fallGala().id,
      itemId: chairs().id,
      quantity: 120,
      windowStart: "2026-09-16",
      windowEnd: "2026-09-18",
    });
  });
}

test("shows each event's overview: time, title, venue, guests, status, salesperson, staff (FLOW-64)", async ({
  page,
}) => {
  await seedSchedules();
  await page.goto("/#/calendar?date=2026-09-17");
  const entry = page.locator('.fc-daygrid-day[data-date="2026-09-17"] .calendar-event');
  await expect(entry.locator(".fc-event-time")).toHaveText(/5:00/);
  await expect(entry.locator(".fc-event-title")).toHaveText("Fall gala · Closed");
  await expect(entry.locator(".calendar-overview-details")).toHaveText(
    `No venue · 120 guests · ${salesperson.name} · 1 staff`,
  );
  // The week and list views show the same overview.
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.locator('.fc-timegrid-col[data-date="2026-09-17"] .calendar-overview-details'),
  ).toHaveText(`No venue · 120 guests · ${salesperson.name} · 1 staff`);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".fc-list-event .calendar-overview-details")).toHaveText(
    `No venue · 120 guests · ${salesperson.name} · 1 staff`,
  );
});

test("toggles calendar layers without reloading the page (FLOW-67)", async ({ page }) => {
  await seedSchedules();
  await page.goto("/#/calendar?view=timeGridWeek&date=2026-09-17");
  const setupDay = page.locator('.fc-timegrid-col[data-date="2026-09-16"]');
  const eventDay = page.locator('.fc-timegrid-col[data-date="2026-09-17"]');
  await expect(eventDay).toContainText("Fall gala · Closed");
  // Layers start off.
  await expect(page.locator(".calendar-layer")).toHaveCount(0);
  // Marks this page load: a reload would clear it.
  await page.evaluate(() => {
    (window as unknown as { calendarLoad: string }).calendarLoad = "first";
  });

  // AC2: the setup shift is on the day before, at its New York times.
  await page.getByRole("checkbox", { name: "Staff shifts" }).check();
  const shift = setupDay.locator(".calendar-shift");
  await expect(shift).toContainText("Setup day: Fall gala · 1/2 staffed");
  await expect(shift.locator(".fc-event-time")).toHaveText(/2:00.*6:00/);
  await expect(eventDay.locator(".calendar-shift")).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Production tasks" }).check();
  await expect(eventDay.locator(".calendar-production")).toContainText(
    "Production: Prep crudités",
  );
  await page.getByRole("checkbox", { name: "Tentative holds" }).check();
  await expect(page.locator(".calendar-hold")).toContainText(
    "Tentative hold: Fall gala · 1 item",
  );
  await expect(page).toHaveURL(/layers=production%2Cholds%2Cshifts/);

  // AC1: turning a layer off hides only its entries.
  await page.getByRole("checkbox", { name: "Staff shifts" }).uncheck();
  await expect(page.locator(".calendar-shift")).toHaveCount(0);
  await expect(page.locator(".calendar-production")).toHaveCount(1);
  await expect(page.locator(".calendar-hold")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Production tasks" }).uncheck();
  await page.getByRole("checkbox", { name: "Tentative holds" }).uncheck();
  await expect(page.locator(".calendar-layer")).toHaveCount(0);
  await expect(eventDay).toContainText("Fall gala · Closed");
  expect(
    await page.evaluate(() => (window as unknown as { calendarLoad?: string }).calendarLoad),
  ).toBe("first");

  // The address keeps the layers that are on.
  await page.getByRole("checkbox", { name: "Staff shifts" }).check();
  await expect(page).toHaveURL(/layers=shifts/);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Staff shifts" })).toBeChecked();
  await expect(setupDay.locator(".calendar-shift")).toBeVisible();
});
