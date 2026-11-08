import { expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { databaseTest, mockBrowserAuth } from "./auth-fixture";
import { browserDb, seedInventory } from "./database";
import { consumable } from "./fixtures";
import { seedUsers } from "../../worker/db/seed";
import { inventoryConsumableDetails, inventoryCostHistory, inventoryStock, orderLists } from "../../worker/db/schema";

// Ordering record (FLOW-87) and receiving (FLOW-88). Deliveries are received on a
// phone at the back door.
databaseTest.use({ viewport: { width: 390, height: 844 } });

databaseTest("records a portal order, then receives part of it on a phone", async ({ page }) => {
  const admin = seedUsers.find((user) => user.role === "admin")!;
  const wine = consumable("Pinot Grigio", { details: { purchaseUnit: "case", packCount: 12, unitCostCents: 12000 } });
  await seedInventory({ items: [wine] });
  const listId = await browserDb(async (db) => {
    const [row] = await db.insert(orderLists).values({ fromDate: "2026-11-01", toDate: "2026-11-30", status: "approved",
      lines: [{ itemId: wine.id, itemName: "Pinot Grigio", vendorId: null, vendorName: "Wine vendor",
        orderingInstructions: "Order on the portal", quantity: 3, purchaseUnit: "case", shortage: 36,
        orderBy: null, eventIds: [], eventTitles: [], note: "" }] }).returning();
    return row.id;
  });
  await mockBrowserAuth(page, { userId: admin.id });
  await page.goto(`/#/inventory/orders/${listId}`);
  await expect(page.getByText("Place each vendor's order on its portal")).toBeVisible();

  // FLOW-87 AC1: the order number and expected delivery date are required.
  await page.getByRole("button", { name: "Mark as ordered" }).click();
  await expect(page.getByRole("alert")).toContainText("portal order number and expected delivery date");
  await page.getByLabel("Portal order number for Wine vendor").fill("WV-4471");
  await page.getByLabel("Expected delivery for Wine vendor").fill("2026-11-10");
  await page.getByLabel("Order total for Wine vendor").fill("360");
  await page.getByRole("button", { name: "Mark as ordered" }).click();
  await expect(page.getByRole("heading", { name: "Order WV-4471 · ordered" })).toBeVisible();

  // FLOW-88 AC1/AC2: 2 of 3 cases arrive at a new price.
  await page.getByLabel("Received quantity for Pinot Grigio").fill("2");
  await page.getByLabel("Actual unit cost for Pinot Grigio").fill("126");
  await page.getByLabel("Delivery note for Pinot Grigio").fill("1 case short");
  await page.getByRole("button", { name: "Record delivery" }).click();
  await expect(page.getByRole("heading", { name: "Order WV-4471 · partially received" })).toBeVisible();
  await expect(page.getByText("1 case to come")).toBeVisible();
  await expect.poll(() => browserDb(async (db) => {
    const [stock] = await db.select().from(inventoryStock).where(eq(inventoryStock.itemId, wine.id));
    const [detail] = await db.select().from(inventoryConsumableDetails).where(eq(inventoryConsumableDetails.itemId, wine.id));
    const history = await db.select().from(inventoryCostHistory).where(eq(inventoryCostHistory.itemId, wine.id));
    return { stock: stock?.quantity, cost: detail.unitCostCents, history: history.map((row) => row.source) };
  })).toEqual({ stock: 24, cost: 12600, history: ["receiving"] });
});
