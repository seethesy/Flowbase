import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../../worker/db/schema";
import { operationalReport } from "../../worker/records/operational-reports";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const clear = sql`truncate table reservations, vendor_orders, order_lists, events, clients, inventory_items cascade`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => { await db.execute(clear); });
afterAll(async () => { await db.execute(clear); await client.end(); });

it("counts active rental holds including zero-use items and sums vendor spend by month", async () => {
  const [clientRow] = await db.insert(schema.clients).values({ name: "Example organization", kind: "organization" }).returning();
  const [event] = await db.insert(schema.events).values({ title: "Example event", clientId: clientRow.id, startsAt: new Date("2026-11-14T20:00:00Z") }).returning();
  const [used, unused] = await db.insert(schema.inventoryItems).values([
    { kind: "rental", name: "Blue chair" }, { kind: "rental", name: "White table" },
  ]).returning();
  await db.insert(schema.reservations).values([
    { eventId: event.id, itemId: used.id, quantity: 3, windowStart: "2026-11-14", windowEnd: "2026-11-15", status: "confirmed" },
    { eventId: event.id, itemId: unused.id, quantity: 2, windowStart: "2026-10-14", windowEnd: "2026-10-15", status: "released" },
  ]);
  const lists = await db.insert(schema.orderLists).values([
    { fromDate: "2026-11-01", toDate: "2026-11-30" },
    { fromDate: "2026-11-01", toDate: "2026-11-30" },
  ]).returning();
  await db.insert(schema.vendorOrders).values([
    { orderListId: lists[0].id, vendorName: "Example supplier", portalOrderNumber: "EX-1", orderedOn: "2026-11-03", expectedDelivery: "2026-11-10", totalCents: 12000 },
    { orderListId: lists[1].id, vendorName: "Example supplier", portalOrderNumber: "EX-2", orderedOn: "2026-11-20", expectedDelivery: "2026-11-25", totalCents: 3400 },
  ]);
  const report = await operationalReport(db, "2026-11-01", "2026-11-30");
  expect(report.rentals).toEqual([
    { itemId: used.id, name: "Blue chair", reservations: 1, quantity: 3 },
    { itemId: unused.id, name: "White table", reservations: 0, quantity: 0 },
  ]);
  expect(report.orders).toEqual([{ vendor: "Example supplier", month: "2026-11", orders: 2, spendCents: 15400 }]);
});
