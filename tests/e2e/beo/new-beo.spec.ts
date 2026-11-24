import { choose, optionTexts } from "../dropdown";
import { test, expect, databaseTest, mockBrowserAuth } from "../auth-fixture";
import { fallGala, juniper } from "../fixtures";
import { browserDb, seedRecords } from "../database";
import { addLocalDays, utcToBusinessTime } from "../../../shared/time";
import { seedUsers } from "../../../worker/db/seed";
import * as s from "../../../worker/db/schema";

// FLOW-336 AC3: New BEO on the BEOs tab for an event without one creates the BEO
// and opens it; an event that has one is listed but can't be picked.
test("New BEO creates the event's BEO and opens it; an event with a BEO can't be picked", async ({ page }) => {
  const date = addLocalDays(utcToBusinessTime(new Date()).date, 10);
  const open = { ...fallGala(), date };
  const done = { ...fallGala(), id: "e0000000-0000-4000-8000-000000003361", title: "Fall gala rehearsal", date };
  await seedRecords({ clients: [juniper()], events: [open, done] });
  await browserDb((db) => db.insert(s.beos).values({ eventId: done.id, status: "working_on", snapshot: {} }));

  await page.goto("/#/beos");
  await page.getByRole("button", { name: "New BEO" }).click();
  const drawer = page.getByRole("dialog", { name: "New BEO" });
  await drawer.getByRole("searchbox").fill("Fall gala");
  const picker = drawer.getByRole("combobox", { name: "Event" });
  await expect.poll(() => optionTexts(picker)).toContainEqual(expect.stringContaining("Fall gala rehearsal"));
  await expect.poll(() => optionTexts(picker)).toContainEqual(expect.stringContaining("(already has a BEO)"));
  await choose(picker, open.id);
  await drawer.getByRole("button", { name: "Create BEO" }).click();

  await expect(page).toHaveURL(new RegExp(`#/events/${open.id}/beo/`));
  await expect(page.getByRole("heading", { name: "Fall gala", level: 1 })).toBeVisible();
  const rows = await browserDb((db) => db.select().from(s.beos));
  expect(rows.map((row) => row.eventId).sort()).toEqual([open.id, done.id].sort());
});

databaseTest("a role without events.write sees no New BEO button", async ({ page }) => {
  const staff = seedUsers.find((user) => user.role === "staff")!;
  await mockBrowserAuth(page, { userId: staff.id });
  await page.goto("/#/beos");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "New BEO" })).toHaveCount(0);
});
