import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { auditLog } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";
import { updateItem } from "../../worker/records/inventory";
import { changeLeadStatus, createLead } from "../../worker/records/leads";
import { restoreDefaultSections } from "./reference-data";
import { itemInputSchema } from "../../shared/inventory";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { HistoryEntry } from "../../shared/audit";
import type { Client } from "../../shared/core-records";
import type { InventoryItem, ItemInput, Section } from "../../shared/inventory";
import type {
  LeadConversion,
  LeadDuplicate,
  LeadIntake,
} from "../../shared/leads";

// Audit rows and history for inventory items, sections and lead changes
// (FLOW-185), against the CI Postgres service.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c2000000-0000-4000-8000-000000000001",
  sam: "c2000000-0000-4000-8000-000000000002",
  sue: "c2000000-0000-4000-8000-000000000003",
  staff: "c2000000-0000-4000-8000-000000000004",
};
const signedInAs = (
  userId: string,
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = { userId, role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
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
    status = 200,
  ) => {
    const response = await call(method, path, body);
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(status);
    return json as T;
  };
  return {
    actor,
    call,
    send,
    get: <T>(path: string) => send<T>("GET", path),
  };
};
const admin = signedInAs(people.admin, "admin");
const sam = signedInAs(people.sam, "salesperson");
const sue = signedInAs(people.sue, "salesperson");
const partTimeStaff = signedInAs(people.staff, "staff", "part_time");

const rowsFor = (entityType: string, entityId: string) =>
  db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)),
    )
    .orderBy(auditLog.createdAt);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table recipe_lines, recipes, audit_log, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, inventory_sections, lead_duplicates, leads, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  // beforeEach clears inventory_sections; give later files the seeded defaults back.
  await restoreDefaultSections(client);
  await client.end();
});

describe("inventory items", () => {
  const chairs: ItemInput = {
    kind: "rental",
    subtype: "furniture",
    code: "CH-001",
    name: "Chiavari Chair",
    rental: { priceCents: 500 },
  };
  const cream: ItemInput = {
    kind: "consumable",
    subtype: "ingredient",
    name: "Heavy Cream",
    unit: "qt",
    consumable: {
      purchaseUnit: "qt",
      unitCostCents: 2400,
      parLevel: 6,
    },
  };
  const create = (input: ItemInput) =>
    admin.send<InventoryItem>("POST", "/api/inventory/items", input, 201);
  const update = (id: string, input: ItemInput) =>
    admin.send<InventoryItem>("PUT", `/api/inventory/items/${id}`, input);

  it("AC1: a price change writes one row with only the changed fields, and history returns it", async () => {
    const item = await create({
      ...chairs,
      rental: { priceCents: 500, internalCostCents: 250, replacementCostCents: 900 },
    });
    const updated = await update(item.id, { ...chairs, rental: { priceCents: 650 } });
    expect(updated.rental).toMatchObject({ internalCostCents: 250, replacementCostCents: 900 });
    const rows = await rowsFor("inventory_item", item.id);
    expect(rows.map((row) => [row.action, row.createdBy])).toEqual([
      ["create", people.admin],
      ["update", people.admin],
    ]);
    expect(rows[1].changes).toEqual({
      rental: { before: item.rental, after: updated.rental },
    });
    // Stock is the ledger's; it isn't in item snapshots.
    expect(Object.keys(rows[0].changes)).not.toContain("totalQuantity");

    const history = await partTimeStaff.get<HistoryEntry[]>(
      `/api/inventory/items/${item.id}/history`,
    );
    expect(history.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(history[0]).toMatchObject({
      actorId: people.admin,
      changes: {
        rental: {
          before: { priceCents: 500, internalCostCents: null, replacementCostCents: null },
          after: { priceCents: 650, internalCostCents: null, replacementCostCents: null },
        },
      },
    });
  });

  it("AC1: hides consumable costs from users who can't see costs", async () => {
    const item = await create(cream);
    const details = cream.consumable!;
    await update(item.id, {
      ...cream,
      consumable: { ...details, unitCostCents: 2600 },
    });
    await update(item.id, {
      ...cream,
      consumable: { ...details, unitCostCents: 2800, parLevel: 8 },
    });

    const full = await admin.get<HistoryEntry[]>(
      `/api/inventory/items/${item.id}/history`,
    );
    expect(full.map((entry) => entry.action)).toEqual([
      "update",
      "update",
      "create",
    ]);
    expect(full[1].changes.consumable).toMatchObject({
      before: { unitCostCents: 2400 },
      after: { unitCostCents: 2600 },
    });

    const hidden = await partTimeStaff.get<HistoryEntry[]>(
      `/api/inventory/items/${item.id}/history`,
    );
    // The cost-only change disappears; the par change shows without costs.
    expect(hidden.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(hidden[0].changes.consumable).toMatchObject({
      before: { unitCostCents: null, parLevel: 6 },
      after: { unitCostCents: null, parLevel: 8 },
    });
    expect(JSON.stringify(hidden)).not.toMatch(/"unitCostCents":\d/);
  });

  it("records archive and restore, and an unchanged save writes nothing", async () => {
    const item = await create(chairs);
    await update(item.id, chairs);
    await admin.send("POST", `/api/inventory/items/${item.id}/archive`, {});
    await admin.send("POST", `/api/inventory/items/${item.id}/restore`, {});
    const rows = await rowsFor("inventory_item", item.id);
    expect(rows.map((row) => row.action)).toEqual([
      "create",
      "archive",
      "restore",
    ]);
    expect(Object.keys(rows[1].changes)).toEqual(["archivedAt"]);
  });

  it("AC4: a rolled-back change writes no audit row", async () => {
    const item = await create(chairs);
    await db
      .transaction(async (tx) => {
        await updateItem(
          tx as unknown as Db,
          admin.actor,
          item.id,
          itemInputSchema.parse({ ...chairs, name: "Never saved" }),
        );
        tx.rollback();
      })
      .catch(() => undefined);
    expect(
      (await rowsFor("inventory_item", item.id)).map((row) => row.action),
    ).toEqual(["create"]);
  });

  it("answers 404 for the history of an unknown item", async () => {
    expect(
      (
        await admin.call(
          "GET",
          "/api/inventory/items/c2000000-0000-4000-8000-0000000000ff/history",
        )
      ).status,
    ).toBe(404);
  });
});

describe("inventory sections", () => {
  it("records create, rename, archive and restore", async () => {
    const section = await admin.send<Section>(
      "POST",
      "/api/inventory/sections",
      { name: "Annex", kind: "rental" },
      201,
    );
    await admin.send("PUT", `/api/inventory/sections/${section.id}`, {
      name: "North Annex",
    });
    await admin.send("POST", `/api/inventory/sections/${section.id}/archive`, {});
    await admin.send("POST", `/api/inventory/sections/${section.id}/restore`, {});
    const rows = await rowsFor("inventory_section", section.id);
    expect(rows.map((row) => row.action)).toEqual([
      "create",
      "update",
      "archive",
      "restore",
    ]);
    expect(rows[0].changes).toEqual({
      name: { before: null, after: "Annex" },
      kind: { before: null, after: "rental" },
    });
    expect(rows[1].changes).toEqual({
      name: { before: "Annex", after: "North Annex" },
    });
  });
});

describe("leads", () => {
  let sourceLeadNumber = 5000;
  const intake = (overrides: Partial<LeadIntake> = {}): LeadIntake => ({
    channel: "webhook",
    source: "Bark",
    sourceLeadId: `bark-${(sourceLeadNumber += 1)}`,
    name: "Maya Ortiz",
    email: "maya@example.com",
    phone: "(202) 555-0142",
    eventDate: "2026-11-14",
    guestCount: 80,
    eventType: "Wedding",
    message: "Plated dinner for 80.",
    rawPayload: { secret: "raw-source-data" },
    ...overrides,
  });
  const seed = async (overrides: Partial<LeadIntake> = {}) =>
    (await createLead(db, intake(overrides))).id;
  const leadRows = (id: string) => rowsFor("lead", id);

  it("AC2: assigning, changing status and converting each write one row, and history returns them", async () => {
    const id = await seed();
    await admin.send("POST", `/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await sam.send("POST", `/api/leads/${id}/status`, { status: "contacted" });
    await sam.send("POST", `/api/leads/${id}/status`, { status: "qualified" });
    const converted = await sam.send<LeadConversion>(
      "POST",
      `/api/leads/${id}/convert`,
      { event: { startTime: "18:00" } },
    );

    const rows = await leadRows(id);
    expect(rows.map((row) => [row.action, row.createdBy])).toEqual([
      ["update", people.admin],
      ["update", people.sam],
      ["update", people.sam],
      ["update", people.sam],
    ]);
    expect(rows[0].changes).toEqual({
      assignedSalespersonId: { before: null, after: people.sam },
    });
    expect(rows[1].changes.status).toEqual({ before: "new", after: "contacted" });
    expect(Object.keys(rows[1].changes).sort()).toEqual([
      "firstRespondedAt",
      "status",
    ]);
    expect(rows[2].changes).toEqual({
      status: { before: "contacted", after: "qualified" },
    });
    expect(rows[3].changes).toEqual({
      status: { before: "qualified", after: "converted" },
      convertedClientId: { before: null, after: converted.client.id },
      convertedEventId: { before: null, after: converted.event.id },
    });

    const history = await sam.get<HistoryEntry[]>(`/api/leads/${id}/history`);
    expect(history.map((entry) => entry.changes.status?.after ?? "assigned")).toEqual([
      "converted",
      "qualified",
      "contacted",
      "assigned",
    ]);
    // Raw source payloads never reach the history.
    expect(JSON.stringify(history)).not.toContain("raw-source-data");
    // A salesperson who can't see the lead can't see its history.
    expect((await sue.call("GET", `/api/leads/${id}/history`)).status).toBe(404);
  });

  it("writes one row per lead whose salesperson a bulk assignment changes", async () => {
    const first = await seed();
    const second = await seed({ email: "jo@example.com", phone: "", name: "Jo" });
    await admin.send("POST", `/api/leads/${first}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await admin.send("POST", "/api/leads/assign", {
      leadIds: [first, second],
      assignedSalespersonId: people.sam,
    });
    expect((await leadRows(first)).length).toBe(1);
    expect((await leadRows(second)).length).toBe(1);
  });

  it("AC2: merging writes one row on the kept lead and archives the other", async () => {
    const bark = await seed();
    const other = await seed({
      source: "Thumbtack",
      sourceLeadId: "tt-1",
      guestCount: null,
      eventDate: null,
    });
    const [duplicate] = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    await admin.send("POST", `/api/leads/duplicates/${duplicate.id}/merge`, {
      keepLeadId: other,
    });
    const kept = await leadRows(other);
    expect(kept).toHaveLength(1);
    expect(kept[0].changes).toMatchObject({
      mergedLeadIds: { before: [], after: [bark] },
      guestCount: { before: null, after: 80 },
      eventDate: { before: null, after: "2026-11-14" },
    });
    const merged = await leadRows(bark);
    expect(merged.map((row) => row.action)).toEqual(["archive"]);
    expect(merged[0].changes.mergedIntoLeadId).toEqual({
      before: null,
      after: other,
    });
    const history = await admin.get<HistoryEntry[]>(`/api/leads/${other}/history`);
    expect(history).toHaveLength(1);
  });

  it("records a dismissed duplicate on the lead it was found for", async () => {
    await seed();
    const later = await seed({ source: "Thumbtack", sourceLeadId: "tt-2" });
    const [duplicate] = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    expect(duplicate.lead.id).toBe(later);
    expect(
      (await admin.call("POST", `/api/leads/duplicates/${duplicate.id}/dismiss`))
        .status,
    ).toBe(204);
    const rows = await leadRows(later);
    expect(rows.map((row) => row.changes)).toEqual([
      { dismissedDuplicateId: { before: null, after: duplicate.id } },
    ]);
  });

  it("AC3: converting into an existing client adds the new contact to that client's history", async () => {
    const existing = await admin.send<Client>(
      "POST",
      "/api/clients",
      { name: "Hudson Events", kind: "organization", contacts: [] },
      201,
    );
    const id = await seed();
    await admin.send("POST", `/api/leads/${id}/status`, { status: "contacted" });
    await admin.send("POST", `/api/leads/${id}/status`, { status: "qualified" });
    await admin.send("POST", `/api/leads/${id}/convert`, {
      event: { startTime: "18:00" },
      client: { mode: "link", clientId: existing.id },
    });
    const history = await admin.get<HistoryEntry[]>(
      `/api/clients/${existing.id}/history`,
    );
    expect(history.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(history[0].changes.contacts.before).toEqual([]);
    expect(history[0].changes.contacts.after).toMatchObject([
      { name: "Maya Ortiz", email: "maya@example.com" },
    ]);
  });

  it("AC4: a rolled-back status change writes no audit row", async () => {
    const id = await seed();
    await db
      .transaction(async (tx) => {
        await changeLeadStatus(tx as unknown as Db, admin.actor, id, {
          status: "contacted",
        } as never);
        tx.rollback();
      })
      .catch(() => undefined);
    expect(await leadRows(id)).toEqual([]);
  });
});
