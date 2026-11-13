import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import { syncProposalRentalHolds } from "../../worker/records/reservations";
import { applyMatchingProductionTemplates } from "../../worker/records/task-templates";
import { suggestOrderList } from "../../worker/records/order-lists";
import type { Actor, Role } from "../../shared/access";
import type { Closeout } from "../../shared/closeout";
import type { PullList } from "../../shared/pull-list";
import type { ProposalMapping } from "../../shared/proposal-mapping";
import type { Conflict, ItemAvailability, Reservation } from "../../shared/reservations";

// Kits, services and supplies in event workflows (FLOW-212, FLOW-213, FLOW-214)
// against the real database: holds, conflicts, pull lists, closeout, task templates
// and order suggestions.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c0000000-0000-4000-8000-000000000001",
  sam: "c0000000-0000-4000-8000-000000000003",
};
const adminActor: Actor = { userId: people.admin, role: "admin", employmentType: "full_time" };
const as = (userId: string, role: Role) => {
  const app = createApp({ withDb, resolveActor: async () => ({ userId, role, employmentType: "full_time" }) });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
  return {
    call,
    send: async <T>(method: string, path: string, body?: unknown, status = 200) => {
      const response = await call(method, path, body);
      expect(response.status, await response.clone().text()).toBe(status);
      return (status === 204 ? undefined : await response.json()) as T;
    },
  };
};
const admin = as(people.admin, "admin");
const sam = as(people.sam, "salesperson");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
// The stock ledger is append-only, so its rows go with the truncate.
const made = { items: [] as string[] };
const clean = async () => {
  await db.execute(
    sql`truncate table closeout_lines, event_closeouts, day_of_updates, day_of_checkpoints, day_of_staff_states, truck_assignments, event_planning_outputs, notifications, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, stock_count_lines, stock_counts, stock_movements, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
  await db.delete(schema.taskAssignees);
  await db.delete(schema.tasks);
  await db.delete(schema.taskTemplateItems);
  await db.delete(schema.taskTemplates);
  if (made.items.length) {
    await db.delete(schema.inventoryStock).where(inArray(schema.inventoryStock.itemId, made.items));
    await db.delete(schema.inventoryRentalDetails).where(inArray(schema.inventoryRentalDetails.itemId, made.items));
    await db.delete(schema.inventoryConsumableDetails).where(inArray(schema.inventoryConsumableDetails.itemId, made.items));
    await db.delete(schema.inventoryServiceDetails).where(inArray(schema.inventoryServiceDetails.itemId, made.items));
    await db.delete(schema.inventoryItems).where(inArray(schema.inventoryItems.id, made.items));
  }
  made.items = [];
};
beforeEach(clean);
afterAll(async () => {
  await clean();
  await client.end();
});

const section = async (kind: "rental" | "consumable") => {
  const [row] = await db
    .select()
    .from(schema.inventorySections)
    .where(and(eq(schema.inventorySections.kind, kind), isNull(schema.inventorySections.archivedAt), sql`${schema.inventorySections.name} <> 'Vendor'`))
    .limit(1);
  return row;
};
const rental = async (name: string, subtype: string, stock: number, components: { itemId: string; quantity: number }[] = []) => {
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "rental", subtype, name }).returning();
  made.items.push(item.id);
  await db.insert(schema.inventoryRentalDetails).values({ itemId: item.id, components });
  if (stock) await db.insert(schema.inventoryStock).values({ itemId: item.id, sectionId: (await section("rental")).id, quantity: stock });
  return item;
};
const consumable = async (name: string, stock: number, parLevel: number | null = null) => {
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "supply", name, unit: "each" }).returning();
  made.items.push(item.id);
  await db.insert(schema.inventoryConsumableDetails).values({ itemId: item.id, purchaseUnit: "each", parLevel });
  if (stock) await db.insert(schema.inventoryStock).values({ itemId: item.id, sectionId: (await section("consumable")).id, quantity: stock });
  return item;
};
const service = async (name: string, includes: { itemId: string; quantity: number; basis: "per_guest" | "per_event" }[]) => {
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "service", name }).returning();
  made.items.push(item.id);
  await db.insert(schema.inventoryServiceDetails).values({ itemId: item.id, includes });
  return item;
};

// The Centerpiece Candle Set: one glass hurricane (a rental, 6 owned) and one taper
// candle (a consumable) per set.
const candleSet = async (hurricanes = 6) => {
  const hurricane = await rental("Glass hurricane", "glassware", hurricanes);
  const candle = await consumable("Taper candle", 50);
  const kit = await rental("Centerpiece Candle Set", "decor", 0, [
    { itemId: hurricane.id, quantity: 1 },
    { itemId: candle.id, quantity: 1 },
  ]);
  return { hurricane, candle, kit };
};

type Line = ProposalMapping["lines"][number];
const line = (id: string, kind: Line["kind"], name: string, extra: Partial<Line> = {}): Line => ({
  id, kind, section: "", name, notes: "", quantity: null, sourceBlockId: null, catalogId: null, notTracked: false, ...extra,
});
const mappingOf = (versionId: string, lines: Line[]): ProposalMapping => ({
  versionId, totalCents: null, fields: {}, lines, staffing: [], timeline: [], charges: [], paymentSchedule: [], unextractedBlockIds: [],
});

async function eventWith(lines: Line[], { status = "closed", guests = 80 }: { status?: "closed" | "negotiation"; guests?: number } = {}) {
  const [owner] = await db.insert(schema.clients).values({ name: "Juniper & Co.", kind: "organization" }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({
      clientId: owner.id,
      title: "Juniper holiday party",
      guestCount: guests,
      status,
      assignedSalespersonId: people.sam,
      startsAt: new Date("2026-12-12T23:00:00.000Z"),
    })
    .returning();
  const [proposal] = await db
    .insert(schema.proposals)
    .values({ eventId: event.id, clientId: owner.id, title: "Holiday", stage: "signed" })
    .returning();
  const [version] = await db
    .insert(schema.proposalVersions)
    .values({
      proposalId: proposal.id, number: 1, status: "ready", completedAt: new Date(),
      docx: { key: "k", fileName: "p.docx", contentType: "application/octet-stream", size: 1 },
    })
    .returning();
  await db.update(schema.proposals).set({ currentVersionId: version.id }).where(eq(schema.proposals.id, proposal.id));
  const data = mappingOf(version.id, lines);
  await db.insert(schema.proposalMappings).values({ proposalId: proposal.id, versionId: version.id, data });
  return { event, proposal, data };
}

const runJobs = async () => {
  const registry = createJobRegistry();
  await runDueJobs(db, registry, { maxAttempts: 1 });
  await runDueJobs(db, registry, { maxAttempts: 1 });
};
const startPlanning = async (eventId: string) => {
  await sam.send("POST", `/api/events/${eventId}/planning/start`);
  await runJobs();
};
const pullLines = async (eventId: string) =>
  (await admin.send<PullList>("GET", `/api/events/${eventId}/pull-list`)).groups.flatMap((group) => group.lines);
const holdsOf = (eventId: string) =>
  db.select().from(schema.reservations).where(and(eq(schema.reservations.eventId, eventId), isNull(schema.reservations.archivedAt)));
const requirementsOf = (eventId: string, source: string) =>
  db.select().from(schema.eventRequirements).where(and(
    eq(schema.eventRequirements.eventId, eventId), eq(schema.eventRequirements.source, source), isNull(schema.eventRequirements.archivedAt),
  ));

describe("decor kits (FLOW-212)", () => {
  it("reserving 10 Centerpiece Candle Sets reserves 10 of each component (AC1)", async () => {
    const { hurricane, candle, kit } = await candleSet(20);
    const { event } = await eventWith([]);
    const placed = await admin.send<Reservation>("POST", `/api/events/${event.id}/reservations`, { itemId: kit.id, quantity: 10 }, 201);
    expect(placed).toMatchObject({ itemName: "Centerpiece Candle Set", quantity: 10, allocated: 10, shortfall: 0, issue: null });

    const rows = await holdsOf(event.id);
    const part = rows.find((row) => row.itemId === hurricane.id);
    expect(part).toMatchObject({ quantity: 10, kitReservationId: placed.id, status: "confirmed" });
    expect(rows).toHaveLength(2);
    // The candles are a requirement of the event, not a hold.
    expect((await requirementsOf(event.id, "kit")).map((row) => [row.itemId, row.quantity])).toEqual([[candle.id, 10]]);
    // The hub lists the kit; its parts stand behind it.
    const listed = await admin.send<Reservation[]>("GET", `/api/events/${event.id}/reservations`);
    expect(listed.map((hold) => hold.itemName)).toEqual(["Centerpiece Candle Set"]);

    // Changing the kit's quantity moves its parts; the parts aren't edited directly.
    await admin.send("PATCH", `/api/reservations/${placed.id}`, { quantity: 12 });
    expect((await holdsOf(event.id)).find((row) => row.itemId === hurricane.id)?.quantity).toBe(12);
    expect((await requirementsOf(event.id, "kit"))[0].quantity).toBe(12);
    const direct = await admin.call("PATCH", `/api/reservations/${part!.id}`, { quantity: 3 });
    expect(direct.status).toBe(409);
    // A separate hold on the same glassware stays its own.
    await admin.send("POST", `/api/events/${event.id}/reservations`, { itemId: hurricane.id, quantity: 2 }, 201);
    expect((await holdsOf(event.id)).filter((row) => row.itemId === hurricane.id).map((row) => row.quantity).sort()).toEqual([12, 2]);

    // Releasing the kit lets its parts and their requirement go.
    await admin.send("DELETE", `/api/reservations/${placed.id}`, undefined, 204);
    expect((await holdsOf(event.id)).map((row) => [row.itemId, row.quantity])).toEqual([[hurricane.id, 2]]);
    expect(await requirementsOf(event.id, "kit")).toHaveLength(0);
  });

  it("makes the kit unavailable when a component is short and names it in the conflict (AC3)", async () => {
    const { hurricane, kit } = await candleSet(6);
    const before = await admin.send<ItemAvailability>("GET", `/api/inventory/items/${kit.id}/availability?from=2026-12-12&to=2026-12-12`);
    expect(before).toMatchObject({ owned: 6, available: 6 });
    expect(before.parts).toEqual([expect.objectContaining({ itemName: "Glass hurricane", perKit: 1, available: 6 })]);

    const { event } = await eventWith([]);
    const placed = await admin.send<Reservation>("POST", `/api/events/${event.id}/reservations`, { itemId: kit.id, quantity: 10 }, 201);
    expect(placed).toMatchObject({ allocated: 6, shortfall: 4, issue: "conflict" });

    const conflicts = await admin.send<Conflict[]>("GET", `/api/events/${event.id}/conflicts`);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ itemId: hurricane.id, itemName: "Glass hurricane", kitName: "Centerpiece Candle Set", shortfall: 4, kind: "conflict" });
    // The kit's own page shows its part's conflict.
    const onKit = await admin.send<Conflict[]>("GET", `/api/inventory/items/${kit.id}/conflicts`);
    expect(onKit.map((row) => row.id)).toEqual([conflicts[0].id]);
    const after = await admin.send<ItemAvailability>("GET", `/api/inventory/items/${kit.id}/availability?from=2026-12-12&to=2026-12-12`);
    expect(after.available).toBe(0);
    expect(after.holds.map((hold) => hold.id)).toEqual([placed.id]);

    // The part follows the kit: only the risk can be accepted on it.
    const adjust = await admin.call("POST", `/api/reservation-conflicts/${conflicts[0].id}/resolve`, { method: "adjust", quantity: 6 });
    expect(adjust.status).toBe(400);
    // Lowering the kit to what is on hand clears the conflict.
    await admin.send("PATCH", `/api/reservations/${placed.id}`, { quantity: 6 });
    expect(await admin.send<Conflict[]>("GET", `/api/events/${event.id}/conflicts`)).toEqual([]);
    expect((await admin.send<Reservation[]>("GET", `/api/events/${event.id}/reservations`))[0]).toMatchObject({ allocated: 6, shortfall: 0, issue: null });
  });

  it("lists a kit's parts in its Decor group and closes them out once: candles consumed, glassware returned (AC2)", async () => {
    const { hurricane, candle, kit } = await candleSet(20);
    const { event } = await eventWith([line("L1", "decor", "Centerpiece Candle Set", { quantity: 10, catalogId: kit.id })]);
    await startPlanning(event.id);
    const lines = await pullLines(event.id);
    expect(lines.map((row) => `${row.group}:${row.name}:${row.quantity}`).sort()).toEqual([
      "decor:Glass hurricane:10",
      "decor:Taper candle:10",
    ]);
    // Kit candles aren't also counted as Supplies.
    expect(await requirementsOf(event.id, "supply")).toHaveLength(0);
    const beo = await admin.send<{ content: unknown }>("GET", `/api/events/${event.id}/beo`);
    // The BEO's equipment lists leave Supplies out; the kit's candles stay with it.
    expect(JSON.stringify(beo.content)).toContain("Glass hurricane");
    expect(JSON.stringify(beo.content)).toContain("Taper candle");

    const glassLine = lines.find((row) => row.name === "Glass hurricane")!;
    const candleLine = lines.find((row) => row.name === "Taper candle")!;
    const result = await admin.send<Closeout>("POST", `/api/events/${event.id}/closeout`, {
      lines: [
        { lineId: glassLine.id, returned: 10 },
        { lineId: candleLine.id, used: 8 },
      ],
    }, 201);
    expect(result.lines.find((row) => row.name === "Taper candle")).toMatchObject({ consumable: true, used: 8, leftover: 2 });
    const moves = async (itemId: string) =>
      (await db.select().from(schema.stockMovements).where(eq(schema.stockMovements.itemId, itemId)))
        .map((m) => `${m.type}:${Number(m.quantity)}`).sort();
    expect(await moves(candle.id)).toEqual(["consume:-8", "pull:-2", "return:2"]);
    expect(await moves(hurricane.id)).toEqual(["pull:-10", "return:10"]);
    expect(await moves(kit.id)).toEqual([]);
  });

  it("holds a decor kit from the sent proposal and lets it go when a revision drops it", async () => {
    const { hurricane, kit } = await candleSet(20);
    const { event, data } = await eventWith([line("L1", "decor", "Centerpiece Candle Set", { quantity: 4, catalogId: kit.id })], { status: "negotiation" });
    await db.transaction((tx) => syncProposalRentalHolds(tx, adminActor, event.id, data));
    expect((await holdsOf(event.id)).map((row) => [row.itemId, row.quantity, row.status]).sort()).toEqual(
      [[hurricane.id, 4, "tentative"], [kit.id, 4, "tentative"]].sort(),
    );
    await db.transaction((tx) => syncProposalRentalHolds(tx, adminActor, event.id, { ...data, lines: [] }, data));
    expect(await holdsOf(event.id)).toEqual([]);
  });
});

describe("service offerings in event planning (FLOW-213)", () => {
  it("holds a service's rentals and pulls its rentals and consumables after planning starts (AC1)", async () => {
    const chair = await rental("Chiavari chair", "furniture", 200);
    const napkin = await consumable("Linen napkin", 500);
    const lounge = await service("Lounge Package", [
      { itemId: chair.id, quantity: 1, basis: "per_guest" },
      { itemId: napkin.id, quantity: 2, basis: "per_guest" },
    ]);
    const { event, data } = await eventWith([line("L1", "service", "Lounge Package", { quantity: 1, catalogId: lounge.id })]);
    await db.transaction((tx) => syncProposalRentalHolds(tx, adminActor, event.id, data));
    expect((await holdsOf(event.id)).map((row) => [row.itemId, row.quantity])).toEqual([[chair.id, 80]]);

    await startPlanning(event.id);
    expect((await pullLines(event.id)).map((row) => `${row.group}:${row.name}:${row.quantity}`).sort()).toEqual([
      "kitchen_equipment:Chiavari chair:80",
      "supplies:Linen napkin:160",
    ]);
    expect((await requirementsOf(event.id, "supply")).map((row) => [row.itemId, row.quantity])).toEqual([[napkin.id, 160]]);
  });

  it("applies the service's linked task template once when its event starts planning (AC2)", async () => {
    const arch = await service("Large Balloon Arch", []);
    const { event } = await eventWith([line("L1", "service", "Large Balloon Arch", { quantity: 1, catalogId: arch.id })]);
    await admin.send("POST", "/api/tasks/templates", {
      name: "Balloon arch build", matchCatalogId: arch.id,
      items: [{ title: "Inflate balloons", type: "production", offsetDays: -1, time: "09:00" }],
    }, 201);
    await startPlanning(event.id);
    // Running the step again (a retried job) adds nothing.
    expect(await db.transaction((tx) => applyMatchingProductionTemplates(tx, event.id))).toBe(0);
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.eventId, event.id));
    expect(tasks.map((task) => task.title)).toEqual(["Inflate balloons"]);
  });
});

describe("disposables and supplies (FLOW-214)", () => {
  it("suggests ordering a supply below par (AC2)", async () => {
    await consumable("Sterno test can", 10, 48);
    await consumable("Plastic fork", 500, 100);
    const lines = await suggestOrderList(db, "2026-12-01", "2026-12-31");
    const sternos = lines.find((row) => row.itemName === "Sterno test can");
    expect(sternos).toMatchObject({ shortage: 38, quantity: 38 });
    expect(lines.some((row) => row.itemName === "Plastic fork")).toBe(false);
  });
});
