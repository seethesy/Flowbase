import { eq } from "drizzle-orm";
import { choose } from "../dropdown";
import { test, expect, databaseTest, mockBrowserAuth } from "../auth-fixture";
import { juniper, lead } from "../fixtures";
import { browserDb, seedLeads, seedRecords } from "../database";
import { seedUsers } from "../../../worker/db/seed";
import { events } from "../../../worker/db/schema";

// FLOW-336: New event on Events › Overview, with a lead (AC1) or without one
// (A1), and hidden from roles that can't create events (AC4).

test("New event with a chosen lead creates an event linked to the lead and opens it", async ({ page }) => {
  const picked = lead({ name: "Harbor reunion lead", status: "new" });
  await seedLeads([picked]);
  await page.goto("/#/events/overview");
  await page.getByRole("button", { name: "New event" }).click();
  const drawer = page.getByRole("dialog", { name: "New event" });
  await drawer.getByRole("searchbox").fill("Harbor");
  await choose(drawer.getByRole("combobox", { name: "Lead" }), { label: "Harbor reunion lead" });
  await drawer.getByLabel("Event name *").fill("Harbor reunion");
  await drawer.getByLabel("Date *").fill("2027-05-08");
  await drawer.getByLabel("Start time *").fill("18:00");
  await drawer.getByRole("button", { name: "Save event" }).click();

  await expect(page.getByRole("heading", { name: "Harbor reunion", level: 1 })).toBeVisible();
  const [row] = await browserDb((db) => db.select().from(events).where(eq(events.title, "Harbor reunion")));
  expect(row.leadId).toBe(picked.id);
});

test("New event without a lead continues to the event form and opens the event", async ({ page }) => {
  await seedRecords({ clients: [juniper()] });
  await page.goto("/#/events/overview");
  await page.getByRole("button", { name: "New event" }).click();
  await page.getByRole("dialog", { name: "New event" }).getByRole("button", { name: "Continue without a lead" }).click();

  const form = page.getByRole("dialog", { name: "New event" });
  await expect(form.getByText("Only title, date, start time and client are required.")).toBeVisible();
  await form.getByLabel("Title *").fill("Walk-in luncheon");
  await form.getByLabel("Date *").fill("2027-04-02");
  await choose(form.getByRole("combobox", { name: "Client *" }), { label: juniper().name });
  await form.getByLabel("Start time *").fill("12:00");
  await form.getByRole("button", { name: "Save event" }).click();

  await expect(page.getByRole("heading", { name: "Walk-in luncheon", level: 1 })).toBeVisible();
  const [row] = await browserDb((db) => db.select().from(events).where(eq(events.title, "Walk-in luncheon")));
  expect(row.leadId).toBeNull();
});

databaseTest("a role without events.write sees no New event button", async ({ page }) => {
  const staff = seedUsers.find((user) => user.role === "staff")!;
  await mockBrowserAuth(page, { userId: staff.id });
  await page.goto("/#/events/overview");
  await expect(page.getByRole("heading", { name: "Events", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "New event" })).toHaveCount(0);
});
