import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { test, expect, signedInUser } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import * as s from "../../worker/db/schema";

test("production list percentage follows task completion", async ({ page }) => {
  const date = addLocalDays(utcToBusinessTime(new Date()).date, 2);
  const event = { ...fallGala(), date, productionLeadId: signedInUser.id };
  await seedRecords({ clients: [juniper()], events: [event] });
  const taskId = randomUUID();
  await browserDb(async (db) => {
    await db.insert(s.tasks).values({ id: taskId, eventId: event.id, title: "Build arch", type: "production",
      dueAt: businessTimeToUtc(date, "09:00") });
    await db.insert(s.taskAssignees).values({ taskId, userId: signedInUser.id });
  });
  await page.goto(`/#/events/${event.id}`);
  await expect(page.getByRole("heading", { name: "Production list" })).toBeVisible();
  await expect(page.getByText("0% complete")).toBeVisible();
  await browserDb((db) => db.update(s.tasks).set({ status: "done" }).where(eq(s.tasks.id, taskId)));
  await page.reload();
  await expect(page.getByText("100% complete")).toBeVisible();
});

test("two same-day events show pulls and trucks and flag full truck capacity", async ({ page }) => {
  const date = addLocalDays(utcToBusinessTime(new Date()).date, 2);
  const first = { ...fallGala(), date, title: "Autumn gala" };
  const second = { ...fallGala(), id: randomUUID(), date, title: "Winter lunch" };
  await seedRecords({ clients: [juniper()], events: [first, second] });
  await browserDb(async (db) => {
    const trucks = await db.select().from(s.trucks);
    for (const [index, event] of [first, second].entries()) {
      await db.insert(s.pullLists).values({ eventId: event.id, scheduledAt: businessTimeToUtc(date, "10:00") });
      await db.insert(s.truckAssignments).values({ truckId: trucks[index].id, eventId: event.id,
        departsAt: businessTimeToUtc(date, "11:00"), returnsAt: businessTimeToUtc(date, "21:00") });
    }
    await db.insert(s.truckAssignments).values({ truckId: trucks[2].id, eventId: first.id,
      departsAt: businessTimeToUtc(date, "11:00"), returnsAt: businessTimeToUtc(date, "21:00") });
    for (const event of [first, second]) {
      const [shift] = await db.insert(s.eventShifts).values({ eventId: event.id, kind: "event_day",
        startsAt: businessTimeToUtc(date, "12:00"), endsAt: businessTimeToUtc(date, "20:00") }).returning();
      await db.insert(s.eventStaffSlots).values({ shiftId: shift.id, position: "Server", department: "service",
        assigneeId: signedInUser.id });
    }
  });
  await page.goto("/#/production");
  await expect(page.getByRole("heading", { name: "Production overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Autumn gala" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Winter lunch" }).first()).toBeVisible();
  await expect(page.getByText("All 3 trucks are assigned")).toBeVisible();
  await expect(page.getByText("Staff shifts overlap.")).toBeVisible();
  await page.getByRole("combobox", { name: "Event" }).selectOption(second.id);
  await expect(page.getByRole("link", { name: "Winter lunch" }).first()).toBeVisible();
});
