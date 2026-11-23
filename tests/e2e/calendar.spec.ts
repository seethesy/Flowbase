import { test, expect } from "./auth-fixture";
import { chairs, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";
import { seedUsers } from "../../worker/db/seed";
import { choose } from "./dropdown";
import { businessTimeToUtc } from "../../shared/time";

// The Events screen's Calendar tab (FLOW-265; FLOW-63), its side panel and List
// view, and layers (FLOW-67). The browser runs in Los Angeles to
// show the calendar draws New York times.
test.use({ timezoneId: "America/Los_Angeles" });

// AC1: an event on 9/17 from 5 to 10 PM.
const gala = () => ({
  ...fallGala(),
  date: "2026-09-17",
  startTime: "17:00",
  endTime: "22:00",
});

// FLOW-265: the Events screen's Calendar tab.
test("draws events at Negotiation or later as chips at their New York times, month by month", async ({ page }) => {
  const pitching = { ...gala(), id: "e0000000-0000-4000-8000-0000000000f1", title: "Early pitch", status: "pitching" as const };
  const lost = { ...gala(), id: "e0000000-0000-4000-8000-0000000000f2", title: "Lost dinner", status: "lost" as const };
  await seedRecords({ clients: [juniper()], events: [gala(), pitching, lost] });
  await page.goto("/#/calendar?date=2026-09-17");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "September 2026" })).toBeVisible();
  const day = page.locator('.fc-daygrid-day[data-date="2026-09-17"]');
  await expect(day.locator(".calendar-event.calendar-status-closed")).toContainText("Fall gala");
  await expect(day).toContainText(/5:00/);
  // AC1: earlier stages and Lost never show.
  await expect(page.getByText("Early pitch")).toHaveCount(0);
  await expect(page.getByText("Lost dinner")).toHaveCount(0);
  // The Status filter offers only Negotiation and later.
  await page.getByRole("combobox", { name: "Status" }).click();
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
  // Events opens its first tab, Calendar (FLOW-246).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Events", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Events pages" })).toContainText("BEOs");
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
  await page.goto("/#/calendar?date=2026-09-17");
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

test("the List view is the month's events table, filtered by owner and status", async ({ page }) => {
  await seedSchedules();
  await page.goto("/#/calendar?date=2026-09-17");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  const row = page.getByRole("row", { name: /Fall gala/ });
  await expect(row).toContainText("Thu, Sep 17 · 5:00 PM");
  await expect(row).toContainText(salesperson.name);
  await choose(page.getByRole("combobox", { name: "Status" }), "negotiation");
  await expect(page.getByRole("row", { name: /Fall gala/ })).toHaveCount(0);
  await choose(page.getByRole("combobox", { name: "Status" }), "closed");
  await expect(page.getByRole("row", { name: /Fall gala/ })).toBeVisible();
  await choose(page.getByRole("combobox", { name: "Owner" }), salesperson.id);
  await expect(page.getByRole("row", { name: /Fall gala/ })).toBeVisible();
  // Kept on reload.
  await page.reload();
  await expect(page.getByRole("row", { name: /Fall gala/ })).toBeVisible();
});

test("toggles calendar layers without reloading the page (FLOW-67)", async ({ page }) => {
  await seedSchedules();
  await page.goto("/#/calendar?date=2026-09-17");
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
