import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { suggestOrderList } from "../../worker/records/order-lists";
import type { RunWithDb } from "../../worker/hono";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const people = {
  admin: "c8600000-0000-4000-8000-000000000001",
  lead: "c8600000-0000-4000-8000-000000000002",
  staff: "c8600000-0000-4000-8000-000000000003",
};
const as = (who: keyof typeof people) => {
  const role = who === "admin" ? "admin" as const : who === "lead" ? "kitchen_lead" as const : "staff" as const;
  const app = createApp({ withDb, resolveActor: async () => ({ userId: people[who], role, employmentType: "full_time" }) });
  const call = (method: string, path: string, body?: unknown) => app.request(path, {
    method, ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  }, env);
  return { call };
};
const admin = as("admin");
const lead = as("lead");
const staff = as("staff");
const tables = sql`truncate table order_lists, approval_requests, audit_log, jobs, consumable_allocations, event_requirements, events, clients, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items cascade`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(Object.entries(people).map(([name, id]) => ({
    id, email: `${name}@order-list.example`, name,
    role: name === "admin" ? "admin" as const : name === "lead" ? "kitchen_lead" as const : "staff" as const,
    employmentType: "full_time" as const, status: "active" as const, mobile: "555-0100",
  }))).onConflictDoNothing({ target: schema.users.id });
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.vendors).where(eq(schema.vendors.name, "Wine vendor"));
  await db.delete(schema.users).where(sql`${schema.users.id} in (${sql.join(Object.values(people).map((id) => sql`${id}`), sql`, `)})`);
  await client.end();
});

it("builds, edits and submits one order list approval, locking edits until a decision", async () => {
  expect((await staff.call("POST", "/api/order-lists", { from: "2026-11-01", to: "2026-11-30" })).status).toBe(403);
  const created = await lead.call("POST", "/api/order-lists", { from: "2026-11-01", to: "2026-11-30" });
  expect(created.status).toBe(201);
  const list = await created.json();
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "bar", name: "Wine", unit: "each" }).returning();
  const line = { itemId: item.id, itemName: "Wine", vendorId: null, vendorName: "Wine vendor",
    orderingInstructions: "Call by noon", quantity: 1, purchaseUnit: "case", shortage: 10,
    orderBy: "2026-11-02", eventIds: [], eventTitles: ["Gala"], note: "" };
  expect((await lead.call("PUT", `/api/order-lists/${list.id}`, { lines: [line] })).status).toBe(200);
  const submitted = await lead.call("POST", `/api/order-lists/${list.id}/submit`);
  expect(submitted.status).toBe(200);
  const after = await submitted.json();
  expect(after.status).toBe("submitted");
  expect(after.approvalId).toBeTruthy();
  expect((await lead.call("PUT", `/api/order-lists/${list.id}`, { lines: [] })).status).toBe(409);
  const approvals = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.subjectId, list.id));
  expect(approvals).toHaveLength(1);
  expect((await admin.call("POST", `/api/approvals/${after.approvalId}/reject`, { comment: "Change supplier" })).status).toBe(200);
  expect((await lead.call("PUT", `/api/order-lists/${list.id}`, { lines: [line] })).status).toBe(200);
});

it("builds a purchase line from shortages in the selected event date range", async () => {
  const [vendor] = await db.insert(schema.vendors).values({ name: "Wine vendor", type: "beverage_distributor",
    orderingInstructions: "Call by noon" }).returning();
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "bar",
    name: "Wine", unit: "each" }).returning();
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: item.id,
    purchaseUnit: "case", packCount: 12, preferredVendorId: vendor.id });
  const [clientRow] = await db.insert(schema.clients).values({ name: "Gala client", kind: "organization" }).returning();
  const [event] = await db.insert(schema.events).values({ clientId: clientRow.id, title: "Fall gala",
    startsAt: new Date("2026-11-14T23:00:00.000Z"), status: "closed" }).returning();
  await db.insert(schema.consumableAllocations).values({ eventId: event.id, itemId: item.id,
    required: 10, allocated: 0, shortage: 10, projectedStock: 0,
    orderBy: "2026-11-10", computedAt: new Date() });
  expect(await suggestOrderList(db, "2026-11-01", "2026-11-30")).toMatchObject([{
    itemName: "Wine", vendorName: "Wine vendor", orderingInstructions: "Call by noon",
    quantity: 1, purchaseUnit: "case", eventTitles: ["Fall gala"], orderBy: "2026-11-10",
  }]);
  expect(await suggestOrderList(db, "2026-12-01", "2026-12-31")).toEqual([]);
});
