import { test, expect } from "./auth-fixture";
import { chairs, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";
import { seedUsers } from "../../worker/db/seed";
import { choose } from "./dropdown";
import { businessTimeToUtc } from "../../shared/time";

// Events › Overview (FLOW-294; FLOW-265, FLOW-63): the calendar, its side panel,
// the events table below it, and layers (FLOW-67). The browser runs in Los Angeles to
// show the calendar draws New York times.
test.use({ timezoneId: "America/Los_Angeles" });

// AC1: an event on 9/17 from 5 to 10 PM.
const gala = () => ({
  ...fallGala(),
  date: "2026-09-17",
  startTime: "17:00",
  endTime: "22:00",
});

// FLOW-265, FLOW-294: the Events screen's Overview tab.
test("draws events at Negotiation or later as chips at their New York times, month by month", async ({ page }) => {
  const pitching = { ...gala(), id: "e0000000-0000-4000-8000-0000000000f1", title: "Early pitch", status: "pitching" as const };
  const lost = { ...gala(), id: "e0000000-0000-4000-8000-0000000000f2", title: "Lost dinner", status: "lost" as const };
  await seedRecords({ clients: [juniper()], events: [gala(), pitching, lost] });
  await page.goto("/#/events/overview?date=2026-09-17");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  const day = page.locator('.fc-daygrid-day[data-date="2026-09-17"]');
  await expect(day.locator(".calendar-event.calendar-status-closed")).toContainText("Fall gala");
  await expect(day).toContainText(/5:00/);
  // AC1: earlier stages and Lost never show.
  await expect(page.getByText("Early pitch")).toHaveCount(0);
  await expect(page.getByText("Lost dinner")).toHaveCount(0);
  // The Status filter offers only Negotiation and later.
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await expect(page.getByRole("listbox").last().getByRole("option")).toHaveText(["All statuses", "Negotiation", "Closing", "Closed", "Preparation", "Finished"]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { name: "October 2026" })).toBeVisible();
  await expect(page.getByText("Fall gala")).toHaveCount(0);
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  await expect(day).toContainText("Fall gala");
});

test("the sidebar opens the calendar", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  // Events opens its first tab, Overview (FLOW-246, FLOW-294).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Events", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await expect(page).toHaveURL(/#\/events\/overview$/);
  const tabs = page.getByRole("navigation", { name: "Events pages" });
  await expect(tabs.getByRole("link")).toHaveText(["Overview", "BEOs", "Production"]);
});

// FLOW-294 AC1, AC4: Month, Week and Day only; no List, no Day-of tab; the old
// addresses land on the Overview.
test("offers Month, Week and Day, and the old Calendar and Day-of addresses open the Overview", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [gala()] });
  await page.goto("/#/calendar?date=2026-09-17");
  await expect(page).toHaveURL(/#\/events\/overview\?date=2026-09-17$/);
  const views = page.getByRole("group", { name: "View" });
  await expect(views.getByRole("button")).toHaveText(["Month", "Week", "Day"]);

  await views.getByRole("button", { name: "Week" }).click();
  await expect(page).toHaveURL(/view=week/);
  await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sep 13 – Sep 19, 2026" })).toBeVisible();
  await expect(page.locator(".fc-timeGridWeek-view .calendar-event")).toContainText("Fall gala");
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.getByRole("heading", { name: "Sep 20 – Sep 26, 2026" })).toBeVisible();
  await expect(page.locator(".fc-timeGridWeek-view .calendar-event")).toHaveCount(0);

  await views.getByRole("button", { name: "Day" }).click();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByRole("heading", { name: "Wednesday, September 23, 2026" })).toBeVisible();

  await page.goto("/#/day-of");
  await expect(page).toHaveURL(/#\/events\/overview$/);
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Events pages" })).not.toContainText("Day-of");
});

// FLOW-294 AC2: confirmed events are filled chips; pending ones are a dot and text.
test("draws confirmed events filled and pending events as a dot with no fill", async ({ page }) => {
  const pending = { ...gala(), id: "e0000000-0000-4000-8000-0000000002f4", title: "Pending lunch", status: "negotiation" as const };
  await seedRecords({ clients: [juniper()], events: [gala(), pending] });
  await page.goto("/#/events/overview?date=2026-09-17");
  const confirmed = page.locator(".calendar-event", { hasText: "Fall gala" });
  const waiting = page.locator(".calendar-event", { hasText: "Pending lunch" });
  await expect(confirmed).toHaveClass(/calendar-confirmed/);
  await expect(confirmed.locator(".calendar-dot")).toHaveCount(0);
  await expect(waiting).toHaveClass(/calendar-pending/);
  await expect(waiting.locator(".calendar-dot")).toBeVisible();
  await expect(waiting).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(confirmed).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
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

test("clicking an event opens its side panel, whose Open BEO opens that event's BEO (AC3)", async ({ page }) => {
  await seedSchedules();
  const [beo] = await browserDb((db) => db.insert(s.beos).values({ eventId: fallGala().id, snapshot: {} }).returning());
  await browserDb((db) => db.insert(s.proposals).values({ eventId: fallGala().id, title: "Gala proposal" }));
  await page.goto("/#/events/overview?date=2026-09-17");
  await page.locator('.fc-daygrid-day[data-date="2026-09-17"] .calendar-event').click();
  const panel = page.getByRole("dialog", { name: "Fall gala" });
  await expect(panel).toContainText("Thu, Sep 17 · 5:00 PM");
  await expect(panel).toContainText("Juniper & Co.");
  await expect(panel).toContainText("120");
  await expect(panel).toContainText(salesperson.name);
  await expect(panel).toContainText("Gala proposal");
  await expect(panel.getByRole("link", { name: "Open event" })).toHaveAttribute("href", `#/events/${fallGala().id}`);
  await expect(panel.getByRole("link", { name: "Open Proposal" })).toBeVisible();
  await panel.getByRole("link", { name: "Open BEO" }).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${fallGala().id}/beo/${beo.id}$`));
});

// FLOW-294 AC3: the table lists exactly the events in the range the calendar
// shows and follows navigation, the view and the filters.
test("the events table lists the events in view and follows navigation and filters", async ({ page }) => {
  await seedSchedules();
  const nextWeek = { ...gala(), id: "e0000000-0000-4000-8000-0000000002f5", title: "Harvest brunch", date: "2026-09-24" };
  const october = { ...gala(), id: "e0000000-0000-4000-8000-0000000002f6", title: "October social", date: "2026-10-02" };
  await seedRecords({ events: [nextWeek, october] });
  await page.goto("/#/events/overview?date=2026-09-17");
  const table = page.locator(".calendar-events-table");
  const row = table.getByRole("row", { name: /Fall gala/ });
  // The date with the time beneath it (FLOW-296).
  await expect(row.locator(".date-time-cell__date")).toHaveText("Thu, Sep 17");
  await expect(row.locator(".date-time-cell__time")).toHaveText("5:00 PM");
  await expect(row).toContainText(salesperson.name);
  // Month: September only, though the grid shows Oct 2.
  await expect(table.getByRole("row", { name: /Harvest brunch/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /October social/ })).toHaveCount(0);

  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Week" }).click();
  await expect(row).toBeVisible();
  await expect(table.getByRole("row", { name: /Harvest brunch/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(table.getByRole("row", { name: /Harvest brunch/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Fall gala/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Previous week" }).click();

  await choose(page.getByRole("combobox", { name: "Status", exact: true }), "negotiation");
  await expect(table.getByRole("row", { name: /Fall gala/ })).toHaveCount(0);
  await choose(page.getByRole("combobox", { name: "Status", exact: true }), "closed");
  await expect(row).toBeVisible();
  await choose(page.getByRole("combobox", { name: "Owner", exact: true }), salesperson.id);
  await expect(row).toBeVisible();
  // Kept on reload.
  await page.reload();
  await expect(row).toBeVisible();
  // A row opens the event.
  await row.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${fallGala().id}$`));
});

test("toggles calendar layers without reloading the page (FLOW-67)", async ({ page }) => {
  await seedSchedules();
  await page.goto("/#/events/overview?date=2026-09-17");
  const setupDay = page.locator('.fc-daygrid-day[data-date="2026-09-16"]');
  const eventDay = page.locator('.fc-daygrid-day[data-date="2026-09-17"]');
  await expect(eventDay).toContainText("Fall gala");
  // AC2 (FLOW-265): every layer starts unchecked.
  for (const layer of ["Production tasks", "Tentative holds", "Staff shifts"])
    await expect(page.getByRole("checkbox", { name: layer })).not.toBeChecked();
  await expect(page.locator(".calendar-layer")).toHaveCount(0);
  // Marks this page load: a reload would clear it.
  await page.evaluate(() => {
    (window as unknown as { calendarLoad: string }).calendarLoad = "first";
  });

  // AC2: the setup shift is on the day before, at its New York times.
  await page.getByRole("checkbox", { name: "Staff shifts" }).check();
  const shift = setupDay.locator(".calendar-shift");
  await expect(shift).toContainText("Setup day: Fall gala · 1/2 staffed");
  await expect(shift).toContainText(/2:00/);
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
  await expect(eventDay).toContainText("Fall gala");
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
