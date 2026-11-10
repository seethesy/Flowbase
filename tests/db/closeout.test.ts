import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { Closeout } from "../../shared/closeout";

// Post-event closeout and returns (FLOW-157) through the real API and database.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1570000-0000-4000-8000-000000000001",
  manager: "c1570000-0000-4000-8000-000000000002",
  sam: "c1570000-0000-4000-8000-000000000003",
  jamie: "c1570000-0000-4000-8000-000000000004",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["jamie", "staff", "part_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const app = createApp({
    withDb,
    resolveActor: async () => ({ userId: people[who], role, employmentType }),
  });
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
  const send = async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const manager = signedInAs("manager");
const sam = signedInAs("sam");
const jamie = signedInAs("jamie");

const tables = sql`truncate table closeout_lines, event_closeouts, day_of_updates, day_of_checkpoints, day_of_staff_states, truck_assignments, event_planning_outputs, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, recipe_lines, recipes, audit_log, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, inventory_sections, lead_duplicates, leads, event_status_history, event_staff_slots, event_shifts, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@closeout.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255592${i}`,
      status: "active" as const,
    })),
  );
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

// A gala in Preparation with 100 plates and 10 napkin packs pulled, and a stocked
// Warehouse and Pantry.
async function setup(status: "preparation" | "closed" = "preparation") {
  const { id: clientId } = await sam.send<Client>(
    "POST", "/api/clients", { name: `Juniper ${crypto.randomUUID().slice(0, 6)}`, kind: "organization", contacts: [] }, 201,
  );
  const gala = await sam.send<FlowEvent>(
    "POST", "/api/events",
    { title: "Fall gala", date: "2026-11-14", startTime: "18:00", endTime: "23:00", clientId }, 201,
  );
  await db.update(schema.events).set({ status }).where(eq(schema.events.id, gala.id));
  const [warehouse] = await db.insert(schema.inventorySections).values({ name: "Warehouse", kind: "rental" }).returning();
  const [pantry] = await db.insert(schema.inventorySections).values({ name: "Pantry", kind: "consumable" }).returning();
  const [plates] = await db.insert(schema.inventoryItems).values({ kind: "rental", subtype: "tableware", name: "Dinner plate", code: `PL-${crypto.randomUUID().slice(0, 6)}` }).returning();
  await db.insert(schema.inventoryRentalDetails).values({ itemId: plates.id });
  await db.insert(schema.inventoryStock).values({ itemId: plates.id, sectionId: warehouse.id, quantity: 100 });
  const [napkins] = await db.insert(schema.inventoryItems).values({ kind: "consumable", subtype: "supply", name: "Napkins", code: `NP-${crypto.randomUUID().slice(0, 6)}` }).returning();
  await db.insert(schema.inventoryStock).values({ itemId: napkins.id, sectionId: pantry.id, quantity: 50 });
  const [list] = await db.insert(schema.pullLists).values({ eventId: gala.id }).returning();
  const [plateLine, napkinLine] = await db.insert(schema.pullListLines).values([
    { pullListId: list.id, group: "kitchen_equipment", itemId: plates.id, name: "Dinner plate", quantity: 100, status: "loaded" },
    { pullListId: list.id, group: "supplies", itemId: napkins.id, name: "Napkins", quantity: 10, status: "loaded" },
  ]).returning();
  return { gala, plates, napkins, plateLine, napkinLine, warehouse, pantry };
}
const stockOf = async (itemId: string) =>
  Number((await db.select().from(schema.inventoryStock).where(eq(schema.inventoryStock.itemId, itemId)))[0].quantity);
const movementsOf = (itemId: string) =>
  db.select().from(schema.stockMovements).where(eq(schema.stockMovements.itemId, itemId));

describe("closeout and returns (FLOW-157)", () => {
  it("returns 98 of 100 plates with 2 damaged as a return of 98 and a damage movement of 2 (AC1)", async () => {
    const { gala, plates, plateLine, napkinLine } = await setup();
    const result = await manager.send<Closeout>("POST", `/api/events/${gala.id}/closeout`, {
      lines: [
        { lineId: plateLine.id, returned: 98, damaged: 2, missing: 0 },
        { lineId: napkinLine.id, used: 6 },
      ],
      notes: "Two plates chipped.",
    }, 201);
    expect(result.closedOut).toBe(true);
    expect(result.lines.find((line) => line.name === "Dinner plate")).toMatchObject({ returned: 98, damaged: 2, missing: 0 });
    const moves = await movementsOf(plates.id);
    expect(moves.map((m) => `${m.type}:${Number(m.quantity)}`).sort()).toEqual(
      ["damage_loss:-2", "pull:-98", "return:98"],
    );
    expect(moves.every((m) => m.linkType === "event" && m.linkId === gala.id)).toBe(true);
    // Only the 2 damaged plates left stock for good.
    expect(await stockOf(plates.id)).toBe(98);
  });

  it("records consumables used and returns the leftover to stock", async () => {
    const { gala, napkins, plateLine, napkinLine } = await setup();
    await manager.send("POST", `/api/events/${gala.id}/closeout`, {
      lines: [{ lineId: plateLine.id, returned: 100 }, { lineId: napkinLine.id, used: 6 }],
    }, 201);
    const moves = await movementsOf(napkins.id);
    expect(moves.map((m) => `${m.type}:${Number(m.quantity)}`).sort()).toEqual(
      ["consume:-6", "pull:-4", "return:4"],
    );
    expect(await stockOf(napkins.id)).toBe(44);
  });

  it("finishes the event, marks the lines returned and emits event.completed", async () => {
    const { gala, plateLine, napkinLine } = await setup();
    await manager.send("POST", `/api/events/${gala.id}/closeout`, {
      lines: [{ lineId: plateLine.id, returned: 100 }, { lineId: napkinLine.id, used: 0 }],
    }, 201);
    const [event] = await db.select().from(schema.events).where(eq(schema.events.id, gala.id));
    expect(event.status).toBe("finished");
    const lines = await db.select().from(schema.pullListLines);
    expect(lines.map((line) => line.status)).toEqual(["returned", "returned"]);
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:event.completed"));
    expect(jobs).toHaveLength(1);
    expect((await manager.call("POST", `/api/events/${gala.id}/closeout`, { lines: [] })).status).toBe(409);
  });

  it("refuses counts that don't add up, leaving nothing recorded", async () => {
    const { gala, plates, plateLine, napkinLine } = await setup();
    const response = await manager.call("POST", `/api/events/${gala.id}/closeout`, {
      lines: [{ lineId: plateLine.id, returned: 90, damaged: 2 }, { lineId: napkinLine.id, used: 1 }],
    });
    expect(response.status).toBe(400);
    expect(await movementsOf(plates.id)).toEqual([]);
    expect(await db.select().from(schema.eventCloseouts)).toEqual([]);
  });

  it("needs every line, an event in Preparation and a manager", async () => {
    const { gala, plateLine } = await setup();
    expect((await manager.call("POST", `/api/events/${gala.id}/closeout`, { lines: [{ lineId: plateLine.id, returned: 100 }] })).status).toBe(409);
    expect((await jamie.call("POST", `/api/events/${gala.id}/closeout`, { lines: [] })).status).toBe(403);
    const early = await setup("closed");
    expect((await manager.call("POST", `/api/events/${early.gala.id}/closeout`, {
      lines: [{ lineId: early.plateLine.id, returned: 100 }, { lineId: early.napkinLine.id, used: 0 }],
    })).status).toBe(409);
  });
});
