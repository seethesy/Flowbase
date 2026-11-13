import { expect, test, type Page } from "./auth-fixture";
import * as s from "../../worker/db/schema";
import { timelineKinds } from "../../shared/event-timeline";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import { mockAttachmentsApi } from "./mock-api";

// Browser coverage for the BEO's schedule, setup photos, cleanup checklist, layout
// images and the calendar's detail mode (FLOW-237, follow-up to FLOW-145, 146, 147
// and 65). The data is seeded in the database; uploads go to the mocked R2.
const gala = () => ({ ...fallGala(), date: "2026-09-17", startTime: "17:00", endTime: "22:00" });

async function seedBeo() {
  await seedRecords({ clients: [juniper()], events: [gala()] });
  await browserDb(async (db) => {
    const [beo] = await db
      .insert(s.beos)
      .values({ eventId: gala().id, status: "approved", approvedAt: new Date(), runOfShowMode: "on" })
      .returning();
    await db.insert(s.eventTimelineEntries).values({
      eventId: gala().id,
      kind: timelineKinds[0],
      startsAt: new Date("2026-09-17T21:30:00.000Z"),
      endsAt: new Date("2026-09-17T22:00:00.000Z"),
      activity: "Guests arrive",
    });
    await db.insert(s.beoRunOfShow).values([
      { beoId: beo.id, eventId: gala().id, time: "18:00", cue: "Doors open", owner: "Jamie", sortOrder: 0 },
      { beoId: beo.id, eventId: gala().id, time: "19:00", cue: "Toasts", owner: "Casey", sortOrder: 1 },
    ]);
    await db.insert(s.beoAreas).values([
      { beoId: beo.id, eventId: gala().id, kind: "setup", name: "Cocktail hour", sortOrder: 0 },
      { beoId: beo.id, eventId: gala().id, kind: "layout", name: "Ballroom", sortOrder: 0 },
    ]);
    await db.insert(s.beoChecklistItems).values([
      { beoId: beo.id, eventId: gala().id, section: "Load-out", label: "Strip linens", sortOrder: 0 },
      { beoId: beo.id, eventId: gala().id, section: "Load-out", label: "Sweep floor", sortOrder: 1 },
    ]);
  });
}

// A small valid PNG, drawn in the page.
const png = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f5d50";
    context.fillRect(0, 0, 240, 150);
    return canvas.toDataURL("image/png").split(",")[1];
  });

test("the schedule and run-of-show tables list their rows in order", async ({ page }) => {
  await seedBeo();
  await page.goto(`/#/events/${gala().id}`);
  const schedule = page.getByRole("table", { name: "Schedule for 2026-09-17" });
  await expect(schedule.getByRole("row").nth(1)).toContainText("Guests arrive");
  const run = page.getByRole("table", { name: "Run of show" });
  await expect(run.getByRole("row")).toHaveCount(3);
  await expect(run.getByRole("row").nth(1)).toContainText("Doors open");
  await expect(run.getByRole("row").nth(2)).toContainText("Toasts");
});

test("on a phone, setup photos can be added and the cleanup checklist checked off", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedBeo();
  const r2 = await mockAttachmentsApi(page);
  await page.goto(`/#/events/${gala().id}`);
  const area = page.getByTestId("beo-setup-area").filter({ hasText: "Cocktail hour" });
  await area.getByLabel("Add to Actual photos (taken on the day)").setInputFiles({
    name: "setup.png",
    mimeType: "image/png",
    buffer: Buffer.from(await png(page), "base64"),
  });
  await expect(area.getByRole("img", { name: /setup\.png/ })).toBeVisible();
  expect(r2.starts()).toBe(1);

  const item = page.getByRole("checkbox", { name: "Strip linens" });
  await item.check();
  await expect(item).toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Strip linens" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Sweep floor" })).not.toBeChecked();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  ).toBe(false);
});

test("a layout image can be uploaded and is shown, and Annotate opens the drawing tool", async ({ page }) => {
  await seedBeo();
  await mockAttachmentsApi(page);
  await page.goto(`/#/events/${gala().id}`);
  const area = page.getByTestId("beo-layout-area").filter({ hasText: "Ballroom" });
  await area.getByLabel("Add to Floor plan, aerial photo or sketch").setInputFiles({
    name: "ballroom.png",
    mimeType: "image/png",
    buffer: Buffer.from(await png(page), "base64"),
  });
  await expect(area.getByRole("img", { name: /ballroom\.png/ })).toBeVisible();
  await area.getByRole("button", { name: "Annotate" }).click();
  const editor = page.getByRole("dialog", { name: "Annotate Ballroom" });
  await expect(editor.getByRole("button", { name: "Save annotation" })).toBeVisible();
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toHaveCount(0);
});

test("calendar detail mode shows the clicked event's BEO beside the calendar", async ({ page }) => {
  await seedBeo();
  await page.goto("/#/calendar?date=2026-09-17");
  await page.getByLabel("Detail mode").check();
  await page.locator('.fc-daygrid-day[data-date="2026-09-17"] .calendar-event').click();
  const detail = page.getByRole("complementary", { name: "Event details" });
  await expect(detail).toContainText("Fall gala");
  await expect(detail).toContainText("120 guests");
  await expect(detail.getByRole("link", { name: "Open event" })).toBeVisible();
  await detail.getByRole("button", { name: "Close" }).click();
  await expect(detail).toHaveCount(0);
});
