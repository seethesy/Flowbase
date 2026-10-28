import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createLead } from "../../worker/records/leads";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { Client, FlowEvent, Venue } from "../../shared/core-records";
import type { InventoryItem, ItemInput } from "../../shared/inventory";

// FLOW-186 (stale saves), FLOW-198 (stock-unit edits) and FLOW-199 (atomic
// authorization). The races use two independent connections: `db` runs the app
// and `other` holds a competing transaction open, so a mutation really waits on
// the row lock instead of being serialized through one client.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const other = postgres(url, { max: 1 });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1990000-0000-4000-8000-000000000001",
  manager: "c1990000-0000-4000-8000-000000000002",
  sam: "c1990000-0000-4000-8000-000000000003",
  sue: "c1990000-0000-4000-8000-000000000004",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["sue", "salesperson", "full_time"],
];
const as = (who: keyof typeof people) => {
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
  const send = async <T>(
    method: string,
    path: string,
    body?: unknown,
    status = method === "POST" ? 201 : 200,
  ) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = as("admin");
const manager = as("manager");
const sam = as("sam");

const tables = sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, recipe_lines, inventory_items, ingest_receipts, jobs, users cascade`;
const SECTION = "FLOW-198 Dry Storage";
let sectionId = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@concurrency.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255593${i}`,
      status: "active" as const,
    })),
  );
  const [existing] = await db
    .select({ id: schema.inventorySections.id })
    .from(schema.inventorySections)
    .where(eq(schema.inventorySections.name, SECTION));
  sectionId =
    existing?.id ??
    (
      await db
        .insert(schema.inventorySections)
        .values({ name: SECTION, kind: "consumable" })
        .returning({ id: schema.inventorySections.id })
    )[0].id;
});
afterAll(async () => {
  await db.execute(tables);
  await db
    .delete(schema.inventorySections)
    .where(eq(schema.inventorySections.name, SECTION));
  await client.end();
  await other.end();
});

// Runs `work` in a transaction on the other connection and keeps it open, with
// its row locks held, until commit() is called.
async function holding(work: (tx: postgres.TransactionSql) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let ready!: () => void;
  const locked = new Promise<void>((resolve) => (ready = resolve));
  const done = other.begin(async (tx) => {
    await work(tx);
    ready();
    await gate;
  });
  await Promise.race([locked, done]);
  return {
    commit: async () => {
      release();
      await done;
    },
  };
}
// Whether a promise is still pending after `ms`: proof it is waiting on a lock.
async function stillWaiting(promise: Promise<unknown>, ms = 300) {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}
const count = async (table: string, where = sql`true`) => {
  const [row] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
  );
  return row.n;
};

const newClient = (name = "Juniper & Co.") => ({
  name,
  kind: "organization" as const,
  contacts: [{ name: "Olivia Bennett", role: "primary_poc" as const }],
});
const clientInput = (c: Client) => ({
  name: c.name,
  kind: c.kind,
  notes: c.notes,
  tags: c.tags,
  contacts: c.contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    role: contact.role,
    notes: contact.notes,
  })),
});

describe("FLOW-186: saves from a stale copy are refused", () => {
  it("keeps the first client save's contacts when a second save comes from the same version (AC1)", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    // First save adds a contact.
    const first = await sam.send<Client>("PUT", `/api/clients/${created.id}`, {
      ...clientInput(created),
      contacts: [
        ...clientInput(created).contacts,
        { name: "Maya Ortiz", role: "billing" },
      ],
      updatedAt: created.updatedAt,
    });
    expect(first.contacts.map((c) => c.name)).toEqual(["Olivia Bennett", "Maya Ortiz"]);
    // Second save from the same loaded copy would archive Maya and rename it.
    const second = await sam.call("PUT", `/api/clients/${created.id}`, {
      ...clientInput(created),
      name: "Juniper Events",
      updatedAt: created.updatedAt,
    });
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("STALE");
    const now = await sam.send<Client>("GET", `/api/clients/${created.id}`);
    expect(now.name).toBe("Juniper & Co.");
    expect(now.contacts.map((c) => c.name)).toEqual(["Olivia Bennett", "Maya Ortiz"]);
    expect(now.updatedAt).toBe(first.updatedAt);
    // Saving from the current version works.
    const third = await sam.send<Client>("PUT", `/api/clients/${created.id}`, {
      ...clientInput(now),
      name: "Juniper Events",
      updatedAt: now.updatedAt,
    });
    expect(third.contacts).toHaveLength(2);
    expect(await count("audit_log", sql`entity_type = 'client' and action = 'update'`)).toBe(2);
  });

  it("refuses a stale venue save and keeps the first save's areas (AC1)", async () => {
    const venue = await admin.send<Venue>("POST", "/api/venues", {
      name: "The Glasshouse",
      areas: [{ name: "Inside Tent" }],
    });
    const base = { name: venue.name, areas: venue.areas.map(({ id, name }) => ({ id, name })) };
    await admin.send("PUT", `/api/venues/${venue.id}`, {
      ...base,
      areas: [...base.areas, { name: "Bar Patio" }],
      updatedAt: venue.updatedAt,
    });
    const stale = await admin.call("PUT", `/api/venues/${venue.id}`, {
      ...base,
      updatedAt: venue.updatedAt,
    });
    expect(stale.status).toBe(409);
    const now = await admin.send<Venue>("GET", `/api/venues/${venue.id}`);
    expect(now.areas.map((a) => a.name)).toEqual(["Inside Tent", "Bar Patio"]);
  });

  it("refuses a stale event save and keeps the first save's areas (AC1)", async () => {
    const owner = await sam.send<Client>("POST", "/api/clients", newClient());
    const event = await sam.send<FlowEvent>("POST", "/api/events", {
      title: "Fall gala",
      date: "2026-11-14",
      startTime: "18:00",
      clientId: owner.id,
    });
    const base = { title: event.title, date: event.date, startTime: event.startTime, clientId: owner.id };
    await sam.send("PUT", `/api/events/${event.id}`, {
      ...base,
      areas: ["Ballroom"],
      updatedAt: event.updatedAt,
    });
    const stale = await sam.call("PUT", `/api/events/${event.id}`, {
      ...base,
      title: "Winter gala",
      areas: [],
      updatedAt: event.updatedAt,
    });
    expect(stale.status).toBe(409);
    const now = await sam.send<FlowEvent>("GET", `/api/events/${event.id}`);
    expect(now).toMatchObject({ title: "Fall gala", areas: [{ name: "Ballroom" }] });
  });

  it("refuses a stale item save", async () => {
    const item = await admin.send<InventoryItem>("POST", "/api/inventory/items", gloves());
    await admin.send("PUT", `/api/inventory/items/${item.id}`, {
      ...gloves({ name: "Nitrile gloves" }),
      updatedAt: item.updatedAt,
    });
    const stale = await admin.call("PUT", `/api/inventory/items/${item.id}`, {
      ...gloves({ name: "Latex gloves" }),
      updatedAt: item.updatedAt,
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("STALE");
    expect((await admin.send<InventoryItem>("GET", `/api/inventory/items/${item.id}`)).name).toBe(
      "Nitrile gloves",
    );
  });

  it("rejects a save without the loaded version", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    const response = await sam.call("PUT", `/api/clients/${created.id}`, clientInput(created));
    expect(response.status).toBe(400);
  });
});

describe("FLOW-199: authorization holds under concurrent reassignment", () => {
  it("a reassignment that commits first stops the previous salesperson's client save (AC1)", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    const reassign = await holding(
      (tx) =>
        tx`update clients set assigned_salesperson_id = ${people.sue}, updated_at = now() where id = ${created.id}`,
    );
    const save = sam.call("PUT", `/api/clients/${created.id}`, {
      ...clientInput(created),
      name: "Renamed by Sam",
      updatedAt: created.updatedAt,
    });
    expect(await stillWaiting(save)).toBe(true);
    await reassign.commit();
    const response = await save;
    expect(response.status).toBe(404);
    // A hidden record reveals nothing (AC3).
    expect(await response.text()).not.toContain("Juniper");
    const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, created.id));
    expect(row).toMatchObject({ name: "Juniper & Co.", assignedSalespersonId: people.sue });
    expect(await count("audit_log", sql`entity_type = 'client' and action = 'update'`)).toBe(0);
    expect(await count("jobs", sql`type = 'event:client.updated'`)).toBe(0);
  });

  it("a save that locks first commits, and the reassignment then applies over it (AC1)", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    // Sam's save holds the client; the manager's reassignment waits for it.
    const samSave = await holding(
      (tx) => tx`select id from clients where id = ${created.id} for update`,
    );
    const reassign = manager.call("PUT", `/api/clients/${created.id}`, {
      ...clientInput(created),
      assignedSalespersonId: people.sue,
      updatedAt: created.updatedAt,
    });
    expect(await stillWaiting(reassign)).toBe(true);
    await samSave.commit();
    expect((await reassign).status).toBe(200);
    const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, created.id));
    expect(row.assignedSalespersonId).toBe(people.sue);
  });

  it("a stale manager copy can't restore the previous salesperson (AC1)", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    const loaded = await manager.send<Client>("GET", `/api/clients/${created.id}`);
    await manager.send("PUT", `/api/clients/${created.id}`, {
      ...clientInput(loaded),
      assignedSalespersonId: people.sue,
      updatedAt: loaded.updatedAt,
    });
    const restore = await manager.call("PUT", `/api/clients/${created.id}`, {
      ...clientInput(loaded),
      assignedSalespersonId: loaded.assignedSalespersonId,
      updatedAt: loaded.updatedAt,
    });
    expect(restore.status).toBe(409);
    const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, created.id));
    expect(row.assignedSalespersonId).toBe(people.sue);
  });

  it("a reassignment that commits first stops the previous salesperson's archive (AC1)", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    const reassign = await holding(
      (tx) =>
        tx`update clients set assigned_salesperson_id = ${people.sue} where id = ${created.id}`,
    );
    const archive = sam.call("POST", `/api/clients/${created.id}/archive`);
    expect(await stillWaiting(archive)).toBe(true);
    await reassign.commit();
    expect((await archive).status).toBe(404);
    const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, created.id));
    expect(row.archivedAt).toBeNull();
    expect(await count("jobs", sql`type = 'event:client.archived'`)).toBe(0);
  });

  it("a reassignment that commits first stops the previous salesperson's event save and archive (AC1)", async () => {
    const owner = await admin.send<Client>("POST", "/api/clients", {
      ...newClient(),
      assignedSalespersonId: people.sam,
    });
    const event = await sam.send<FlowEvent>("POST", "/api/events", {
      title: "Fall gala",
      date: "2026-11-14",
      startTime: "18:00",
      clientId: owner.id,
    });
    const reassign = await holding(
      (tx) =>
        tx`update events set assigned_salesperson_id = ${people.sue} where id = ${event.id}`,
    );
    const save = sam.call("PUT", `/api/events/${event.id}`, {
      title: "Renamed by Sam",
      date: event.date,
      startTime: event.startTime,
      clientId: owner.id,
      updatedAt: event.updatedAt,
    });
    const archive = sam.call("POST", `/api/events/${event.id}/archive`);
    expect(await stillWaiting(save)).toBe(true);
    await reassign.commit();
    expect((await save).status).toBe(404);
    expect((await archive).status).toBe(404);
    const [row] = await db.select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(row).toMatchObject({ title: "Fall gala", assignedSalespersonId: people.sue, archivedAt: null });
    expect(await count("jobs", sql`type in ('event:event.updated', 'event:event.archived')`)).toBe(0);
  });

  it("keeps the permitted operations working for each actor (AC4)", async () => {
    const created = await sam.send<Client>("POST", "/api/clients", newClient());
    const saved = await sam.send<Client>("PUT", `/api/clients/${created.id}`, {
      ...clientInput(created),
      // A salesperson can't reassign; the client stays theirs.
      assignedSalespersonId: people.sue,
      name: "Juniper Events",
      updatedAt: created.updatedAt,
    });
    expect(saved).toMatchObject({ name: "Juniper Events", assignedSalespersonId: people.sam });
    const moved = await manager.send<Client>("PUT", `/api/clients/${created.id}`, {
      ...clientInput(saved),
      assignedSalespersonId: people.sue,
      updatedAt: saved.updatedAt,
    });
    expect(moved.assignedSalespersonId).toBe(people.sue);
    expect((await sam.call("GET", `/api/clients/${created.id}`)).status).toBe(404);
    await manager.send("POST", `/api/clients/${created.id}/archive`, undefined, 200);
    await manager.send("POST", `/api/clients/${created.id}/restore`, undefined, 200);
  });
});

describe("FLOW-199: lead transitions hold under concurrent reassignment and conversion", () => {
  const qualifiedLead = async (owner = people.sam) => {
    const { id } = await createLead(
      db,
      {
        channel: "webhook",
        source: "Bark",
        sourceLeadId: `bark-${crypto.randomUUID()}`,
        name: "Priya Raman",
        email: "priya@example.com",
        eventDate: "2026-12-01",
      },
      { assignedSalespersonId: owner },
    );
    await db.update(schema.leads).set({ status: "qualified" }).where(eq(schema.leads.id, id));
    await db.execute(sql`truncate table jobs`);
    return id;
  };
  const conversion = { client: { mode: "create" }, event: { startTime: "18:00" } };
  const nothingCreated = async () => {
    expect(await count("clients")).toBe(0);
    expect(await count("client_contacts")).toBe(0);
    expect(await count("events")).toBe(0);
    expect(await count("proposals")).toBe(0);
    expect(await count("jobs")).toBe(0);
  };

  it("a lead reassigned away first stops the previous salesperson's conversion (AC2)", async () => {
    const id = await qualifiedLead();
    const reassign = await holding(
      (tx) => tx`update leads set assigned_salesperson_id = ${people.sue} where id = ${id}`,
    );
    const convert = sam.call("POST", `/api/leads/${id}/convert`, conversion);
    expect(await stillWaiting(convert)).toBe(true);
    await reassign.commit();
    const response = await convert;
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Priya");
    await nothingCreated();
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
    expect(lead).toMatchObject({ status: "qualified", convertedClientId: null });
  });

  it("a lead reassigned away first stops the previous salesperson's status change (AC2)", async () => {
    const id = await qualifiedLead();
    const reassign = await holding(
      (tx) => tx`update leads set assigned_salesperson_id = ${people.sue} where id = ${id}`,
    );
    const change = sam.call("POST", `/api/leads/${id}/status`, { status: "lost", reason: "Went elsewhere" });
    expect(await stillWaiting(change)).toBe(true);
    await reassign.commit();
    expect((await change).status).toBe(404);
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
    expect(lead.status).toBe("qualified");
    expect(await count("jobs", sql`type = 'event:lead.status_changed'`)).toBe(0);
  });

  it("a conversion that commits first can't be followed by a bulk assignment as if the lead were open (AC2)", async () => {
    const id = await qualifiedLead();
    const converted = await holding(
      (tx) => tx`update leads set status = 'converted' where id = ${id}`,
    );
    const assign = admin.call("POST", "/api/leads/assign", {
      leadIds: [id],
      assignedSalespersonId: people.sue,
    });
    expect(await stillWaiting(assign)).toBe(true);
    await converted.commit();
    expect((await assign).status).toBe(409);
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
    expect(lead.assignedSalespersonId).toBe(people.sam);
    expect(await count("jobs", sql`type = 'event:lead.assigned'`)).toBe(0);
  });

  it("a bulk assignment that commits first stops the previous salesperson's conversion (AC2)", async () => {
    const id = await qualifiedLead();
    // The bulk assignment locks the lead, as bulkAssignLeads does, then moves it.
    const assigned = await holding(async (tx) => {
      await tx`select id from leads where id = ${id} for update`;
      await tx`update leads set assigned_salesperson_id = ${people.sue} where id = ${id}`;
    });
    const convert = sam.call("POST", `/api/leads/${id}/convert`, conversion);
    expect(await stillWaiting(convert)).toBe(true);
    await assigned.commit();
    expect((await convert).status).toBe(404);
    await nothingCreated();
  });

  it("rolls back every related write when a conversion fails part way (AC3)", async () => {
    const id = await qualifiedLead();
    await db.execute(sql`
      create or replace function flow199_fail() returns trigger language plpgsql as $$
      begin raise exception 'forced failure'; end $$`);
    await db.execute(sql`create trigger flow199_fail before insert on proposals for each row execute function flow199_fail()`);
    try {
      expect((await sam.call("POST", `/api/leads/${id}/convert`, conversion)).status).toBe(500);
    } finally {
      await db.execute(sql`drop trigger if exists flow199_fail on proposals`);
      await db.execute(sql`drop function if exists flow199_fail()`);
    }
    await nothingCreated();
    const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
    expect(lead.status).toBe("qualified");
    // With the failure gone, the same conversion succeeds (AC4).
    await sam.send("POST", `/api/leads/${id}/convert`, conversion, 200);
    expect(await count("clients")).toBe(1);
  });
});

// FLOW-198: an item's stock unit can't change once it has stock history.
const gloves = (overrides: Partial<ItemInput> = {}): ItemInput => ({
  kind: "consumable",
  subtype: "supply",
  name: "Gloves",
  unit: "each",
  consumable: { purchaseUnit: "each", parLevel: 10 },
  ...overrides,
});
const flour = (overrides: Partial<ItemInput> = {}): ItemInput => ({
  kind: "consumable",
  subtype: "ingredient",
  name: "Flour",
  unit: "lb",
  consumable: { purchaseUnit: "lb", parLevel: 10 },
  ...overrides,
});

describe("FLOW-198: stock units are fixed once stock has moved", () => {
  const create = (input: ItemInput) =>
    admin.send<InventoryItem>("POST", "/api/inventory/items", input);
  const current = (id: string) =>
    admin.send<InventoryItem>("GET", `/api/inventory/items/${id}`);
  const update = async (id: string, input: ItemInput) =>
    admin.call("PUT", `/api/inventory/items/${id}`, {
      ...input,
      updatedAt: (await current(id)).updatedAt,
    });
  const move = (id: string, type: "receive" | "consume", quantity: number) =>
    admin.send("POST", `/api/inventory/items/${id}/movements`, { type, sectionId, quantity });

  it("lets an item without movements change its unit (AC1)", async () => {
    const item = await create(flour());
    const response = await update(item.id, flour({ unit: "kg" }));
    expect(response.status).toBe(200);
    expect((await current(item.id)).unit).toBe("kg");
  });

  it("refuses compatible and incompatible unit changes once stock has moved, even at zero (AC1, AC2)", async () => {
    const item = await create(flour());
    await move(item.id, "receive", 10);
    await move(item.id, "consume", 10);
    expect((await current(item.id)).totalQuantity).toBe(0);
    for (const unit of ["oz", "each"] as const) {
      const response = await update(item.id, flour({ unit }));
      expect(response.status, unit).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe("UNIT_LOCKED");
      expect(body.error.message).toContain("stock history is recorded in lb");
    }
    const after = await current(item.id);
    expect(after).toMatchObject({ unit: "lb", totalQuantity: 0 });
    expect(await count("stock_movements", sql`item_id = ${item.id}`)).toBe(2);
    expect(
      await count("audit_log", sql`entity_type = 'inventory_item' and action = 'update'`),
    ).toBe(0);
  });

  it("still saves unrelated edits after stock has moved (AC3)", async () => {
    const item = await create(flour());
    await move(item.id, "receive", 5);
    const response = await update(item.id, flour({ name: "Bread flour", category: "Baking" }));
    expect(response.status).toBe(200);
    expect(await current(item.id)).toMatchObject({ name: "Bread flour", unit: "lb", totalQuantity: 5 });
  });

  it("a first movement that commits first stops a concurrent unit change (AC4)", async () => {
    const item = await create(flour());
    // The movement holds the item lock, as recordMovement does, until it commits.
    const movement = await holding(async (tx) => {
      await tx`select id from inventory_items where id = ${item.id} for update`;
      await tx`insert into stock_movements (item_id, section_id, type, quantity, reason) values (${item.id}, ${sectionId}, 'receive', 10, 'race')`;
    });
    const loaded = await current(item.id);
    const edit = admin.call("PUT", `/api/inventory/items/${item.id}`, {
      ...flour({ unit: "oz" }),
      updatedAt: loaded.updatedAt,
    });
    expect(await stillWaiting(edit)).toBe(true);
    await movement.commit();
    const response = await edit;
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("UNIT_LOCKED");
    const [row] = await db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, item.id));
    expect(row.unit).toBe("lb");
  });

  it("a unit change that commits first means the first movement is recorded under the new unit (AC4)", async () => {
    const item = await create(flour());
    const edit = await holding(async (tx) => {
      await tx`select id from inventory_items where id = ${item.id} for update`;
      await tx`update inventory_items set unit = 'kg' where id = ${item.id}`;
    });
    const movement = admin.call("POST", `/api/inventory/items/${item.id}/movements`, {
      type: "receive",
      sectionId,
      quantity: 4,
    });
    expect(await stillWaiting(movement)).toBe(true);
    await edit.commit();
    expect((await movement).status).toBe(201);
    expect(await current(item.id)).toMatchObject({ unit: "kg", totalQuantity: 4 });
    // From now on the unit is fixed.
    expect((await update(item.id, flour({ unit: "lb" }))).status).toBe(409);
  });
});
