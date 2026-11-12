import { eq } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { chairs, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

// Holds, conflicts and resolution on the event page (FLOW-223), and the same item's
// availability, open conflict and allocations on the item page (FLOW-224).
const wedding = () => ({ ...fallGala(), id: "e0000000-0000-4000-8000-000000000002", title: "Spring wedding" });

// 50 chairs are owned (Warehouse 40, Cafe 10). The gala, booked first, holds 40.
async function seedOverbookableChairs() {
  await seedRecords({ clients: [juniper()], events: [fallGala(), wedding()] });
  await seedInventory({ items: [chairs()] });
  await browserDb(async (db) => {
    await db.update(s.events).set({ bookedAt: new Date("2026-10-22T09:00:00.000Z") }).where(eq(s.events.id, fallGala().id));
    await db.update(s.events).set({ bookedAt: new Date("2026-10-25T09:00:00.000Z") }).where(eq(s.events.id, wedding().id));
    await db.insert(s.reservations).values({
      eventId: fallGala().id, itemId: chairs().id, quantity: 40, status: "confirmed",
      windowStart: "2026-11-13", windowEnd: "2026-11-15",
    });
  });
}

test("holding more chairs than are free shows a conflict, and lowering the hold resolves it", async ({ page }) => {
  await seedOverbookableChairs();
  await page.goto(`/#/events/${wedding().id}`);
  await page.getByRole("heading", { name: "Equipment & stock" }).scrollIntoViewIfNeeded();
  const form = page.getByRole("form", { name: "Hold equipment" });
  await form.getByLabel("Item").selectOption({ label: "Chiavari Chair" });
  await form.getByLabel("Quantity").fill("30");
  await form.getByRole("button", { name: "Hold equipment" }).click();

  const conflict = page.getByRole("group", { name: "Chiavari Chair conflict" });
  await expect(conflict).toContainText("20 short");
  await expect(page.getByLabel("Quantity of Chiavari Chair")).toHaveValue("30");

  await conflict.getByLabel("Resolution").selectOption("adjust");
  await conflict.getByLabel("New quantity").fill("10");
  await conflict.getByLabel("Note").fill("Rent the rest");
  await conflict.getByRole("button", { name: "Resolve" }).click();
  await expect(conflict).toHaveCount(0);
  await expect.poll(() => browserDb(async (db) => {
    const [row] = await db.select().from(s.reservations);
    return row?.quantity;
  })).toBe(10);
  await page.reload();
  await expect(page.getByLabel("Quantity of Chiavari Chair")).toHaveValue("10");
  await expect.poll(() => browserDb(async (db) => {
    const [row] = await db.select().from(s.reservationConflicts);
    return { state: row?.state, method: row?.resolution?.method };
  })).toEqual({ state: "resolved", method: "adjust" });
});

test("the item page shows availability for a chosen range and the open conflict", async ({ page }) => {
  await seedOverbookableChairs();
  await browserDb(async (db) => {
    const [hold] = await db.insert(s.reservations).values({
      eventId: wedding().id, itemId: chairs().id, quantity: 30, status: "confirmed",
      windowStart: "2026-11-13", windowEnd: "2026-11-15",
    }).returning();
    await db.insert(s.reservationConflicts).values({
      reservationId: hold.id, itemId: chairs().id, eventId: wedding().id, kind: "conflict",
      quantity: 30, allocated: 10, shortfall: 20, signature: "conflict:30:10:20",
    });
  });
  await page.goto(`/#/inventory/${chairs().id}`);
  const range = page.getByRole("form", { name: "Availability range" });
  await range.getByLabel("From").fill("2026-11-14");
  await range.getByLabel("To").fill("2026-11-14");
  const figures = page.getByRole("table", { name: "Availability for the range" });
  await expect(figures.getByRole("row", { name: /^Owned 50/ })).toBeVisible();
  // 40 + 30 confirmed on the 14th against 50 owned.
  await expect(figures.getByRole("row", { name: /^Available -20/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fall gala" })).toBeVisible();

  await range.getByLabel("From").fill("2026-12-20");
  await range.getByLabel("To").fill("2026-12-21");
  await expect(figures.getByRole("row", { name: /^Available 50/ })).toBeVisible();
  await expect(page.getByText("Nothing is held in this range.")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Open conflicts" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Spring wedding/ })).toBeVisible();
  await expect(page.getByText("20 short (10 of 30)")).toBeVisible();
});
