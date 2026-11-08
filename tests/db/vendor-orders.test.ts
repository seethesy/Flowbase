import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { recomputeItem } from "../../worker/records/allocations";
import type { RunWithDb } from "../../worker/hono";

// Ordering record (FLOW-87) and receiving (FLOW-88).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const people = {
  admin: "c8700000-0000-4000-8000-000000000001",
  lead: "c8700000-0000-4000-8000-000000000002",
};
const as = (who: keyof typeof people) => {
  const role = who === "admin" ? "admin" as const : "kitchen_lead" as const;
  const app = createApp({ withDb, resolveActor: async () => ({ userId: people[who], role, employmentType: "full_time" }) });
  return async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, {
      method, ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }, env);
    return { status: response.status, body: await response.json() };
  };
};
const admin = as("admin");
const lead = as("lead");
const sectionName = "FLOW-88 walk-in";
const tables = sql`truncate table vendor_orders, order_lists, approval_requests, audit_log, jobs, consumable_allocations, event_requirements, event_bar_tiers, event_timeline_entries, payment_schedule_items, payments, events, clients, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items cascade`;

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(Object.entries(people).map(([name, id]) => ({
    id, email: `${name}@vendor-orders.example`, name,
    role: name === "admin" ? "admin" as const : "kitchen_lead" as const,
    employmentType: "full_time" as const, status: "active" as const, mobile: "555-0100",
  }))).onConflictDoNothing({ target: schema.users.id });
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  await db.delete(schema.users).where(sql`${schema.users.id} in (${sql.join(Object.values(people).map((id) => sql`${id}`), sql`, `)})`);
  await client.end();
});

// A case of 12 wine bottles at $120, stored in the walk-in, and an approved list
// ordering 3 cases of it from "Wine vendor".
async function approvedList() {
  let [section] = await db.select().from(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  section ??= (await db.insert(schema.inventorySections).values({ name: sectionName, kind: "consumable" }).returning())[0];
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "bar", name: "Pinot Grigio", unit: "each" }).returning();
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: item.id, purchaseUnit: "case", packCount: 12,
    unitCostCents: 12000, storageSectionId: section.id });
  const line = { itemId: item.id, itemName: "Pinot Grigio", vendorId: null, vendorName: "Wine vendor",
    orderingInstructions: "", quantity: 3, purchaseUnit: "case", shortage: 36, orderBy: null,
    eventIds: [], eventTitles: [], note: "" };
  const created = await lead("POST", "/api/order-lists", { from: "2026-11-01", to: "2026-11-30" });
  await lead("PUT", `/api/order-lists/${created.body.id}`, { lines: [line] });
  const submitted = await lead("POST", `/api/order-lists/${created.body.id}/submit`);
  expect((await admin("POST", `/api/approvals/${submitted.body.approvalId}/approve`, {})).status).toBe(200);
  return { listId: created.body.id as string, itemId: item.id, sectionId: section.id };
}
const order = { vendorName: "Wine vendor", portalOrderNumber: "WV-4471", orderedOn: "2026-11-03",
  expectedDelivery: "2026-11-10", totalCents: 36000 };
const stockOf = async (itemId: string) =>
  Number((await db.select({ total: sql<string>`coalesce(sum(${schema.inventoryStock.quantity}), 0)` })
    .from(schema.inventoryStock).where(eq(schema.inventoryStock.itemId, itemId)))[0].total);

it("records a portal order only for Admin, with the order number and expected delivery (FLOW-87 AC1)", async () => {
  const { listId } = await approvedList();
  expect((await lead("POST", `/api/order-lists/${listId}/orders`, order)).status).toBe(403);
  expect((await admin("POST", `/api/order-lists/${listId}/orders`, { ...order, portalOrderNumber: "" })).status).toBe(400);
  expect((await admin("POST", `/api/order-lists/${listId}/orders`, { ...order, expectedDelivery: undefined })).status).toBe(400);
  const recorded = await admin("POST", `/api/order-lists/${listId}/orders`, order);
  expect(recorded.status).toBe(201);
  expect(recorded.body.status).toBe("ordered");
  expect(recorded.body.orders).toMatchObject([{ portalOrderNumber: "WV-4471", status: "ordered",
    expectedDelivery: "2026-11-10", totalCents: 36000, lines: [{ ordered: 3, approvedQuantity: 3, received: 0 }] }]);
  // One order per vendor, and the list's lines are fixed once it is ordered.
  expect((await admin("POST", `/api/order-lists/${listId}/orders`, order)).status).toBe(409);
  expect((await lead("PUT", `/api/order-lists/${listId}`, { lines: [] })).status).toBe(409);
});

it("records changes from the approved lines", async () => {
  const { listId, itemId } = await approvedList();
  const recorded = await admin("POST", `/api/order-lists/${listId}/orders`, { ...order, notes: "Portal capped at 2",
    lines: [{ itemId, ordered: 2 }] });
  expect(recorded.body.orders[0]).toMatchObject({ notes: "Portal capped at 2", lines: [{ approvedQuantity: 3, ordered: 2 }] });
});

it("counts ordered quantities as on order in projected stock from the expected delivery date (FLOW-87 AC2)", async () => {
  const { listId, itemId } = await approvedList();
  const [clientRow] = await db.insert(schema.clients).values({ name: "Gala client", kind: "organization" }).returning();
  const event = async (title: string, startsAt: string, bookedAt: string) => (await db.insert(schema.events).values({
    clientId: clientRow.id, title, startsAt: new Date(startsAt), status: "closed", bookedAt: new Date(bookedAt),
  }).returning())[0];
  const early = await event("Before delivery", "2026-11-08T23:00:00.000Z", "2026-10-01T12:00:00.000Z");
  const late = await event("After delivery", "2026-11-14T23:00:00.000Z", "2026-10-02T12:00:00.000Z");
  await db.insert(schema.eventRequirements).values([early, late].map((row) => ({ eventId: row.id, itemId, quantity: 24 })));
  const shortages = async () => {
    await db.transaction((tx) => recomputeItem(tx, itemId));
    const rows = await db.select().from(schema.consumableAllocations).where(eq(schema.consumableAllocations.itemId, itemId));
    return Object.fromEntries(rows.map((row) => [row.eventId === early.id ? "early" : "late", row.shortage]));
  };
  expect(await shortages()).toEqual({ early: 24, late: 24 });
  await admin("POST", `/api/order-lists/${listId}/orders`, order);
  // 3 cases = 36 bottles due Nov 10: too late for Nov 8, in time for Nov 14.
  expect(await shortages()).toEqual({ early: 24, late: 0 });
  const recompute = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "allocation.recompute"));
  expect(recompute.length).toBeGreaterThan(0);
});

it("receives 2 of 3 cases into storage as a partial delivery with the actual cost (FLOW-88 AC1, AC2)", async () => {
  const { listId, itemId, sectionId } = await approvedList();
  const recorded = await admin("POST", `/api/order-lists/${listId}/orders`, order);
  const orderId = recorded.body.orders[0].id as string;
  const received = await lead("POST", `/api/order-lists/${listId}/orders/${orderId}/receive`, {
    lines: [{ itemId, quantity: 2, unitCostCents: 12600, note: "1 case short" }],
  });
  expect(received.status).toBe(200);
  expect(received.body.status).toBe("partially_received");
  expect(received.body.orders[0]).toMatchObject({ status: "partially_received",
    lines: [{ received: 2, note: "1 case short" }] });
  expect(await stockOf(itemId)).toBe(24);
  const [movement] = await db.select().from(schema.stockMovements).where(eq(schema.stockMovements.itemId, itemId));
  expect(movement).toMatchObject({ type: "receive", quantity: 24, sectionId, linkType: "order", linkId: orderId });
  const [detail] = await db.select().from(schema.inventoryConsumableDetails).where(eq(schema.inventoryConsumableDetails.itemId, itemId));
  expect(detail.unitCostCents).toBe(12600);
  expect(await db.select().from(schema.inventoryCostHistory).where(eq(schema.inventoryCostHistory.itemId, itemId)))
    .toMatchObject([{ previousCents: 12000, unitCostCents: 12600, source: "receiving" }]);

  const rest = await lead("POST", `/api/order-lists/${listId}/orders/${orderId}/receive`, {
    lines: [{ itemId, quantity: 1 }],
  });
  expect(rest.body.status).toBe("received");
  expect(rest.body.orders[0].receipts).toHaveLength(2);
  expect(await stockOf(itemId)).toBe(36);
  // The same cost again isn't a change.
  expect(await db.select().from(schema.inventoryCostHistory).where(eq(schema.inventoryCostHistory.itemId, itemId))).toHaveLength(1);
  const [done] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:order.received"));
  expect(done).toBeTruthy();
  expect((await lead("POST", `/api/order-lists/${listId}/orders/${orderId}/receive`, { lines: [{ itemId, quantity: 1 }] })).status).toBe(409);
});

it("closes a short order when nothing more is coming, and stops counting it as on order", async () => {
  const { listId, itemId } = await approvedList();
  const orderId = (await admin("POST", `/api/order-lists/${listId}/orders`, order)).body.orders[0].id;
  const closed = await lead("POST", `/api/order-lists/${listId}/orders/${orderId}/receive`, {
    lines: [{ itemId, quantity: 2, note: "Last case back-ordered" }], complete: true,
  });
  expect(closed.body.orders[0].status).toBe("received");
  const open = await db.select().from(schema.vendorOrders)
    .where(and(eq(schema.vendorOrders.id, orderId), eq(schema.vendorOrders.status, "ordered")));
  expect(open).toEqual([]);
});

it("refuses to receive an item with no storage section, leaving stock and the order unchanged", async () => {
  const { listId, itemId } = await approvedList();
  await db.update(schema.inventoryConsumableDetails).set({ storageSectionId: null })
    .where(eq(schema.inventoryConsumableDetails.itemId, itemId));
  const orderId = (await admin("POST", `/api/order-lists/${listId}/orders`, order)).body.orders[0].id;
  const refused = await lead("POST", `/api/order-lists/${listId}/orders/${orderId}/receive`, { lines: [{ itemId, quantity: 1 }] });
  expect(refused.status).toBe(409);
  expect(await stockOf(itemId)).toBe(0);
  const [row] = await db.select().from(schema.vendorOrders).where(eq(schema.vendorOrders.id, orderId));
  expect(row.status).toBe("ordered");
});

it("cancels an order nothing has arrived for, and the list when every vendor's order is cancelled", async () => {
  const { listId } = await approvedList();
  const orderId = (await admin("POST", `/api/order-lists/${listId}/orders`, order)).body.orders[0].id;
  expect((await lead("POST", `/api/order-lists/${listId}/orders/${orderId}/cancel`)).status).toBe(403);
  const cancelled = await admin("POST", `/api/order-lists/${listId}/orders/${orderId}/cancel`);
  expect(cancelled.body.orders[0].status).toBe("cancelled");
  expect(cancelled.body.status).toBe("cancelled");
});
