import { eq } from "drizzle-orm";
import { test, expect } from "./auth-fixture";
import { chairs, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

// Post-event closeout and returns (FLOW-157) on a phone.
test.use({ viewport: { width: 390, height: 844 } });

test("returns 38 of 40 chairs with 2 damaged and finishes the event", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  await seedInventory({ items: [chairs()] });
  await browserDb(async (db) => {
    await db.update(s.events).set({ status: "preparation" }).where(eq(s.events.id, fallGala().id));
    const [list] = await db.insert(s.pullLists).values({ eventId: fallGala().id }).returning();
    await db.insert(s.pullListLines).values({
      pullListId: list.id,
      group: "kitchen_equipment",
      itemId: chairs().id,
      name: "Chiavari Chair",
      quantity: 40,
      status: "loaded",
    });
  });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("heading", { name: "Closeout and returns" }).scrollIntoViewIfNeeded();
  await page.getByLabel("Chiavari Chair returned").fill("38");
  await page.getByLabel("Chiavari Chair damaged").fill("2");
  await page.getByLabel("Final notes").fill("Two chairs cracked at the venue.");
  await page.getByRole("button", { name: "Close out event" }).click();
  await expect(page.getByText("Returned 38, damaged 2, missing 0")).toBeVisible();

  const movements = await browserDb((db) => db.select().from(s.stockMovements));
  expect(movements.find((m) => m.type === "return")?.quantity).toBe(38);
  expect(movements.find((m) => m.type === "damage_loss")?.quantity).toBe(-2);
  const [event] = await browserDb((db) => db.select().from(s.events).where(eq(s.events.id, fallGala().id)));
  expect(event.status).toBe("finished");
});
