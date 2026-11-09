import { randomUUID } from "node:crypto";
import { test, expect } from "./auth-fixture";
import { chairs, fallGala, juniper } from "./fixtures";
import { browserDb, seedInventory, seedRecords } from "./database";
import * as s from "../../worker/db/schema";

test("prints one vendor request with event, delivery and two rental lines", async ({ page }) => {
  await seedRecords({ clients: [juniper()], events: [fallGala()] });
  const [vendor] = await browserDb((db) => db.insert(s.vendors).values({ name: "Atlas Rentals", type: "rental_vendor" }).returning());
  const first = chairs();
  const second = { ...chairs(), id: randomUUID(), name: "Coupe glass" };
  await seedInventory({ items: [first, second].map((item) => ({ ...item, stock: [], totalQuantity: 0,
    rental: { ...item.rental!, vendorId: vendor.id, vendorName: vendor.name } })) });
  await page.goto(`/#/events/${fallGala().id}`);
  await page.getByRole("heading", { name: "Equipment & stock" }).scrollIntoViewIfNeeded();
  const hold = page.getByRole("form", { name: "Hold equipment" });
  for (const name of ["Chiavari Chair", "Coupe glass"]) {
    await hold.getByLabel("Item").selectOption({ label: name });
    await hold.getByLabel("Quantity").fill("2");
    await hold.getByRole("button", { name: "Hold equipment" }).click();
  }
  const request = page.locator(".rental-request-document");
  await expect(request).toHaveCount(1);
  await request.getByLabel("Atlas Rentals delivery details").fill("Back dock, 9 am");
  await request.getByLabel("Atlas Rentals delivery details").blur();
  await expect.poll(() => browserDb(async (db) => {
    const [event] = await db.select({ settings: s.events.rentalRequests }).from(s.events);
    return event.settings[0]?.details;
  })).toBe("Back dock, 9 am");
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printedText = document.querySelector('.rental-request-document[data-print="true"]')?.textContent ?? "";
    };
  });
  await request.getByRole("button", { name: "Print request" }).click();
  await expect.poll(() => page.locator("body").getAttribute("data-printed-text")).toContain("Fall gala");
  const printed = await page.locator("body").getAttribute("data-printed-text");
  expect(printed).toContain("Back dock, 9 am");
  expect(printed).toContain("Chiavari Chair");
  expect(printed).toContain("Coupe glass");
  expect(printed ?? "").not.toMatch(/client price|\$|cost/i);
});
