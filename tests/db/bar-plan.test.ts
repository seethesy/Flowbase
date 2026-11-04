import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { recomputeItem } from "../../worker/records/allocations";
import { suggestOrderList } from "../../worker/records/order-lists";
import type { RunWithDb } from "../../worker/hono";

// Bar plan (FLOW-170): bar quantities by item and by tier run through the same
// allocation and order list as ingredients (AC1); a tier draws on its items as a
// pool, and its shortage is ordered as the house pick (AC2).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const adminId = "c8170000-0000-4000-8000-000000000001";
const app = createApp({ withDb, resolveActor: async () => ({ userId: adminId, role: "admin", employmentType: "full_time" }) });
const call = async (method: string, path: string, body?: unknown) => {
  const response = await app.request(path, {
    method, ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  }, env);
  return { status: response.status, body: await response.json() };
};
const sectionName = "FLOW-170 bar storage";
const tables = sql`truncate table vendor_orders, order_lists, approval_requests, audit_log, jobs, consumable_allocations, event_requirements, event_bar_tiers, events, clients, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items cascade`;

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values({ id: adminId, email: "admin@bar-plan.example", name: "Admin",
    role: "admin", employmentType: "full_time", status: "active", mobile: "555-0100" })
    .onConflictDoNothing({ target: schema.users.id });
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  await db.delete(schema.users).where(eq(schema.users.id, adminId));
  await client.end();
});

async function section() {
  const [found] = await db.select().from(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  return found ?? (await db.insert(schema.inventorySections).values({ name: sectionName, kind: "consumable" }).returning())[0];
}
// A rail vodka in bottles, sold by the 12-bottle case, with some on hand.
async function vodka(name: string, onHand: number, housePick = false, subcategory = "Vodka") {
  const storage = await section();
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "bar", name,
    category: "Liquor", tier: "rail", unit: "each" }).returning();
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: item.id, purchaseUnit: "case", packCount: 12,
    storageSectionId: storage.id });
  await db.insert(schema.inventoryBarDetails).values({ itemId: item.id, subcategory, container: "bottle", housePick });
  if (onHand) await db.insert(schema.inventoryStock).values({ itemId: item.id, sectionId: storage.id, quantity: onHand });
  return item;
}
async function event(title: string, bookedAt: string, guestCount = 100) {
  let [owner] = await db.select().from(schema.clients).where(eq(schema.clients.name, "Bar client"));
  owner ??= (await db.insert(schema.clients).values({ name: "Bar client", kind: "organization" }).returning())[0];
  return (await db.insert(schema.events).values({ clientId: owner.id, title, guestCount, status: "closed",
    startsAt: new Date("2026-11-20T23:00:00.000Z"), bookedAt: new Date(bookedAt) }).returning())[0];
}
const railVodka = { category: "Liquor", subcategory: "Vodka", tier: "rail", quantity: 12 };

it("saves bar lines by item and by tier and queues their recomputes", async () => {
  const smirnoff = await vodka("Smirnoff", 10, true);
  await vodka("Svedka", 6);
  const gala = await event("Gala", "2026-10-01T12:00:00.000Z");
  const saved = await call("PUT", `/api/events/${gala.id}/bar-plan`, {
    items: [{ itemId: smirnoff.id, quantity: 2 }], tiers: [railVodka],
  });
  expect(saved.status).toBe(200);
  expect(saved.body.items).toMatchObject([{ itemName: "Smirnoff", source: "bar", required: 2 }]);
  expect(saved.body.tiers).toMatchObject([{ category: "Liquor", subcategory: "Vodka", tier: "rail",
    required: 12, allocated: null, items: ["Smirnoff", "Svedka"] }]);
  const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "allocation.recompute_bar"));
  expect(jobs.map((job) => job.payload)).toEqual([{ category: "Liquor", tier: "rail" }]);
  // Bar lines stay off the manual list, and a non-bar item is refused.
  expect((await call("GET", `/api/events/${gala.id}/requirements`)).body.map((line: { source: string }) => line.source)).toEqual(["bar"]);
  const [cream] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "ingredient", name: "Cream", unit: "qt" }).returning();
  expect((await call("PUT", `/api/events/${gala.id}/bar-plan`, { items: [{ itemId: cream.id, quantity: 1 }] })).status).toBe(400);
});

it("allocates a tier against its items in booking order and orders the shortage as the house pick (AC1, AC2)", async () => {
  const smirnoff = await vodka("Smirnoff", 10, true);
  const svedka = await vodka("Svedka", 6);
  const first = await event("First booked", "2026-10-01T12:00:00.000Z");
  const later = await event("Booked later", "2026-10-05T12:00:00.000Z");
  await call("PUT", `/api/events/${first.id}/bar-plan`, { tiers: [railVodka] });
  await call("PUT", `/api/events/${later.id}/bar-plan`, { tiers: [{ ...railVodka, quantity: 10 }] });
  await db.transaction((tx) => recomputeItem(tx, svedka.id));

  expect((await call("GET", `/api/events/${first.id}/bar-plan`)).body.tiers[0])
    .toMatchObject({ allocated: 12, shortage: 0, reorderItemName: "Smirnoff" });
  expect((await call("GET", `/api/events/${later.id}/bar-plan`)).body.tiers[0])
    .toMatchObject({ allocated: 4, shortage: 6, reorderItemName: "Smirnoff", orderBy: "2026-11-20" });
  const allocations = await db.select().from(schema.consumableAllocations)
    .where(and(eq(schema.consumableAllocations.eventId, later.id), isNull(schema.consumableAllocations.archivedAt)));
  expect(allocations.find((row) => row.itemId === smirnoff.id)).toMatchObject({ allocated: 0, shortage: 6 });
  expect(allocations.find((row) => row.itemId === svedka.id)).toMatchObject({ allocated: 4, shortage: 0 });
  // The shortage becomes one order line for the house pick, rounded up to the case.
  expect(await suggestOrderList(db, "2026-11-01", "2026-11-30")).toMatchObject([
    { itemName: "Smirnoff", quantity: 1, purchaseUnit: "case", shortage: 6, eventTitles: ["Booked later"] },
  ]);
});

it("plans a tier per guest and stops allocating when the line is removed", async () => {
  await vodka("Smirnoff", 100, true);
  const gin = await vodka("House gin", 100, false, "Gin");
  const gala = await event("Gala", "2026-10-01T12:00:00.000Z", 50);
  await call("PUT", `/api/events/${gala.id}/bar-plan`, {
    tiers: [{ ...railVodka, basis: "per_guest", quantity: 0.25 }],
  });
  await db.transaction((tx) => recomputeItem(tx, gin.id));
  const plan = (await call("GET", `/api/events/${gala.id}/bar-plan`)).body;
  // Only the vodka draws: the line names a subcategory.
  expect(plan.tiers[0]).toMatchObject({ required: 12.5, allocated: 12.5, shortage: 0, items: ["Smirnoff"] });
  await call("PUT", `/api/events/${gala.id}/bar-plan`, { tiers: [] });
  await db.transaction((tx) => recomputeItem(tx, gin.id));
  const left = await db.select().from(schema.consumableAllocations)
    .where(and(eq(schema.consumableAllocations.eventId, gala.id), isNull(schema.consumableAllocations.archivedAt)));
  expect(left).toEqual([]);
});
