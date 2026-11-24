import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import { suggestOrderList } from "../../../worker/records/inventory/order-lists";
import type { RunWithDb } from "../../../worker/hono";
import { insertItems } from "../../fixtures/inventory-tables";

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
  const app = createApp({ withDb, resolveActor: async () => ({ userId: people[who], role }) });
  const call = (method: string, path: string, body?: unknown) => app.request(path, {
    method, ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  }, env);
  return { call };
};
const admin = as("admin");
const lead = as("lead");
const staff = as("staff");
const tables = sql`truncate table deletions, order_lists, approval_requests, audit_log, jobs, consumable_allocations, event_requirements, event_bar_tiers, event_timeline_entries, payment_schedule_items, payments, events, clients, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, master_inventory_items, bar_inventory_items, kitchen_ingredients cascade`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(Object.entries(people).map(([name, id]) => ({
    id, email: `${name}@order-list.example`, name,
    role: name === "admin" ? "admin" as const : name === "lead" ? "kitchen_lead" as const : "staff" as const, status: "active" as const, mobile: "555-0100",
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
  const [item] = await insertItems(db, { kind: "consumable", subtype: "bar", name: "Wine", unit: "each" });
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
  const [item] = await insertItems(db, { kind: "consumable", subtype: "bar",
    name: "Wine", unit: "each" });
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

// The Order tab's Add to order list (FLOW-292 AC4).
it("adds below-par items to the newest draft list with what they need, replacing their line", async () => {
  const [wine] = await insertItems(db, { kind: "consumable", subtype: "bar", name: "Wine", unit: "each" });
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: wine.id,
    purchaseUnit: "case", packCount: 12, parLevel: 24 });
  const [stocked] = await insertItems(db, { kind: "consumable", subtype: "supply", name: "Napkins", unit: "each" });
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: stocked.id, purchaseUnit: "each", parLevel: null });
  const add = (who: typeof lead, itemIds: string[]) => who.call("POST", "/api/order-lists/draft/lines", { itemIds });
  expect((await add(staff, [wine.id])).status).toBe(403);
  // Nothing selected needs reordering and there's no draft yet.
  const nothing = await add(lead, [stocked.id]);
  expect(nothing.status).toBe(409);
  expect((await nothing.json()).error.code).toBe("NOTHING_TO_ORDER");
  const first = await add(lead, [wine.id]);
  expect(first.status).toBe(200);
  const draft = await first.json();
  expect(draft.status).toBe("draft");
  expect(draft.lines).toMatchObject([{ itemId: wine.id, itemName: "Wine", purchaseUnit: "case", quantity: 2 }]);
  // Adding it again replaces its line on the same list.
  const again = await (await add(lead, [wine.id])).json();
  expect(again.id).toBe(draft.id);
  expect(again.lines).toHaveLength(1);
});

// FLOW-300: the Purchasing tab's Notes, Est. total and Created by, and which
// lists can be deleted.
it("saves a list's notes, sums its estimated cost and names its creator (FLOW-300 AC1)", async () => {
  const [item] = await insertItems(db, { kind: "consumable", subtype: "ingredient",
    name: "Synthetic flour", unit: "lb" });
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: item.id, purchaseUnit: "bag", unitCostCents: 1250 });
  const [uncosted] = await insertItems(db, { kind: "consumable", subtype: "ingredient",
    name: "Synthetic salt", unit: "lb" });
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: uncosted.id, purchaseUnit: "bag" });
  const list = await (await lead.call("POST", "/api/order-lists", { from: "2026-12-01", to: "2026-12-31" })).json();
  const line = (itemId: string, name: string, quantity: number) => ({ itemId, itemName: name, vendorId: null,
    vendorName: "Synthetic vendor", orderingInstructions: "", quantity, purchaseUnit: "bag", shortage: 0,
    orderBy: null, eventIds: [], eventTitles: [], note: "" });
  await lead.call("PUT", `/api/order-lists/${list.id}`, { lines: [line(item.id, "Synthetic flour", 3), line(uncosted.id, "Synthetic salt", 2)] });

  const saved = await lead.call("PATCH", `/api/order-lists/${list.id}`, { notes: "  Deliver to the back door  " });
  expect(saved.status).toBe(200);
  expect((await saved.json()).notes).toBe("Deliver to the back door");
  expect((await staff.call("PATCH", `/api/order-lists/${list.id}`, { notes: "No" })).status).toBe(403);

  const [row] = await (await admin.call("GET", "/api/order-lists")).json();
  expect(row.notes).toBe("Deliver to the back door");
  // 3 bags × $12.50; the uncosted line adds nothing.
  expect(row.estTotalCents).toBe(3750);
  expect(row.createdBy).toEqual({ id: people.lead, name: "lead" });
});

it("deletes only Draft, Rejected and Cancelled lists and skips the rest with a reason (FLOW-300 AC1)", async () => {
  const make = async (status: typeof schema.orderLists.$inferInsert.status) => {
    const [row] = await db.insert(schema.orderLists).values({ fromDate: "2026-12-01", toDate: "2026-12-31", status,
      createdBy: people.lead, updatedBy: people.lead }).returning();
    return row.id;
  };
  const draft = await make("draft");
  const rejected = await make("rejected");
  const cancelled = await make("cancelled");
  const submitted = await make("submitted");
  const ordered = await make("ordered");
  const response = await lead.call("POST", "/api/deletions/order_list", { ids: [draft, rejected, cancelled, submitted, ordered] });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.deleted.sort()).toEqual([draft, rejected, cancelled].sort());
  expect(result.skipped.map((entry: { id: string }) => entry.id).sort()).toEqual([submitted, ordered].sort());
  expect(result.skipped[0].reason).toMatch(/only Draft, Rejected and Cancelled/);
  const left = await (await lead.call("GET", "/api/order-lists")).json();
  expect(left.map((list: { id: string }) => list.id).sort()).toEqual([submitted, ordered].sort());

  // Undo brings a deleted list back.
  expect((await lead.call("POST", "/api/deletions/order_list/restore", { ids: [draft] })).status).toBe(200);
  expect((await lead.call("GET", `/api/order-lists/${draft}`)).status).toBe(200);
  expect((await staff.call("POST", "/api/deletions/order_list", { ids: [rejected] })).status).toBe(403);
});
