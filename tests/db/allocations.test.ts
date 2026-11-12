import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import { requestRecompute, RECOMPUTE_JOB } from "../../worker/records/allocations";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { EventInput, FlowEvent } from "../../shared/core-records";
import type { ItemAllocationRow, Requirement } from "../../shared/allocation";

// Consumable allocation and projected stock (FLOW-85) against Postgres
// (FLOW-223): the wine fixtures, guest-count changes, the recompute job and the
// stock.moved subscriber. The pure rules are in tests/reservations.test.ts.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const people = {
  admin: "c2240000-0000-4000-8000-000000000001",
  sue: "c2240000-0000-4000-8000-000000000002",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["sue", "salesperson", "full_time"],
];
const as = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const app = createApp({ withDb, resolveActor: async () => ({ userId: people[who], role, employmentType }) });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }, env);
  const send = async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send, get: <T>(path: string) => send<T>("GET", path) };
};
const admin = as("admin");
const sue = as("sue");
const sectionName = "FLOW-223 pantry";
const tables = sql`truncate table jobs, audit_log, consumable_allocations, event_requirements, events, clients, stock_movements, inventory_stock, inventory_consumable_details, inventory_items, vendors cascade`;

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
let clientId = "";
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(directory.map(([name, role, employmentType]) => ({
    id: people[name], email: `${name}@allocations.example`, name, role, employmentType,
    status: "active" as const, mobile: "555-0100",
  }))).onConflictDoNothing({ target: schema.users.id });
  [{ id: clientId }] = await db.insert(schema.clients).values({ name: "Allocation client", kind: "organization" }).returning();
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  await db.delete(schema.users).where(inArray(schema.users.id, Object.values(people)));
  await client.end();
});

// Runs the queued jobs the way the cron does, until none are due.
const drain = async () => {
  const registry = createJobRegistry({ emailProvider: () => undefined });
  for (let i = 0; i < 20; i += 1)
    if (!(await runDueJobs(db, registry, { maxAttempts: 1 })).claimed) return;
};

async function pantry() {
  const [found] = await db.select().from(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  return found ?? (await db.insert(schema.inventorySections).values({ name: sectionName, kind: "consumable" }).returning())[0];
}
// Bottles of wine by the 12-bottle case, ordered from a vendor with a 3-day lead time.
async function wine(onHand: number) {
  const storage = await pantry();
  const [vendor] = await db.insert(schema.vendors)
    .values({ name: "Wine vendor", type: "beverage_distributor", leadTimeDays: 3 }).returning();
  const [item] = await db.insert(schema.inventoryItems)
    .values({ kind: "consumable", subtype: "bar", name: "Pinot Grigio", unit: "each" }).returning();
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: item.id, purchaseUnit: "case", packCount: 12,
    storageSectionId: storage.id, preferredVendorId: vendor.id });
  if (onHand) await db.insert(schema.inventoryStock).values({ itemId: item.id, sectionId: storage.id, quantity: onHand });
  return { itemId: item.id, sectionId: storage.id };
}
async function event(title: string, bookedAt: string, date: string, extra: Partial<EventInput> = {}) {
  const created = await admin.send<FlowEvent>("POST", "/api/events", {
    title, clientId, date, startTime: "17:00", endTime: "22:00", status: "closed", ...extra,
  }, 201);
  await db.update(schema.events).set({ bookedAt: new Date(bookedAt) }).where(eq(schema.events.id, created.id));
  return created;
}
const need = (eventId: string, itemId: string, quantity: number, basis: "fixed" | "per_guest" = "fixed") =>
  admin.send<Requirement[]>("PUT", `/api/events/${eventId}/requirements`, { lines: [{ itemId, quantity, basis }] });
const table = (itemId: string) => admin.get<ItemAllocationRow[]>(`/api/inventory/items/${itemId}/allocations`);

describe("allocations (FLOW-85)", () => {
  it("gives the first-booked event the stock, and reports shortage and order-by for the next (AC1, AC2)", async () => {
    const { itemId } = await wine(100);
    const first = await event("First booked", "2026-10-01T12:00:00.000Z", "2026-12-05");
    const later = await event("Booked later", "2026-10-05T12:00:00.000Z", "2026-12-10");
    await need(later.id, itemId, 60);
    await need(first.id, itemId, 80);
    // Nothing is allocated until the background job has run.
    expect(await table(itemId)).toEqual([]);
    await drain();
    expect(await table(itemId)).toMatchObject([
      { eventTitle: "First booked", required: 80, allocated: 80, shortage: 0, projectedStock: 100, orderBy: null },
      { eventTitle: "Booked later", required: 60, allocated: 20, shortage: 40, projectedStock: 20, orderBy: "2026-12-07" },
    ]);
    expect(await admin.get<Requirement[]>(`/api/events/${later.id}/requirements`))
      .toMatchObject([{ itemId, required: 60, allocated: 20, shortage: 40, orderBy: "2026-12-07" }]);
  });

  it("recomputes when the guest count changes (AC3)", async () => {
    const { itemId } = await wine(1000);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z", "2026-12-05", { guestCount: 150 });
    await need(gala.id, itemId, 2, "per_guest");
    await drain();
    expect(await table(itemId)).toMatchObject([{ required: 300, allocated: 300, shortage: 0 }]);

    const current = await admin.get<FlowEvent>(`/api/events/${gala.id}`);
    await admin.send("PUT", `/api/events/${gala.id}`, {
      title: current.title, date: current.date, startTime: current.startTime, endTime: current.endTime,
      clientId: current.client.id, guestCount: 175, updatedAt: current.updatedAt,
    });
    await drain();
    expect(await table(itemId)).toMatchObject([{ required: 350, allocated: 350, shortage: 0 }]);
  });

  it("queues one recompute per item while one is waiting", async () => {
    const { itemId } = await wine(10);
    await db.transaction(async (tx) => {
      await requestRecompute(tx, itemId);
      await requestRecompute(tx, itemId);
    });
    await db.transaction((tx) => requestRecompute(tx, itemId));
    const waiting = await db.select().from(schema.jobs)
      .where(and(eq(schema.jobs.type, RECOMPUTE_JOB), eq(schema.jobs.status, "pending")));
    expect(waiting).toHaveLength(1);
    expect(waiting[0].payload).toEqual({ itemId });
  });

  it("recomputes when stock moves, through the stock.moved subscriber", async () => {
    const { itemId, sectionId } = await wine(0);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z", "2026-12-05");
    await need(gala.id, itemId, 10);
    await drain();
    expect(await table(itemId)).toMatchObject([{ allocated: 0, shortage: 10 }]);

    await admin.send("POST", `/api/inventory/items/${itemId}/movements`,
      { type: "receive", sectionId, quantity: 10, reason: "Delivery" }, 201);
    // The movement queued the event; the allocation catches up when it runs.
    const queued = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:stock.moved"));
    expect(queued.length).toBeGreaterThan(0);
    expect(await table(itemId)).toMatchObject([{ allocated: 0, shortage: 10 }]);
    await drain();
    expect(await table(itemId)).toMatchObject([{ allocated: 10, shortage: 0, orderBy: null }]);
  });

  it("stops allocating to an event that is Lost", async () => {
    const { itemId } = await wine(100);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z", "2026-12-05");
    await need(gala.id, itemId, 10);
    await drain();
    expect(await table(itemId)).toHaveLength(1);
    await admin.send("POST", `/api/events/${gala.id}/status`, { status: "lost" });
    await drain();
    expect(await table(itemId)).toEqual([]);
  });

  it("hides the title of an event the viewer cannot open", async () => {
    const { itemId } = await wine(100);
    const gala = await event("Private gala", "2026-10-01T12:00:00.000Z", "2026-12-05");
    await need(gala.id, itemId, 10);
    await drain();
    expect(await table(itemId)).toMatchObject([{ eventId: gala.id, eventTitle: "Private gala" }]);
    expect(await sue.get<ItemAllocationRow[]>(`/api/inventory/items/${itemId}/allocations`))
      .toMatchObject([{ eventId: gala.id, eventTitle: null, allocated: 10 }]);
  });
});
