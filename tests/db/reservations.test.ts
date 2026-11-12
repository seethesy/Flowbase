import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { EventInput, FlowEvent } from "../../shared/core-records";
import type { Conflict, ItemAvailability, Reservation } from "../../shared/reservations";

// Reservations (FLOW-76), conflicts (FLOW-77) and their resolutions against
// Postgres (FLOW-223). The pure rules are covered in tests/reservations.test.ts.
// `second` is an independent connection for the concurrent-holds race.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const second = postgres(url, { max: 1 });
const secondDb = drizzle(second, { schema });
const env = { ASSETS: { fetch } };
const people = {
  admin: "c2230000-0000-4000-8000-000000000001",
  manager: "c2230000-0000-4000-8000-000000000002",
  sam: "c2230000-0000-4000-8000-000000000003",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
];
const appOn = (database: typeof db) => {
  const withDb: RunWithDb = (_env, run) => run(database);
  const app = createApp({
    withDb,
    resolveActor: async () => ({ userId: people.admin, role: "admin", employmentType: "full_time" }),
  });
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
const admin = appOn(db);
const sectionName = "FLOW-223 warehouse";
const tables = sql`truncate table reservation_conflicts, reservations, jobs, audit_log, events, clients, stock_movements, inventory_stock, inventory_rental_details, inventory_items, vendors cascade`;

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
let clientId = "";
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(directory.map(([name, role, employmentType]) => ({
    id: people[name], email: `${name}@reservations.example`, name, role, employmentType,
    status: "active" as const, mobile: "555-0100",
  }))).onConflictDoNothing({ target: schema.users.id });
  [{ id: clientId }] = await db.insert(schema.clients).values({ name: "Hold client", kind: "organization" }).returning();
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  await db.delete(schema.users).where(inArray(schema.users.id, Object.values(people)));
  await client.end();
  await second.end();
});

async function warehouse() {
  const [found] = await db.select().from(schema.inventorySections).where(eq(schema.inventorySections.name, sectionName));
  return found ?? (await db.insert(schema.inventorySections).values({ name: sectionName, kind: "rental" }).returning())[0];
}
// A rental with `owned` in stock; with a vendor it is rented on request instead.
async function rental(name: string, owned: number, vendorId?: string) {
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "rental", name, unit: "each" }).returning();
  if (vendorId) await db.insert(schema.inventoryRentalDetails).values({ itemId: item.id, vendorId });
  if (owned) await db.insert(schema.inventoryStock).values({ itemId: item.id, sectionId: (await warehouse()).id, quantity: owned });
  return item.id;
}
// Booking order comes from bookedAt (the first signed contract, FLOW-4).
async function event(title: string, bookedAt: string, status: EventInput["status"] = "closed", date = "2026-11-20") {
  const created = await admin.send<FlowEvent>("POST", "/api/events", {
    title, clientId, date, startTime: "17:00", endTime: "22:00", status, assignedSalespersonId: people.sam,
  }, 201);
  await db.update(schema.events).set({ bookedAt: new Date(bookedAt) }).where(eq(schema.events.id, created.id));
  return created;
}
const place = (app: typeof admin, eventId: string, itemId: string, quantity: number) =>
  app.send<Reservation>("POST", `/api/events/${eventId}/reservations`, { itemId, quantity }, 201);
const holdsOf = (eventId: string) => admin.get<Reservation[]>(`/api/events/${eventId}/reservations`);
const conflictsOf = (eventId: string, query = "") => admin.get<Conflict[]>(`/api/events/${eventId}/conflicts${query}`);
const conflictJobs = () => db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:inventory.conflict_detected"));

// 100 plates; A booked first holds 80, B booked later holds 60 (FLOW-76 AC3).
async function overbook() {
  const plates = await rental("Dinner plates", 100);
  const first = await event("Booked first", "2026-10-01T12:00:00.000Z");
  const later = await event("Booked later", "2026-10-05T12:00:00.000Z");
  await place(admin, first.id, plates, 80);
  const hold = await place(admin, later.id, plates, 60);
  const [conflict] = await conflictsOf(later.id);
  return { plates, first, later, hold, conflict };
}
const resolve = (conflictId: string, body: unknown, status = 200) =>
  admin.send<Conflict>("POST", `/api/reservation-conflicts/${conflictId}/resolve`, body, status);

describe("holds (FLOW-76)", () => {
  it("places, resizes and releases a hold, windowed by the event and the item's buffer", async () => {
    const plates = await rental("Dinner plates", 100);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z", "inquiry");
    const placed = await place(admin, gala.id, plates, 80);
    // The event is on Nov 20; the default buffer is one day either side.
    expect(placed).toMatchObject({ itemId: plates, quantity: 80, status: "tentative",
      windowStart: "2026-11-19", windowEnd: "2026-11-21", allocated: 80, shortfall: 0, issue: null });
    // Placing again replaces the quantity of the event's hold on that item.
    await place(admin, gala.id, plates, 60);
    expect(await holdsOf(gala.id)).toMatchObject([{ id: placed.id, quantity: 60 }]);
    expect(await admin.send<Reservation>("PATCH", `/api/reservations/${placed.id}`, { quantity: 40 }))
      .toMatchObject({ id: placed.id, quantity: 40 });

    expect((await admin.call("DELETE", `/api/reservations/${placed.id}`)).status).toBe(204);
    expect(await holdsOf(gala.id)).toEqual([]);
    const [row] = await db.select().from(schema.reservations).where(eq(schema.reservations.id, placed.id));
    expect(row.archivedAt).not.toBeNull();
    const audit = await db.select({ action: schema.auditLog.action }).from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "reservation"), eq(schema.auditLog.entityId, placed.id)));
    expect(audit.map((entry) => entry.action).sort()).toEqual(["archive", "create", "update", "update"]);
  });

  it("follows the event's status: tentative, confirmed at Closed, released at Lost", async () => {
    const plates = await rental("Dinner plates", 100);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z", "inquiry");
    await place(admin, gala.id, plates, 10);
    expect((await holdsOf(gala.id))[0].status).toBe("tentative");
    await admin.send("POST", `/api/events/${gala.id}/status`, { status: "closed" });
    expect((await holdsOf(gala.id))[0].status).toBe("confirmed");
    await admin.send("POST", `/api/events/${gala.id}/status`, { status: "lost" });
    expect((await holdsOf(gala.id))[0].status).toBe("released");
    // A Lost event doesn't take new holds.
    const refused = await admin.call("POST", `/api/events/${gala.id}/reservations`, { itemId: plates, quantity: 5 });
    expect(refused.status).toBe(409);
  });

  it("moves the hold's window when the event's date changes", async () => {
    const plates = await rental("Dinner plates", 100);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z", "inquiry");
    await place(admin, gala.id, plates, 10);
    const current = await admin.get<FlowEvent>(`/api/events/${gala.id}`);
    await admin.send("PUT", `/api/events/${gala.id}`, {
      title: current.title, date: "2026-12-05", startTime: current.startTime, endTime: current.endTime,
      clientId: current.client.id, assignedSalespersonId: people.sam, updatedAt: current.updatedAt,
    });
    expect((await holdsOf(gala.id))[0]).toMatchObject({ windowStart: "2026-12-04", windowEnd: "2026-12-06" });
  });

  it("frees an archived event's holds and takes them back when it is restored", async () => {
    const plates = await rental("Dinner plates", 100);
    const gala = await event("Gala", "2026-10-01T12:00:00.000Z");
    await place(admin, gala.id, plates, 80);
    const availability = () => admin.get<ItemAvailability>(
      `/api/inventory/items/${plates}/availability?from=2026-11-19&to=2026-11-21`);
    expect(await availability()).toMatchObject({ owned: 100, available: 20 });
    await admin.send("POST", `/api/events/${gala.id}/archive`);
    expect(await availability()).toMatchObject({ available: 100, holds: [] });
    await admin.send("POST", `/api/events/${gala.id}/restore`);
    expect(await availability()).toMatchObject({ available: 20 });
  });
});

describe("conflicts (FLOW-77)", () => {
  it("leaves the later-booked hold 40 short of 100 plates after 80 then 60 (AC3 fixture)", async () => {
    const { plates, first, later, hold } = await overbook();
    expect(hold).toMatchObject({ quantity: 60, allocated: 20, shortfall: 40, issue: "conflict" });
    expect(await conflictsOf(first.id)).toEqual([]);
    expect(await conflictsOf(later.id)).toMatchObject([{ itemId: plates, eventTitle: "Booked later", kind: "conflict",
      state: "open", quantity: 60, allocated: 20, shortfall: 40 }]);
    expect(await admin.get<Conflict[]>(`/api/inventory/items/${plates}/conflicts`)).toHaveLength(1);
  });

  it("notifies once per change of situation, and not when it clears", async () => {
    const { later, hold, plates } = await overbook();
    const jobs = await conflictJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ itemId: plates, eventId: later.id });
    expect((jobs[0].payload as { recipientIds: string[] }).recipientIds).toEqual(expect.arrayContaining([people.manager, people.sam]));

    // The same figures again change nothing.
    await admin.send("PATCH", `/api/reservations/${hold.id}`, { quantity: 60 });
    expect(await conflictJobs()).toHaveLength(1);
    // A different shortfall is a new situation.
    await admin.send("PATCH", `/api/reservations/${hold.id}`, { quantity: 70 });
    expect(await conflictJobs()).toHaveLength(2);
    expect(await conflictsOf(later.id)).toMatchObject([{ state: "open", shortfall: 50 }]);
    // Shrinking it to fit clears the conflict without another notification.
    await admin.send("PATCH", `/api/reservations/${hold.id}`, { quantity: 20 });
    expect(await conflictJobs()).toHaveLength(2);
    expect(await conflictsOf(later.id)).toEqual([]);
    expect(await conflictsOf(later.id, "?state=resolved")).toMatchObject([{ resolution: { method: "cleared" } }]);
  });

  it("resolves by adjusting the quantity (AC2)", async () => {
    const { later, hold, conflict } = await overbook();
    expect(await resolve(conflict.id, { method: "adjust", quantity: 20 })).toMatchObject({
      state: "resolved", resolvedBy: people.admin, resolution: { method: "adjust", quantity: 20 } });
    expect((await holdsOf(later.id))[0]).toMatchObject({ id: hold.id, quantity: 20, shortfall: 0 });
    // Already resolved: a second resolution is refused.
    expect((await admin.call("POST", `/api/reservation-conflicts/${conflict.id}/resolve`,
      { method: "adjust", quantity: 10 })).status).toBe(409);
  });

  it("resolves by moving the short quantity to a substitute", async () => {
    const { plates, later, conflict } = await overbook();
    const salad = await rental("Salad plates", 100);
    expect((await admin.call("POST", `/api/reservation-conflicts/${conflict.id}/resolve`,
      { method: "substitute", itemId: plates })).status).toBe(400);
    expect(await resolve(conflict.id, { method: "substitute", itemId: salad, note: "Same size" })).toMatchObject({
      state: "resolved", resolution: { method: "substitute", itemId: salad, itemName: "Salad plates", quantity: 40, note: "Same size" } });
    const holds = await holdsOf(later.id);
    expect(Object.fromEntries(holds.map((hold) => [hold.itemId, hold.quantity]))).toEqual({ [plates]: 20, [salad]: 40 });
    expect(holds.every((hold) => hold.shortfall === 0)).toBe(true);
  });

  it("resolves by renting the short quantity from a vendor, never from an owned item", async () => {
    const { plates, later, conflict } = await overbook();
    const [vendor] = await db.insert(schema.vendors).values({ name: "Party rentals", type: "rental_vendor" }).returning();
    const rented = await rental("Rented plates", 0, vendor.id);
    const owned = await rental("Salad plates", 100);
    expect((await admin.call("POST", `/api/reservation-conflicts/${conflict.id}/resolve`,
      { method: "sub_rent", itemId: owned })).status).toBe(400);
    expect(await resolve(conflict.id, { method: "sub_rent", itemId: rented })).toMatchObject({
      state: "resolved", resolution: { method: "sub_rent", itemId: rented, quantity: 40 } });
    const holds = await holdsOf(later.id);
    expect(Object.fromEntries(holds.map((hold) => [hold.itemId, hold.quantity]))).toEqual({ [plates]: 20, [rented]: 40 });
    // Available on request: the vendor hold is never short.
    expect(holds.find((hold) => hold.itemId === rented)).toMatchObject({ allocated: 40, shortfall: 0 });
  });

  it("accepts the risk with a note, keeping the conflict listed and not notifying again", async () => {
    const { later, conflict } = await overbook();
    expect((await admin.call("POST", `/api/reservation-conflicts/${conflict.id}/resolve`,
      { method: "accept_risk", note: "" })).status).toBe(400);
    expect(await resolve(conflict.id, { method: "accept_risk", note: "Borrowing 40 from the venue" })).toMatchObject({
      state: "accepted", resolvedBy: people.admin, resolution: { method: "accept_risk", note: "Borrowing 40 from the venue" } });
    expect(await conflictsOf(later.id)).toMatchObject([{ id: conflict.id, state: "accepted" }]);
    expect(await conflictJobs()).toHaveLength(1);
  });

  it("keeps two simultaneous holds on one item from over-allocating it", async () => {
    const plates = await rental("Dinner plates", 100);
    const first = await event("Booked first", "2026-10-01T12:00:00.000Z");
    const later = await event("Booked later", "2026-10-05T12:00:00.000Z");
    const other = appOn(secondDb);
    const results = await Promise.all([
      admin.call("POST", `/api/events/${first.id}/reservations`, { itemId: plates, quantity: 70 }),
      other.call("POST", `/api/events/${later.id}/reservations`, { itemId: plates, quantity: 70 }),
    ]);
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    // Whichever committed first, the later-booked event is the short one.
    expect(await admin.get<Conflict[]>(`/api/inventory/items/${plates}/conflicts`)).toMatchObject([
      { eventId: later.id, allocated: 30, shortfall: 40 } ]);
    const open = await db.select().from(schema.reservationConflicts)
      .where(and(eq(schema.reservationConflicts.itemId, plates), isNull(schema.reservationConflicts.archivedAt)));
    expect(open).toHaveLength(1);
    expect(await conflictJobs()).toHaveLength(1);
  });
});
