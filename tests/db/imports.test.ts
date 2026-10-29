import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import {
  auditLog,
  importKeys,
  importLogs,
  inventoryItems,
  inventoryStock,
  stockMovements,
} from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { findItem, recordMovement } from "../../worker/records/inventory";
import { restoreDefaultSections } from "./reference-data";
import { rentalImporter } from "../fixtures/rental-importer";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type {
  ImportBatchResult,
  ImportLog,
  ImportModuleInfo,
  ImportRow,
  ImportRowPlan,
} from "../../shared/imports";
import type { InventoryItem, Section } from "../../shared/inventory";

// Data import framework (FLOW-47) and imported stock and movement
// auditing (FLOW-168), against the CI Postgres service, with a test importer.
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
  admin: "c1000000-0000-4000-8000-000000000001",
  staff: "c1000000-0000-4000-8000-000000000002",
};
const signedInAs = (
  userId: string,
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = { userId, role, employmentType };
  const app = createApp({
    withDb,
    resolveActor: async () => actor,
    importModules: [rentalImporter],
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
    status = 200,
  ) => {
    const response = await call(method, path, body);
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(status);
    return json as T;
  };
  return { actor, call, send };
};
const admin = signedInAs(people.admin, "admin");
const partTimeStaff = signedInAs(people.staff, "staff", "part_time");

let warehouse: Section;
const row = (rowNumber: number, values: Record<string, string>): ImportRow => ({
  rowNumber,
  values,
});
const chairs = (overrides: Record<string, string> = {}) =>
  row(2, {
    code: "CH-001",
    name: "Chiavari Chair",
    category: "Seating",
    section: "Warehouse",
    quantity: "120",
    ...overrides,
  });
const tables = (overrides: Record<string, string> = {}) =>
  row(3, {
    code: "TB-060",
    name: '60" Round Table',
    category: "Tables",
    section: "Warehouse",
    quantity: "15",
    ...overrides,
  });

// One full run: log, batches, complete.
async function runImport(rows: ImportRow[], fileName = "rentals.csv") {
  const log = await admin.send<ImportLog>(
    "POST",
    "/api/imports",
    { module: "test_rentals", fileName, rowCount: rows.length },
    201,
  );
  const results: ImportBatchResult["results"] = [];
  for (let start = 0; start < rows.length; start += 100) {
    const batch = await admin.send<ImportBatchResult>(
      "POST",
      `/api/imports/${log.id}/rows`,
      { rows: rows.slice(start, start + 100) },
    );
    results.push(...batch.results);
  }
  const done = await admin.send<ImportLog>(
    "POST",
    `/api/imports/${log.id}/complete`,
  );
  return { log: done, results };
}
const items = () => db.select().from(inventoryItems);
const movementsOf = (itemId: string) =>
  db.select().from(stockMovements).where(eq(stockMovements.itemId, itemId));
const auditsOf = (entityId: string) =>
  db.select().from(auditLog).where(eq(auditLog.entityId, entityId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table consumable_allocations, event_requirements, reservation_conflicts, reservations, recipe_lines, recipes, import_keys, import_logs, audit_log, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, inventory_sections, ingest_receipts, jobs`,
  );
  warehouse = await admin.send<Section>(
    "POST",
    "/api/inventory/sections",
    { name: "Warehouse", kind: "rental" },
    201,
  );
});
afterAll(async () => {
  // beforeEach clears inventory_sections; give later files the seeded defaults back.
  await restoreDefaultSections(client);
  await client.end();
});

describe("importers", () => {
  it("lists only the importers the user may run", async () => {
    const modules = await admin.send<ImportModuleInfo[]>(
      "GET",
      "/api/imports/modules",
    );
    expect(modules.map((module) => module.key)).toEqual(["test_rentals"]);
    expect(modules[0].transforms).toEqual([
      { type: "category_headers", field: "category" },
    ]);
    expect(
      await partTimeStaff.send("GET", "/api/imports/modules"),
    ).toEqual([]);
    expect(
      (
        await partTimeStaff.call("POST", "/api/imports/dry-run", {
          module: "test_rentals",
          rows: [chairs()],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.call("POST", "/api/imports/dry-run", {
          module: "nothing",
          rows: [chairs()],
        })
      ).status,
    ).toBe(404);
  });
});

describe("dry run", () => {
  it("reports creates, updates, unchanged rows, errors and possible duplicates without writing", async () => {
    await runImport([chairs()]);
    // An item of the same name that no import created.
    await admin.send(
      "POST",
      "/api/inventory/items",
      { kind: "rental", subtype: "furniture", name: '60" Round Table' },
      201,
    );
    const before = (await items()).length;
    const plans = await admin.send<ImportRowPlan[]>(
      "POST",
      "/api/imports/dry-run",
      {
        module: "test_rentals",
        rows: [
          chairs(),
          { ...chairs({ name: "Chiavari Chair (gold)" }), rowNumber: 3 },
          { ...tables(), rowNumber: 4 },
          row(5, { code: "", name: "", quantity: "-1" }),
          row(6, { code: "LN-1", name: "Linen", section: "Basement" }),
        ],
      },
    );
    expect(plans.map((plan) => [plan.rowNumber, plan.action])).toEqual([
      [2, "skip"],
      [3, "update"],
      [4, "create"],
      [5, "error"],
      [6, "error"],
    ]);
    expect(plans[2].duplicates.map((match) => match.label)).toEqual([
      '60" Round Table',
    ]);
    expect(plans[3].errors).toEqual([
      "Code is required.",
      "Name is required.",
      "Quantity must be a number of 0 or more.",
    ]);
    expect(plans[4].errors).toEqual(["There's no rental section named Basement."]);
    expect(plans[1].externalKey).toBe("CH-001");
    expect((await items()).length).toBe(before);
  });
});

describe("commit (FLOW-47)", () => {
  it("logs who imported which file, when, and the counts", async () => {
    const { log, results } = await runImport([chairs(), tables()], "Master.xlsx");
    expect(log).toMatchObject({
      module: "test_rentals",
      fileName: "Master.xlsx",
      status: "completed",
      rowCount: 2,
      created: 2,
      updated: 0,
      skipped: 0,
      failed: 0,
      createdBy: people.admin,
    });
    expect(log.completedAt).not.toBeNull();
    expect(results.map((result) => result.outcome)).toEqual(["created", "created"]);
    const listed = await admin.send<ImportLog[]>(
      "GET",
      "/api/imports?module=test_rentals",
    );
    expect(listed.map((entry) => entry.id)).toEqual([log.id]);
    // A finished import takes no more rows.
    expect(
      (
        await admin.call("POST", `/api/imports/${log.id}/rows`, {
          rows: [chairs()],
        })
      ).status,
    ).toBe(409);
  });

  it("AC1: re-importing the same file creates no duplicates", async () => {
    const first = await runImport([chairs(), tables()]);
    const again = await runImport([chairs(), tables()]);
    expect((await items()).length).toBe(2);
    expect(await db.select().from(importKeys)).toHaveLength(2);
    expect(again.results.map((result) => result.outcome)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(again.results.map((result) => result.recordId)).toEqual(
      first.results.map((result) => result.recordId),
    );
    // A changed row updates the record it created.
    const renamed = await runImport([chairs({ name: "Chiavari Chair, gold" })]);
    expect(renamed.log).toMatchObject({ updated: 1, created: 0 });
    expect((await items()).length).toBe(2);
    const [chair] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.code, "CH-001"));
    expect(chair.name).toBe("Chiavari Chair, gold");
  });

  it("AC1: rows sharing a key in one file update the first row's record", async () => {
    const { results } = await runImport([
      chairs(),
      { ...chairs({ name: "Chiavari Chair, silver" }), rowNumber: 3 },
    ]);
    expect(results.map((result) => result.outcome)).toEqual([
      "created",
      "updated",
    ]);
    expect((await items()).length).toBe(1);
  });

  it("AC2: a row with an error is reported and skipped without blocking the other rows", async () => {
    // An item outside the import already uses TB-060, so creating it fails in
    // the database step, after the row's own checks passed.
    await admin.send(
      "POST",
      "/api/inventory/items",
      { kind: "rental", subtype: "furniture", code: "TB-060", name: "Old table" },
      201,
    );
    const { log, results } = await runImport([
      chairs(),
      tables(),
      row(4, { code: "LN-1", name: "" }),
      row(5, { code: "UP-1", name: "Uplight", section: "Basement" }),
      row(6, { code: "BR-1", name: "Bar", section: "Warehouse", quantity: "4" }),
    ]);
    expect(results.map((result) => [result.rowNumber, result.outcome])).toEqual([
      [2, "created"],
      [3, "failed"],
      [4, "failed"],
      [5, "failed"],
      [6, "created"],
    ]);
    expect(results[1].error).toBe("Code TB-060 is already used by Old table.");
    expect(results[2].error).toBe("Name is required.");
    expect(results[3].error).toBe("There's no rental section named Basement.");
    expect(log).toMatchObject({ created: 2, failed: 3 });
    // The failed row left nothing behind: no item, key, stock or audit row.
    const codes = (await items()).map((item) => item.code).sort();
    expect(codes).toEqual(["BR-1", "CH-001", "TB-060"]);
    expect(
      (await db.select().from(importKeys)).map((key) => key.externalKey).sort(),
    ).toEqual(["BR-1", "CH-001"]);
  });

  it("AC3: a batch request takes at most 100 rows", async () => {
    const log = await admin.send<ImportLog>(
      "POST",
      "/api/imports",
      { module: "test_rentals", fileName: "big.csv", rowCount: 101 },
      201,
    );
    const many = Array.from({ length: 101 }, (_, index) =>
      row(index + 2, { code: `IT-${index}`, name: `Item ${index}` }),
    );
    expect(
      (await admin.call("POST", `/api/imports/${log.id}/rows`, { rows: many }))
        .status,
    ).toBe(400);
    expect(
      (
        await admin.call("POST", "/api/imports/dry-run", {
          module: "test_rentals",
          rows: many,
        })
      ).status,
    ).toBe(400);
    const { results } = await admin.send<ImportBatchResult>(
      "POST",
      `/api/imports/${log.id}/rows`,
      { rows: many.slice(0, 100) },
    );
    expect(results).toHaveLength(100);
  });
});

describe("imported stock (FLOW-168)", () => {
  it("AC1: starting quantities arrive as count movements linked to the import log", async () => {
    const { log, results } = await runImport([chairs(), tables()]);
    const chairId = results[0].recordId!;
    const [movement] = await movementsOf(chairId);
    expect(movement).toMatchObject({
      type: "count",
      quantity: 120,
      sectionId: warehouse.id,
      linkType: "import",
      linkId: log.id,
      reason: "Imported from rentals.csv",
    });
    const item = await admin.send<InventoryItem>(
      "GET",
      `/api/inventory/items/${chairId}`,
    );
    expect(item.totalQuantity).toBe(120);
    // Ledger invariant: the cached on-hand equals the sum of movements.
    const [{ total }] = await db
      .select({ total: sql<string>`sum(${stockMovements.quantity})` })
      .from(stockMovements)
      .where(eq(stockMovements.itemId, chairId));
    const [cached] = await db
      .select()
      .from(inventoryStock)
      .where(
        and(
          eq(inventoryStock.itemId, chairId),
          eq(inventoryStock.sectionId, warehouse.id),
        ),
      );
    expect(Number(total)).toBe(120);
    expect(cached.quantity).toBe(120);
  });

  it("a re-import sets the section back to the file's quantity with a count for the difference", async () => {
    const { results } = await runImport([chairs()]);
    const chairId = results[0].recordId!;
    await admin.send(
      "POST",
      `/api/inventory/items/${chairId}/movements`,
      { type: "damage_loss", sectionId: warehouse.id, quantity: 2, reason: "Broken" },
      201,
    );
    const again = await runImport([chairs()], "recount.csv");
    expect(again.results.map((result) => result.outcome)).toEqual(["updated"]);
    const recount = (await movementsOf(chairId)).filter(
      (movement) => movement.linkId === again.log.id,
    );
    expect(recount).toMatchObject([
      { type: "count", quantity: 2, reason: "Imported from recount.csv" },
    ]);
    const item = await admin.send<InventoryItem>(
      "GET",
      `/api/inventory/items/${chairId}`,
    );
    expect(item.totalQuantity).toBe(120);

    // A matching quantity records nothing; a blank one leaves stock alone.
    const matching = await runImport([chairs()]);
    expect(matching.results.map((result) => result.outcome)).toEqual(["skipped"]);
    await runImport([chairs({ name: "Chiavari Chair, gold", quantity: "" })]);
    expect(await movementsOf(chairId)).toHaveLength(3);
  });

  it("AC2: each stock movement has one audit row, written in its transaction", async () => {
    const { results } = await runImport([chairs()]);
    const chairId = results[0].recordId!;
    const [count] = await movementsOf(chairId);
    const [audit] = await auditsOf(count.id);
    expect(audit).toMatchObject({
      entityType: "stock_movement",
      action: "create",
      createdBy: people.admin,
    });
    expect(audit.changes).toMatchObject({
      itemId: { before: null, after: chairId },
      type: { before: null, after: "count" },
      quantity: { before: null, after: 120 },
    });

    // A transfer is two movements, so two audit rows.
    const cafe = await admin.send<Section>(
      "POST",
      "/api/inventory/sections",
      { name: "Cafe", kind: "rental" },
      201,
    );
    await admin.send(
      "POST",
      `/api/inventory/items/${chairId}/transfers`,
      { fromSectionId: warehouse.id, toSectionId: cafe.id, quantity: 20 },
      201,
    );
    const transfer = (await movementsOf(chairId)).filter(
      (movement) => movement.type === "transfer",
    );
    expect(transfer).toHaveLength(2);
    for (const movement of transfer)
      expect(await auditsOf(movement.id)).toHaveLength(1);

    // A rolled-back movement leaves no audit row.
    let rolledBack: string[] = [];
    await db
      .transaction(async (tx) => {
        rolledBack = await recordMovement(
          tx,
          admin.actor,
          await findItem(tx, chairId),
          {
            type: "adjust",
            changes: [{ sectionId: warehouse.id, quantity: 5 }],
            reason: "",
          },
        );
        tx.rollback();
      })
      .catch(() => undefined);
    expect(rolledBack).toHaveLength(1);
    expect(await auditsOf(rolledBack[0])).toEqual([]);
  });

  it("the import log row is what movements link to", async () => {
    const { log } = await runImport([chairs()]);
    const [stored] = await db
      .select()
      .from(importLogs)
      .where(eq(importLogs.id, log.id));
    const linked = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.linkId, stored.id));
    expect(linked).toHaveLength(1);
  });
});
