import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import {
  importKeys,
  inventoryConsumableDetails,
  allInventoryItems,
  inventoryRentalDetails,
  inventoryLocations,
  inventoryStock,
  stockMovements,
  vendors,
  barInventoryItems,
  kitchenIngredients,
  masterInventoryItems,
} from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import { restoreDefaultSections } from "../reference-data";
import type { Actor } from "../../../shared/access";
import {
  barInventoryFields,
  kitchenInventoryFields,
  masterInventoryFields,
} from "../../../shared/import-inventory";
import {
  applyTransformsWithNotes,
  autoMap,
  headingIndex,
  mapRows,
  type ImportBatchResult,
  type ImportLog,
  type ImportRow,
  type ImportRowPlan,
} from "../../../shared/imports";
import { parseCsv } from "../../../src/services/import-files";
import { barInventoryCsv } from "../../fixtures/bar-inventory";
import { masterInventoryCsv } from "../../fixtures/master-inventory";
import { kitchenInventoryCsv } from "../../fixtures/kitchen-inventory";

// The Master Inventory (FLOW-78) and Bar Inventory (FLOW-91) importers through
// the import framework, against the CI Postgres service, on synthetic copies of
// the real files' layouts (ADR-27).
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const actor = (
  userId: string,
  employmentType: Actor["employmentType"] = "full_time",
  role: Actor["role"] = "admin",
): Actor => ({ userId, role: employmentType === "part_time" ? "part_time_staff" : role, employmentType });
const signedInAs = (who: Actor) => {
  const app = createApp({ withDb, resolveActor: async () => who });
  return async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await app.request(
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
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(status);
    return json as T;
  };
};
const admin = signedInAs(actor("c1000000-0000-4000-8000-000000000001"));

const sheetRows = (
  csv: string,
  fields: typeof masterInventoryFields,
  layout: "master" | "bar" | "kitchen",
): ImportRow[] => {
  const sheet = parseCsv(csv);
  const mapping = autoMap(sheet[headingIndex(sheet)], fields);
  return applyTransformsWithNotes(mapRows(sheet, mapping), [
    { type: "inventory_rows", layout },
  ]).rows;
};
const masterRows = () => sheetRows(masterInventoryCsv, masterInventoryFields, "master");
const barRows = () => sheetRows(barInventoryCsv, barInventoryFields, "bar");
const kitchenRows = () => sheetRows(kitchenInventoryCsv, kitchenInventoryFields, "kitchen");

const dryRun = (module: string, rows: ImportRow[]) =>
  admin<ImportRowPlan[]>("POST", "/api/imports/dry-run", { module, rows });
async function runImport(module: string, rows: ImportRow[], fileName: string) {
  const log = await admin<ImportLog>(
    "POST",
    "/api/imports",
    { module, fileName, rowCount: rows.length },
    201,
  );
  const results: ImportBatchResult["results"] = [];
  for (let start = 0; start < rows.length; start += 100)
    results.push(
      ...(
        await admin<ImportBatchResult>("POST", `/api/imports/${log.id}/rows`, {
          rows: rows.slice(start, start + 100),
        })
      ).results,
    );
  return {
    log: await admin<ImportLog>("POST", `/api/imports/${log.id}/complete`),
    results,
  };
}

const itemNamed = async (name: string) => {
  const [item] = await db.select().from(allInventoryItems).where(eq(allInventoryItems.name, name));
  expect(item, `item ${name}`).toBeDefined();
  return item;
};
const stockOf = async (name: string) => {
  const item = await itemNamed(name);
  const levels = await db
    .select({ section: inventoryLocations.name, quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryStock.sectionId))
    .where(eq(inventoryStock.itemId, item.id));
  return levels.filter((level) => level.quantity !== 0);
};
const rentalOf = async (name: string) => {
  const item = await itemNamed(name);
  const [details] = await db
    .select()
    .from(inventoryRentalDetails)
    .where(eq(inventoryRentalDetails.itemId, item.id));
  return details;
};
const consumableOf = async (name: string) => {
  const item = await itemNamed(name);
  const [details] = await db
    .select()
    .from(inventoryConsumableDetails)
    .where(eq(inventoryConsumableDetails.itemId, item.id));
  return details;
};
const vendorNamed = async (name: string) => {
  const [vendor] = await db.select().from(vendors).where(eq(vendors.name, name));
  return vendor;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table import_keys, import_logs, audit_log, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, master_inventory_items, bar_inventory_items, kitchen_ingredients, inventory_locations, vendors, jobs cascade`,
  );
  await restoreDefaultSections(client);
});
afterAll(async () => {
  await restoreDefaultSections(client);
  await client.end();
});

describe("Master Inventory importer (FLOW-78)", () => {
  it("is listed with its row rules", async () => {
    const modules = await admin<{ key: string; transforms: unknown[] }[]>(
      "GET",
      "/api/imports/modules",
    );
    expect(modules.map((module) => module.key)).toEqual([
      "master_inventory",
      "bar_inventory",
      "kitchen_inventory",
      "events",
    ]);
    expect(modules[0].transforms).toEqual([{ type: "inventory_rows", layout: "master" }]);
  });

  it("dry-runs the whole file without errors and without writing (AC1)", async () => {
    const rows = masterRows();
    const plans = await dryRun("master_inventory", rows);
    expect(plans).toHaveLength(rows.length);
    expect(plans.filter((plan) => plan.action === "error")).toEqual([]);
    expect(plans.every((plan) => plan.action === "create" && plan.summary)).toBe(true);
    expect(await db.select().from(allInventoryItems)).toHaveLength(0);
    expect(await db.select().from(vendors)).toHaveLength(0);
  });

  it("imports each row as an item with its category, subcategory, kind, pull owner, flags and opening stock", async () => {
    const { log } = await runImport("master_inventory", masterRows(), "Main.csv");
    expect(log).toMatchObject({ created: 14, updated: 0, skipped: 0, failed: 0 });

    const chafer = await itemNamed("Sample Wire Chafer");
    expect(chafer).toMatchObject({
      kind: "rental",
      subtype: "equipment",
      category: "On-site Kitchen",
      subcategory: "Heating",
      pullOwner: "pull_lead",
      flags: [],
    });
    expect(await stockOf("Sample Wire Chafer")).toEqual([{ section: "Warehouse", quantity: 4 }]);
    const rental = await rentalOf("Sample Wire Chafer");
    expect(rental.internalCostCents).toBe(4000);
    // The Distributor is where it was bought, not a sub-rental vendor.
    expect(rental.supplierId).toBe((await vendorNamed("Sample Store")).id);
    expect(rental.vendorId).toBeNull();

    const sternos = await itemNamed("Sternos - sample pack");
    expect(sternos).toMatchObject({ kind: "consumable", subtype: "supply", description: "72 pk" });
    expect(sternos.flags).toEqual(["needs_cost"]);
    expect(await stockOf("Sternos - sample pack")).toEqual([{ section: "Warehouse", quantity: 1 }]);

    expect((await itemNamed("Menu Card Design")).kind).toBe("service");
    expect(await stockOf("Menu Card Design")).toEqual([]);
    for (const variant of ["wireless", "wired", "clip-on"])
      expect((await itemNamed(`Sample Microphone – ${variant}`)).kind).toBe("rental");
    expect(await db.select().from(allInventoryItems).where(eq(allInventoryItems.name, "Sample Cutting Board"))).toHaveLength(1);

    const fork = await itemNamed("Sample Plastic Fork");
    expect(fork.flags).toEqual(["needs_count"]);
    expect(await stockOf("Sample Plastic Fork")).toEqual([]);

    const loose = await itemNamed("Sample Loose Item");
    expect(loose).toMatchObject({ category: "Uncategorized", pullOwner: null });
    expect(loose.flags).toEqual(["confirm_location", "needs_category", "needs_cost", "needs_count"]);

    // Storage Box is one of the default locations (FLOW-289).
    const [box] = await db.select().from(inventoryLocations).where(eq(inventoryLocations.name, "Storage Box"));
    expect(box.kind).toBe("location");
    expect(await stockOf("Sample Padded Chair")).toEqual([{ section: "Warehouse", quantity: 3 }]);
    // The sheet's "Jamie's" is Jamie's - Main Floor, never a new location (Ash, 2026-11-23).
    expect(await db.select().from(inventoryLocations).where(eq(inventoryLocations.name, "Jamie's"))).toEqual([]);
  });

  it("changes nothing when the file is imported again (AC4)", async () => {
    const rows = masterRows();
    await runImport("master_inventory", rows, "Main.csv");
    const [movements, items, keys] = [
      await db.select().from(stockMovements),
      await db.select().from(allInventoryItems),
      await db.select().from(importKeys),
    ];
    const plans = await dryRun("master_inventory", rows);
    expect(plans.map((plan) => plan.action)).toEqual(rows.map(() => "skip"));
    const { log } = await runImport("master_inventory", rows, "Main.csv");
    expect(log).toMatchObject({ created: 0, updated: 0, skipped: rows.length, failed: 0 });
    expect(await db.select().from(stockMovements)).toEqual(movements);
    expect(await db.select().from(allInventoryItems)).toEqual(items);
    expect(await db.select().from(importKeys)).toHaveLength(keys.length);
  });

  it("updates only the rows that changed, and keeps what the file doesn't carry", async () => {
    const rows = masterRows();
    await runImport("master_inventory", rows, "Main.csv");
    // Staff price the chafer and add a color after the import.
    await db
      .update(inventoryRentalDetails)
      .set({ priceCents: 1500, colors: ["silver"] })
      .where(eq(inventoryRentalDetails.itemId, (await itemNamed("Sample Wire Chafer")).id));
    const changed = rows.map((row) =>
      row.values.item === "Sample Wire Chafer"
        ? { ...row, values: { ...row.values, qty: "6", cost: "45", description: "wire frame" } }
        : row,
    );
    const plans = await dryRun("master_inventory", changed);
    expect(plans.filter((plan) => plan.action !== "skip").map((plan) => [plan.rowNumber, plan.action])).toEqual([[2, "update"]]);

    const { log } = await runImport("master_inventory", changed, "Main.csv");
    expect(log).toMatchObject({ created: 0, updated: 1, skipped: rows.length - 1 });
    const rental = await rentalOf("Sample Wire Chafer");
    expect(rental).toMatchObject({ priceCents: 1500, internalCostCents: 4500, colors: ["silver"] });
    expect((await itemNamed("Sample Wire Chafer")).description).toBe("wire frame");
    // The file's quantity overwrites the section's stock.
    expect(await stockOf("Sample Wire Chafer")).toEqual([{ section: "Warehouse", quantity: 6 }]);
  });

  it("reports an unreadable row without failing the others", async () => {
    const rows = masterRows();
    const bad = rows.map((row, index) =>
      index === 0 ? { ...row, values: { ...row.values, cost: "lots" } } : row,
    );
    const plans = await dryRun("master_inventory", bad);
    expect(plans[0]).toMatchObject({ action: "error", errors: ['Cost "lots" isn\'t a number.'] });
    const { log } = await runImport("master_inventory", bad, "Main.csv");
    expect(log).toMatchObject({ created: rows.length - 1, failed: 1 });
  });

  it("is not available to anyone but the Admin, even with inventory write (FLOW-290 AC1)", async () => {
    const partTime = signedInAs(actor("c1000000-0000-4000-8000-000000000002", "part_time", "staff"));
    await partTime("POST", "/api/imports/dry-run", { module: "master_inventory", rows: masterRows() }, 403);
    const technical = signedInAs(actor("c1000000-0000-4000-8000-000000000003", "full_time", "technical"));
    await technical("POST", "/api/imports/dry-run", { module: "master_inventory", rows: masterRows() }, 403);
  });
});

describe("Bar Inventory importer (FLOW-91)", () => {
  it("dry-runs the whole file with each item's category, subcategory, tier, unit and quantity (AC1)", async () => {
    const rows = barRows();
    const plans = await dryRun("bar_inventory", rows);
    expect(plans.filter((plan) => plan.action === "error")).toEqual([]);
    expect(plans).toHaveLength(18);
    expect(plans.find((plan) => plan.rowNumber === 19)?.summary).toBe(
      "Liquor / Vodka · tier mid · each · qty 3.25",
    );
    expect(plans.find((plan) => plan.rowNumber === 4)?.notes).toEqual([
      "Suggested spelling: Coors Lite → Coors Light.",
    ]);
    expect(await db.select().from(allInventoryItems)).toHaveLength(0);
  });

  it("imports bar stock with its category, subcategory, tier, pack and opening count", async () => {
    const { log } = await runImport("bar_inventory", barRows(), "Master Sheet.csv");
    expect(log).toMatchObject({ created: 18, updated: 0, skipped: 0, failed: 0 });

    const lager = await itemNamed("Sample Lager");
    expect(lager).toMatchObject({ kind: "consumable", subtype: "bar", category: "Beer", unit: "case" });
    expect(await consumableOf("Sample Lager")).toMatchObject({ purchaseUnit: "case", packCount: 24 });
    expect(await stockOf("Sample Lager")).toEqual([{ section: "Warehouse", quantity: 4 }]);

    expect(await itemNamed("Sample Mid Vodka")).toMatchObject({ category: "Liquor", tier: "mid" });
    expect((await itemNamed("Sample Mid Vodka")).description).toContain("Tier: mid/high");
    expect(await stockOf("Sample Mid Vodka")).toEqual([{ section: "Warehouse", quantity: 3.25 }]);
    expect(await stockOf("Sample Bubbles")).toEqual([{ section: "Warehouse", quantity: 3 }]);
    expect(await stockOf("Sample Cabernet")).toEqual([{ section: "Warehouse", quantity: 2 }]);
    expect(await stockOf("Sample Cranberry")).toEqual([{ section: "Warehouse", quantity: 3 }]);
    expect(await consumableOf("Sample Cranberry")).toMatchObject({ purchaseUnit: "each", eachSizeQuantity: 64, eachSizeUnit: "fl_oz" });

    // Unreadable counts import as 0 with the text kept.
    const cola = await itemNamed("Sample Cola");
    expect(cola.flags).toEqual(["needs_count"]);
    expect(cola.description).toBe("Sheet quantity: 1/2 case");
    expect(await stockOf("Sample Cola")).toEqual([]);

    // The same name under two liquor types is two items.
    expect(await db.select().from(allInventoryItems).where(eq(allInventoryItems.name, "Sample Rail Vodka"))).toHaveLength(2);
  });

  it("links the wines to Impero Wine Distributors (AC2)", async () => {
    await runImport("bar_inventory", barRows(), "Master Sheet.csv");
    const impero = await vendorNamed("Impero Wine Distributors");
    expect(impero.type).toBe("beverage_distributor");
    for (const name of ["Sample Pinot Grigio", "Sample Cabernet"])
      expect((await consumableOf(name)).preferredVendorId).toBe(impero.id);
    // "-", blank and asterisk text mean no distributor; a bracketed note is dropped.
    expect((await consumableOf("Sample NA Beer")).preferredVendorId).toBeNull();
    expect((await consumableOf("Sample Reserve")).preferredVendorId).toBeNull();
    expect(await vendorNamed("Hop & Wine")).toBeDefined();
    expect(await db.select().from(vendors).where(and(eq(vendors.name, "Impero Wine Distributors")))).toHaveLength(1);
  });

  it("changes nothing when the file is imported again (AC3)", async () => {
    const rows = barRows();
    await runImport("bar_inventory", rows, "Master Sheet.csv");
    const before = {
      movements: await db.select().from(stockMovements),
      items: await db.select().from(allInventoryItems),
    };
    expect((await dryRun("bar_inventory", rows)).map((plan) => plan.action)).toEqual(rows.map(() => "skip"));
    const { log } = await runImport("bar_inventory", rows, "Master Sheet.csv");
    expect(log).toMatchObject({ created: 0, updated: 0, skipped: rows.length, failed: 0 });
    expect(await db.select().from(stockMovements)).toEqual(before.movements);
    expect(await db.select().from(allInventoryItems)).toEqual(before.items);
  });

  it("reports a count that breaks the rounding rule as a failed row", async () => {
    const rows = barRows().map((row) =>
      row.values.item === "Sample Lager" ? { ...row, values: { ...row.values, qty: "4.3" } } : row,
    );
    const { log, results } = await runImport("bar_inventory", rows, "Master Sheet.csv");
    expect(log).toMatchObject({ created: 17, failed: 1 });
    expect(results.find((result) => result.outcome === "failed")?.error).toBe(
      "Count beer and wine to the nearest 0.5.",
    );
  });
});

describe("Kitchen Inventory importer (FLOW-89)", () => {
  it("dry-runs the whole file without errors, showing each item's storage, without writing (AC1)", async () => {
    const rows = kitchenRows();
    const plans = await dryRun("kitchen_inventory", rows);
    expect(plans).toHaveLength(rows.length);
    expect(plans.filter((plan) => plan.action === "error")).toEqual([]);
    expect(plans.every((plan) => plan.action === "create")).toBe(true);
    expect(plans.find((plan) => plan.rowNumber === 6)?.summary).toBe("Dessert / Ice Creams · Freezer · qty 0 · Needs count, Needs cost");
    expect(await db.select().from(allInventoryItems)).toHaveLength(0);
  });

  it("imports each ingredient with its category, subcategory, storage, quantity, cost and distributor (AC2, AC3)", async () => {
    const { log } = await runImport("kitchen_inventory", kitchenRows(), "Kitchen_Ingredient_Inventory_List - Sheet1.csv");
    expect(log).toMatchObject({ created: 10, updated: 0, skipped: 0, failed: 0 });

    const basil = await itemNamed("Sample Basil");
    expect(basil).toMatchObject({ kind: "consumable", subtype: "ingredient", category: "Produce", subcategory: "Herbs", flags: [] });
    expect(await stockOf("Sample Basil")).toEqual([{ section: "Fridge", quantity: 3 }]);
    const basilDetails = await consumableOf("Sample Basil");
    expect(basilDetails.unitCostCents).toBe(450);
    const produce = await vendorNamed("Sample Produce Co");
    expect(basilDetails.preferredVendorId).toBe(produce.id);
    expect((await consumableOf("Sample Cheddar")).preferredVendorId).toBe(produce.id);
    expect(await db.select().from(vendors)).toHaveLength(1);

    const storage = async (name: string) => {
      const details = await consumableOf(name);
      const [section] = await db.select().from(inventoryLocations).where(eq(inventoryLocations.id, details.storageSectionId!));
      return [section.name, section.kind];
    };
    expect(await storage("Sample Chicken Thigh")).toEqual(["Fridge", "storage"]);
    expect(await storage("Sample Vanilla Scoop")).toEqual(["Freezer", "storage"]);
    expect(await storage("Sample Brownie Mix")).toEqual(["Pantry", "storage"]);
    expect(await storage("Sample Dumplings")).toEqual(["Freezer", "storage"]);
    expect(await storage("Sample Jasmine Rice")).toEqual(["Pantry", "storage"]);

    const chicken = await itemNamed("Sample Chicken Thigh");
    expect(chicken.flags).toEqual(["needs_cost", "needs_count"]);
    expect(await stockOf("Sample Chicken Thigh")).toEqual([]);
    expect((await consumableOf("Sample Chicken Thigh")).unitCostCents).toBeNull();
    // The merged duplicate made one ingredient; no kitchen storage was added.
    expect(await db.select().from(allInventoryItems).where(eq(allInventoryItems.name, "Sample Basil"))).toHaveLength(1);
    expect((await db.select().from(inventoryLocations).where(eq(inventoryLocations.kind, "storage"))).map((section) => section.name).sort())
      .toEqual(["Freezer", "Fridge", "Pantry"]);
  });

  it("changes nothing when the file is imported again (AC4)", async () => {
    const rows = kitchenRows();
    await runImport("kitchen_inventory", rows, "Kitchen.csv");
    const before = {
      movements: await db.select().from(stockMovements),
      items: await db.select().from(allInventoryItems),
    };
    expect((await dryRun("kitchen_inventory", rows)).map((plan) => plan.action)).toEqual(rows.map(() => "skip"));
    const { log } = await runImport("kitchen_inventory", rows, "Kitchen.csv");
    expect(log).toMatchObject({ created: 0, updated: 0, skipped: rows.length, failed: 0 });
    expect(await db.select().from(stockMovements)).toEqual(before.movements);
    expect(await db.select().from(allInventoryItems)).toEqual(before.items);
  });
});

describe("Settings › Imports lists (FLOW-290)", () => {
  it("AC4: Master, Bar and Kitchen each fill their own table and nothing crosses", async () => {
    await runImport("kitchen_inventory", kitchenRows(), "Kitchen.csv");
    expect(await db.select().from(masterInventoryItems)).toEqual([]);
    expect(await db.select().from(barInventoryItems)).toEqual([]);
    const kitchen = await db.select().from(kitchenIngredients);
    expect(kitchen).toHaveLength(10);

    await runImport("master_inventory", masterRows(), "Main.csv");
    await runImport("bar_inventory", barRows(), "Master Sheet.csv");
    const [master, bar] = [await db.select().from(masterInventoryItems), await db.select().from(barInventoryItems)];
    expect(master.length).toBeGreaterThan(0);
    expect(bar.length).toBeGreaterThan(0);
    expect(master.every((item) => item.kind !== "consumable" || item.subtype === "supply")).toBe(true);
    expect(bar.every((item) => item.subtype === "bar")).toBe(true);
    expect(await db.select().from(kitchenIngredients)).toEqual(kitchen);
  });

  it("AC5: re-running a changed count only resets that location's quantity to the file's", async () => {
    const rows = kitchenRows();
    await runImport("kitchen_inventory", rows, "Kitchen.csv");
    const changed = rows.map((row) => (row.values.item === "Sample Basil" ? { ...row, values: { ...row.values, qty: "7" } } : row));
    const plans = await dryRun("kitchen_inventory", changed);
    expect(plans.filter((plan) => plan.action !== "skip").map((plan) => plan.rowNumber)).toEqual([4]);
    const items = await db.select().from(allInventoryItems);
    await runImport("kitchen_inventory", changed, "Kitchen.csv");
    expect(await stockOf("Sample Basil")).toEqual([{ section: "Fridge", quantity: 7 }]);
    const ids = (list: { id: string }[]) => list.map((item) => item.id).sort();
    expect(ids(await db.select().from(allInventoryItems))).toEqual(ids(items));
    expect(await stockOf("Sample Cheddar")).toEqual([{ section: "Fridge", quantity: 2 }]);
  });
});
