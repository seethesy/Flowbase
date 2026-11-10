import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { fallGala, juniper } from "./fixtures";
import { browserDb, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

test("warns about an overlapping truck assignment and records acknowledgement", async ({ page }) => {
  const second = { ...fallGala(), id: randomUUID(), title: "Second gala" };
  await seedRecords({ clients: [juniper()], events: [fallGala(), second] });
  const truck = await browserDb(async (db) => {
    const [row] = await db.select().from(s.trucks);
    await db.insert(s.truckAssignments).values({ truckId: row.id, eventId: fallGala().id,
      departsAt: new Date("2026-11-14T18:00:00.000Z"), returnsAt: new Date("2026-11-14T22:00:00.000Z") });
    return row;
  });
  await page.goto(`/#/events/${second.id}`);
  await page.getByRole("heading", { name: "Truck log" }).scrollIntoViewIfNeeded();
  await page.getByLabel("Truck", { exact: true }).selectOption(truck.id);
  await page.getByLabel("Departure").fill("2026-11-14T15:00");
  await page.getByLabel("Back at warehouse").fill("2026-11-14T18:00");
  await page.getByRole("button", { name: "Assign truck" }).click();
  await expect(page.getByRole("alert")).toContainText(
    `You are attempting to assign ${truck.name} to Second gala at 3:00pm. Possible conflict: ${truck.name} is already assigned to Fall gala`,
  );
  await page.getByRole("button", { name: "Acknowledge and assign" }).click();
  await expect.poll(() => browserDb(async (db) => {
    const [row] = await db.select().from(s.truckAssignments).where(eq(s.truckAssignments.eventId, second.id));
    return row?.conflictAcknowledgedAt;
  })).not.toBeNull();
});

test("shows unassigned production work on the event hub", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await browserDb((db) => db.insert(s.tasks).values({ eventId: fallGala().id,
    title: "Build balloon arch", type: "production", dueAt: new Date("2026-11-12T14:00:00.000Z") }));
  await page.goto(`/#/events/${fallGala().id}`);
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Who is building the balloon arch?");
  await expect(page.getByText("Build balloon arch")).toBeVisible();
});
