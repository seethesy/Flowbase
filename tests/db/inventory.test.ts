import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import {
  inventorySections,
  inventoryStock,
  jobs,
  stockMovements,
} from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { restoreDefaultSections } from "./reference-data";
import type { RunWithDb } from "../../worker/hono";
import {
  findItem,
  recordMovement,
  recordImportedStock,
} from "../../worker/records/inventory";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type {
  CostChange,
  InventoryItem,
  ItemInput,
  Section,
  StockCount,
  StockMovement,
} from "../../shared/inventory";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

// Version-checked saves (FLOW-186): an item PUT carries the item's current
// updatedAt.
const versionOf = async (id: string) =>
  (
    await db
      .select({ updatedAt: schema.inventoryItems.updatedAt })
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.id, id))
  )[0].updatedAt.toISOString();
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "b0000000-0000-4000-8000-000000000001",
  lead: "b0000000-0000-4000-8000-000000000002",
  cook: "b0000000-0000-4000-8000-000000000003",
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
  return {
    actor,
    call,
    get: async <T>(path: string) => {
      const response = await call("GET", path);
      expect(response.status).toBe(200);
      return (await response.json()) as T;
    },
    send: async <T>(
      method: string,
      path: string,
      body: unknown,
      status = 200,
    ) => {
      const response = await call(method, path, body);
      const json = await response.json();
      expect(response.status, JSON.stringify(json)).toBe(status);
      return json as T;
    },
  };
};
const admin = signedInAs(people.admin, "admin");
const lead = signedInAs(people.lead, "kitchen_lead");
const partTimeLead = signedInAs(people.lead, "kitchen_lead", "part_time");
const cook = signedInAs(people.cook, "kitchen_staff", "part_time");
const fullTimeStaff = signedInAs(people.cook, "staff", "full_time");
const partTimeSales = signedInAs(people.cook, "salesperson", "part_time");
const partTimeStaff = signedInAs(people.cook, "staff", "part_time");

describe("rental, kit and service catalogs (FLOW-72/79/80/92)", () => {
  it("persists rental details, redacts both costs, preserves hidden costs on edits and prevents direct repricing", async () => {
    const input: ItemInput = {
      kind: "rental",
      subtype: "decor",
      name: "Sash",
      rental: {
        priceCents: 300,
        internalCostCents: 100,
        replacementCostCents: 500,
        colors: ["Gold", "Silver"],
        dimensions: "8 × 100 inches",
        assemblyNotes: "Tie to chair",
        bufferDaysBefore: 2,
        bufferDaysAfter: 3,
      },
    };
    const row = await createItem(input);
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${row.id}`)).rental,
    ).toMatchObject(input.rental!);
    for (const user of [fullTimeStaff, partTimeStaff, cook]) {
      const read = await user.get<InventoryItem>(
        `/api/inventory/items/${row.id}`,
      );
      expect(read.rental).toMatchObject({
        priceCents: 300,
        internalCostCents: null,
        replacementCostCents: null,
      });
    }
    const changed = await admin.send<InventoryItem>(
      "PUT",
      `/api/inventory/items/${row.id}`,
      { updatedAt: await versionOf(row.id),
        ...input,
        rental: {
          ...input.rental,
          internalCostCents: undefined,
          replacementCostCents: undefined,
          notes: "Keep clean",
        },
      },
    );
    expect(changed.rental).toMatchObject({
      internalCostCents: 100,
      replacementCostCents: 500,
      notes: "Keep clean",
    });
    const proposer = signedInAs(people.lead, "technical");
    await proposer.send(
      "PUT",
      `/api/inventory/items/${row.id}`,
      { updatedAt: await versionOf(row.id),
        ...input,
        rental: {
          ...input.rental,
          priceCents: 400,
          internalCostCents: undefined,
          replacementCostCents: undefined,
        },
      },
      409,
    );
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${row.id}`)).rental
        ?.priceCents,
    ).toBe(300);
    await admin.send("PUT", `/api/inventory/items/${row.id}`, {
      updatedAt: await versionOf(row.id),
      ...input,
      rental: { ...input.rental, priceCents: 400 },
    });
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${row.id}`)).rental
        ?.priceCents,
    ).toBe(400);
  });

  it("keeps balances, transfers, counts and corrections separate for each color on one item", async () => {
    const warehouse = await section("Warehouse");
    const cafe = await section("Cafe");
    const input: ItemInput = {
      kind: "rental",
      subtype: "linen",
      name: "Chair sash",
      rental: { colors: ["Gold", "Silver"] },
    };
    const row = await createItem(input);
    for (const [color, quantity] of [
      ["Gold", 10],
      ["Silver", 5],
    ] as const)
      await admin.send(
        "POST",
        `/api/inventory/items/${row.id}/movements`,
        {
          type: "receive",
          sectionId: warehouse.id,
          color,
          quantity,
        },
        201,
      );
    await admin.send(
      "POST",
      `/api/inventory/items/${row.id}/transfers`,
      {
        fromSectionId: warehouse.id,
        toSectionId: cafe.id,
        color: "Gold",
        quantity: 4,
      },
      201,
    );
    await admin.send(
      "POST",
      `/api/inventory/items/${row.id}/transfers`,
      {
        fromSectionId: warehouse.id,
        toSectionId: cafe.id,
        color: "Silver",
        quantity: 6,
      },
      409,
    );
    await admin.send(
      "POST",
      `/api/inventory/items/${row.id}/counts`,
      {
        sectionId: warehouse.id,
        color: "Gold",
        quantity: 5,
      },
      201,
    );
    const movements = await admin.get<StockMovement[]>(
      `/api/inventory/items/${row.id}/movements`,
    );
    const receipt = movements.find(
      (m) => m.type === "receive" && m.color === "Silver",
    )!;
    await admin.send(
      "POST",
      `/api/inventory/movements/${receipt.id}/corrections`,
      { quantity: 7, reason: "Invoice" },
      201,
    );
    const result = await admin.get<InventoryItem>(
      `/api/inventory/items/${row.id}`,
    );
    expect(result.totalQuantity).toBe(16);
    expect(result.stock).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionId: warehouse.id,
          color: "Gold",
          quantity: 5,
        }),
        expect.objectContaining({
          sectionId: warehouse.id,
          color: "Silver",
          quantity: 7,
        }),
        expect.objectContaining({
          sectionId: cafe.id,
          color: "Gold",
          quantity: 4,
        }),
      ]),
    );
    await admin.send(
      "PUT",
      `/api/inventory/items/${row.id}`,
      { updatedAt: await versionOf(row.id), ...input, rental: { colors: ["Gold"] } },
      409,
    );
    await admin.send(
      "POST",
      `/api/inventory/items/${row.id}/movements`,
      { type: "receive", sectionId: warehouse.id, color: "Blue", quantity: 1 },
      409,
    );
    const ledger = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.itemId, row.id));
    for (const level of result.stock)
      expect(
        ledger
          .filter(
            (m) => m.sectionId === level.sectionId && m.color === level.color,
          )
          .reduce((sum, m) => sum + m.quantity, 0),
      ).toBe(level.quantity);
    const imported = () => db.transaction(async (tx) =>
      recordImportedStock(tx, admin.actor, await findItem(tx, row.id), {
        sectionId: warehouse.id,
        quantity: 3,
        importId: "e0000000-0000-4000-8000-000000000090",
        fileName: "colors.csv",
      }),
    );
    expect(await imported()).toBeTruthy();
    expect(await imported()).toBeNull();
    const afterImport = await admin.get<InventoryItem>(`/api/inventory/items/${row.id}`);
    expect(afterImport.totalQuantity).toBe(19);
    expect(afterImport.stock).toEqual(expect.arrayContaining(result.stock));
    expect(afterImport.stock).toContainEqual(expect.objectContaining({ sectionId: warehouse.id, quantity: 3 }));
  });

  it("stores mixed kit/service components and rejects direct and indirect cycles, missing and non-stock references", async () => {
    const glass = await createItem(chairs());
    const supply = await createItem({
      kind: "consumable",
      subtype: "supply",
      name: "Candle",
      consumable: { purchaseUnit: "each" },
    });
    const input: ItemInput = {
      kind: "rental",
      subtype: "decor",
      name: "Centerpiece",
      rental: {
        components: [
          { itemId: glass.id, quantity: 1 },
          { itemId: supply.id, quantity: 1 },
        ],
      },
    };
    const kit = await createItem(input);
    expect(kit.rental?.components).toEqual(input.rental?.components);
    const service = await createItem({
      kind: "service",
      name: "Setup",
      service: {
        pricedByQuote: true,
        includes: [
          { itemId: kit.id, quantity: 2, basis: "per_event" },
          { itemId: supply.id, quantity: 1, basis: "per_guest" },
        ],
        addons: [{ name: "Upgrade", priceCents: 50 }],
      },
    });
    expect(service.service).toMatchObject({
      pricedByQuote: true,
      addons: [{ name: "Upgrade", priceCents: 50 }],
    });
    expect(service.stock).toEqual([]);
    for (const componentId of [
      kit.id,
      service.id,
      "ffffffff-0000-4000-8000-000000000001",
    ])
      await admin.send(
        "PUT",
        `/api/inventory/items/${kit.id}`,
        { updatedAt: await versionOf(kit.id),
          ...input,
          rental: { components: [{ itemId: componentId, quantity: 1 }] },
        },
        componentId.startsWith("ffff") ? 404 : 409,
      );
    const second = await createItem({
      kind: "rental",
      subtype: "decor",
      name: "Nested",
      rental: { components: [{ itemId: kit.id, quantity: 1 }] },
    });
    await admin.send(
      "PUT",
      `/api/inventory/items/${kit.id}`,
      { updatedAt: await versionOf(kit.id),
        ...input,
        rental: { components: [{ itemId: second.id, quantity: 1 }] },
      },
      409,
    );
  });

  it("defaults supplies to Supplies storage and includes below-par supplies in the low-stock list", async () => {
    const storage = await section("Supplies", "consumable");
    const supply = await createItem({
      kind: "consumable",
      subtype: "supply",
      name: "Sternos",
      ratio: { quantity: 2, basis: "per_event" },
      consumable: { purchaseUnit: "case", packCount: 24, parLevel: 24 },
    });
    expect(supply.consumable?.storageSectionId).toBe(storage.id);
    const low = await admin.get<InventoryItem[]>(
      "/api/inventory/items?kind=consumable&subtype=supply&belowPar=true",
    );
    expect(low.map((row) => row.id)).toContain(supply.id);
  });
});

const section = (name: string, kind: "rental" | "consumable" = "rental") =>
  admin.send<Section>("POST", "/api/inventory/sections", { name, kind }, 201);
const createItem = (input: ItemInput, as = admin) =>
  as.send<InventoryItem>("POST", "/api/inventory/items", input, 201);
const count = (itemId: string, sectionId: string, quantity: number) =>
  admin.send<InventoryItem>(
    "POST",
    `/api/inventory/items/${itemId}/counts`,
    { sectionId, quantity },
    201,
  );
const chairs = (): ItemInput => ({
  kind: "rental",
  subtype: "furniture",
  code: "CH-001",
  name: "Chiavari Chair",
  color: "Gold",
});
const cream = (overrides: Partial<ItemInput> = {}): ItemInput => ({
  kind: "consumable",
  subtype: "ingredient",
  name: "Heavy Cream",
  category: "Dairy",
  unit: "qt",
  consumable: {
    purchaseUnit: "case",
    packCount: 6,
    eachSize: { quantity: 1, unit: "qt" },
    recipeUnit: "cup",
    unitCostCents: 2400,
    preferredVendor: "Sysco",
    parLevel: 6,
    allergens: ["milk"],
  },
  ...overrides,
});

let defaults: { name: string; kind: string }[] = [];
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  defaults = await db
    .select({ name: inventorySections.name, kind: inventorySections.kind })
    .from(inventorySections)
    .orderBy(inventorySections.kind, inventorySections.sortOrder);
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table recipe_lines, recipes, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, inventory_sections, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  // beforeEach clears inventory_sections; give later files the seeded defaults back.
  await restoreDefaultSections(client);
  await client.end();
});

describe("sections (FLOW-70)", () => {
  it("ships the default rental and storage sections", () => {
    expect(defaults).toEqual([
      { name: "Kitchen – Dry Storage", kind: "consumable" },
      { name: "Kitchen – Refrigerated", kind: "consumable" },
      { name: "Kitchen – Freezer", kind: "consumable" },
      { name: "Bar Storage", kind: "consumable" },
      { name: "Supplies", kind: "consumable" },
      { name: "Warehouse", kind: "rental" },
      { name: "Jamie's", kind: "rental" },
      { name: "Cafe", kind: "rental" },
      { name: "Vendor", kind: "rental" },
      { name: "Unlabeled", kind: "rental" },
    ]);
  });

  it("lets Admin add, rename, archive and restore a section", async () => {
    const tent = await section("Tent Trailer");
    const renamed = await admin.send<Section>(
      "PUT",
      `/api/inventory/sections/${tent.id}`,
      { name: "Trailer" },
    );
    expect(renamed.name).toBe("Trailer");
    await admin.send("POST", `/api/inventory/sections/${tent.id}/archive`, {});
    expect(
      (await admin.get<Section[]>("/api/inventory/sections")).map(
        (s) => s.name,
      ),
    ).toEqual([]);
    expect(
      (await admin.get<Section[]>("/api/inventory/sections?archived=true")).map(
        (s) => s.name,
      ),
    ).toEqual(["Trailer"]);
    await admin.send("POST", `/api/inventory/sections/${tent.id}/restore`, {});
    expect(
      (
        await lead.call("POST", "/api/inventory/sections", {
          name: "X",
          kind: "rental",
        })
      ).status,
    ).toBe(403);
  });

  it("rejects a second live section with the same name", async () => {
    await section("Warehouse");
    const response = await admin.call("POST", "/api/inventory/sections", {
      name: "warehouse",
      kind: "rental",
    });
    expect(response.status).toBe(409);
  });

  it("shows the total and per-section quantities (AC1)", async () => {
    const warehouse = await section("Warehouse");
    const cafe = await section("Cafe");
    const item = await createItem(chairs());
    await count(item.id, warehouse.id, 40);
    const counted = await count(item.id, cafe.id, 10);
    expect(counted.totalQuantity).toBe(50);
    expect(counted.stock).toEqual([
      { sectionId: warehouse.id, sectionName: "Warehouse", quantity: 40 },
      { sectionId: cafe.id, sectionName: "Cafe", quantity: 10 },
    ]);
    const listed = await admin.get<InventoryItem[]>(
      `/api/inventory/items?sectionId=${cafe.id}`,
    );
    expect(listed.map((i) => i.id)).toEqual([item.id]);
  });

  it("transfers with one linked pair of movements and updates both sections (AC2)", async () => {
    const warehouse = await section("Warehouse");
    const jamies = await section("Jamie's");
    const item = await createItem(chairs());
    await count(item.id, warehouse.id, 40);
    const moved = await lead.send<InventoryItem>(
      "POST",
      `/api/inventory/items/${item.id}/transfers`,
      { fromSectionId: warehouse.id, toSectionId: jamies.id, quantity: 10 },
      201,
    );
    expect(moved.totalQuantity).toBe(40);
    expect(
      Object.fromEntries(moved.stock.map((s) => [s.sectionName, s.quantity])),
    ).toEqual({ Warehouse: 30, "Jamie's": 10 });
    const transfers = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.type, "transfer"))
      .orderBy(stockMovements.quantity);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toMatchObject({
      itemId: item.id,
      quantity: -10,
      sectionId: warehouse.id,
      createdBy: people.lead,
    });
    expect(transfers[1]).toMatchObject({
      itemId: item.id,
      quantity: 10,
      sectionId: jamies.id,
      createdBy: people.lead,
    });
    expect(transfers[0].transferId).toBeTruthy();
    expect(transfers[1].transferId).toBe(transfers[0].transferId);
  });

  it("lets sales, the kitchen and FT+ count and move rentals, but not edit them", async () => {
    const warehouse = await section("Warehouse");
    const unlabeled = await section("Unlabeled");
    const item = await createItem(chairs());
    for (const who of [partTimeSales, cook, fullTimeStaff]) {
      await who.send<InventoryItem>(
        "POST",
        `/api/inventory/items/${item.id}/counts`,
        { sectionId: unlabeled.id, quantity: 12 },
        201,
      );
      await who.send<InventoryItem>(
        "POST",
        `/api/inventory/items/${item.id}/transfers`,
        { fromSectionId: unlabeled.id, toSectionId: warehouse.id, quantity: 2 },
        201,
      );
      expect(
        (await who.call("PUT", `/api/inventory/items/${item.id}`, chairs()))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await partTimeStaff.call(
          "POST",
          `/api/inventory/items/${item.id}/counts`,
          { sectionId: unlabeled.id, quantity: 1 },
        )
      ).status,
    ).toBe(403);
    // Consumable movements stay with inventory managers.
    const fridge = await section("Refrigerated", "consumable");
    const creamItem = await createItem(cream());
    expect(
      (
        await partTimeSales.call(
          "POST",
          `/api/inventory/items/${creamItem.id}/movements`,
          { type: "receive", sectionId: fridge.id, quantity: 1 },
        )
      ).status,
    ).toBe(403);
    await expectLedgerMatchesCache(item.id);
  });

  it("rejects a transfer of more than the section holds, changing nothing", async () => {
    const warehouse = await section("Warehouse");
    const cafe = await section("Cafe");
    const item = await createItem(chairs());
    await count(item.id, warehouse.id, 5);
    const response = await admin.call(
      "POST",
      `/api/inventory/items/${item.id}/transfers`,
      { fromSectionId: warehouse.id, toSectionId: cafe.id, quantity: 6 },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("INSUFFICIENT_STOCK");
    const after = await admin.get<InventoryItem>(
      `/api/inventory/items/${item.id}`,
    );
    expect(after.stock).toEqual([
      { sectionId: warehouse.id, sectionName: "Warehouse", quantity: 5 },
    ]);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
  });

  it("keeps rentals in rental sections and consumables in storage", async () => {
    const dry = await section("Dry Storage", "consumable");
    const item = await createItem(chairs());
    const response = await admin.call(
      "POST",
      `/api/inventory/items/${item.id}/counts`,
      { sectionId: dry.id, quantity: 3 },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WRONG_SECTION_KIND");
  });

  it("rejects archiving a section that still holds stock (AC3)", async () => {
    const warehouse = await section("Warehouse");
    const item = await createItem(chairs());
    await count(item.id, warehouse.id, 2);
    const response = await admin.call(
      "POST",
      `/api/inventory/sections/${warehouse.id}/archive`,
      {},
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "SECTION_HAS_STOCK",
      message:
        "Warehouse still holds stock. Move or count it out before archiving the section.",
    });
    await count(item.id, warehouse.id, 0);
    await admin.send(
      "POST",
      `/api/inventory/sections/${warehouse.id}/archive`,
      {},
    );
  });
});

describe("items (FLOW-69)", () => {
  it("stores every kind with its sub-record", async () => {
    const service = await createItem({
      kind: "service",
      name: "Full Plasticware Package",
      service: { priceCents: 350, priceBasis: "per_guest" },
    });
    expect(service).toMatchObject({
      subtype: null,
      rental: null,
      consumable: null,
      service: { priceCents: 350, priceBasis: "per_guest" },
    });
    const glass = await createItem({
      kind: "rental",
      subtype: "glassware",
      name: "Red Wine Glass",
      ratio: { quantity: 2, basis: "per_guest" },
      rental: { priceCents: 85 },
    });
    expect(glass).toMatchObject({
      ratio: { quantity: 2, basis: "per_guest" },
      rental: { priceCents: 85 },
    });
    const ingredient = await createItem(cream());
    expect(ingredient.consumable).toMatchObject({
      purchaseUnit: "case",
      packCount: 6,
      eachSize: { quantity: 1, unit: "qt" },
      unitCostCents: 2400,
      costHidden: false,
      allergens: ["milk"],
    });
  });

  it("rejects stock movements for a service item (AC2)", async () => {
    const vendor = await section("Vendor");
    const service = await createItem({ kind: "service", name: "Bartending" });
    const response = await admin.call(
      "POST",
      `/api/inventory/items/${service.id}/counts`,
      { sectionId: vendor.id, quantity: 1 },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("SERVICE_HAS_NO_STOCK");
    const row = await findItem(db, service.id);
    await expect(
      db.transaction((tx) =>
        recordMovement(tx, admin.actor, row, {
          type: "receive",
          changes: [{ sectionId: vendor.id, quantity: 1 }],
          reason: "",
        }),
      ),
    ).rejects.toMatchObject({ code: "SERVICE_HAS_NO_STOCK" });
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("rejects a duplicate live code and a change of kind", async () => {
    const item = await createItem(chairs());
    expect(
      (await admin.call("POST", "/api/inventory/items", chairs())).status,
    ).toBe(409);
    const response = await admin.call(
      "PUT",
      `/api/inventory/items/${item.id}`,
      { updatedAt: await versionOf(item.id),
        ...chairs(),
        kind: "service",
        subtype: null,
      },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("KIND_CHANGE");
  });
});

describe("ingredients (FLOW-81)", () => {
  it("applies FLOW-39 cost visibility to detail, lists, writes and history", async () => {
    const item = await createItem(cream());
    for (const who of [cook, partTimeLead, fullTimeStaff]) {
      const seen = await who.get<InventoryItem>(
        `/api/inventory/items/${item.id}`,
      );
      expect(seen.consumable).toMatchObject({
        unitCostCents: 2400,
        costHidden: false,
      });
      const listed = await who.get<InventoryItem[]>("/api/inventory/items");
      expect(listed[0].consumable?.unitCostCents).toBe(2400);
      expect(
        (await who.call("GET", `/api/inventory/items/${item.id}/cost-history`))
          .status,
      ).toBe(200);
    }
    for (const who of [partTimeSales, partTimeStaff]) {
      const seen = await who.get<InventoryItem>(
        `/api/inventory/items/${item.id}`,
      );
      expect(seen.consumable).toMatchObject({
        unitCostCents: null,
        costHidden: true,
      });
      expect(
        (await who.get<InventoryItem[]>("/api/inventory/items"))[0].consumable
          ?.unitCostCents,
      ).toBeNull();
      expect(
        (await who.call("GET", `/api/inventory/items/${item.id}/cost-history`))
          .status,
      ).toBe(403);
    }
    await partTimeLead.send("PUT", `/api/inventory/items/${item.id}`, {
      updatedAt: await versionOf(item.id),
      ...cream(),
      name: "Heavy Cream 36%",
      consumable: { ...cream().consumable!, unitCostCents: undefined },
    });
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${item.id}`))
        .consumable?.unitCostCents,
    ).toBe(2400);
    await partTimeLead.send("PUT", `/api/inventory/items/${item.id}`, {
      ...cream(),
      updatedAt: await versionOf(item.id),
    });
  });

  it("filters by category, vendor, storage and below par", async () => {
    const fridge = await section("Refrigerated", "consumable");
    const dry = await section("Dry Storage", "consumable");
    const creamItem = await createItem(
      cream({
        consumable: { ...cream().consumable!, storageSectionId: fridge.id },
      }),
    );
    await count(creamItem.id, fridge.id, 2);
    const flour = await createItem({
      kind: "consumable",
      subtype: "ingredient",
      name: "Flour",
      category: "Dry Goods",
      unit: "lb",
      consumable: {
        purchaseUnit: "lb",
        preferredVendor: "Restaurant Depot",
        parLevel: 10,
        storageSectionId: dry.id,
      },
    });
    await count(flour.id, dry.id, 50);
    const names = async (query: string) =>
      (
        await admin.get<InventoryItem[]>(
          `/api/inventory/items?kind=consumable&subtype=ingredient&${query}`,
        )
      ).map((item) => item.name);
    expect(await names("category=Dairy")).toEqual(["Heavy Cream"]);
    expect(await names("vendor=depot")).toEqual(["Flour"]);
    expect(await names(`sectionId=${dry.id}`)).toEqual(["Flour"]);
    expect(await names("belowPar=true")).toEqual(["Heavy Cream"]);
    const [creamListed] = await admin.get<InventoryItem[]>(
      "/api/inventory/items?category=Dairy",
    );
    expect(creamListed.consumable?.storageSectionName).toBe("Refrigerated");
    expect(creamListed.belowPar).toBe(true);
  });
});

// FLOW-71 AC2: the cached on-hand of every section equals the sum of its movements.
async function expectLedgerMatchesCache(itemId: string) {
  const cached = await db
    .select({
      sectionId: inventoryStock.sectionId,
      quantity: inventoryStock.quantity,
    })
    .from(inventoryStock)
    .where(eq(inventoryStock.itemId, itemId));
  const sums = await db
    .select({
      sectionId: stockMovements.sectionId,
      total: sql<string>`sum(${stockMovements.quantity})`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.itemId, itemId))
    .groupBy(stockMovements.sectionId);
  const sections = new Set([
    ...cached.map((row) => row.sectionId),
    ...sums.map((row) => row.sectionId),
  ]);
  for (const sectionId of sections) {
    const cache = cached.find((row) => row.sectionId === sectionId)?.quantity;
    const sum = Number(sums.find((row) => row.sectionId === sectionId)?.total);
    expect(cache ?? 0).toBeCloseTo(sum || 0, 4);
    expect(cache ?? 0).toBeGreaterThanOrEqual(0);
  }
}

// A small seeded generator, so a failing sequence can be replayed.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const movements = (itemId: string) =>
  admin.get<StockMovement[]>(`/api/inventory/items/${itemId}/movements`);
const record = (itemId: string, body: unknown, as = admin, status = 201) =>
  as.send<InventoryItem>(
    "POST",
    `/api/inventory/items/${itemId}/movements`,
    body,
    status,
  );

describe("stock ledger (FLOW-71)", () => {
  it("keeps the cached on-hand equal to the sum of movements over random sequences (AC2)", async () => {
    const sections = await Promise.all([
      section("Warehouse"),
      section("Cafe"),
      section("Jamie's"),
    ]);
    for (const seed of [1, 7, 42]) {
      const next = random(seed);
      const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
      const amount = () => Math.round(next() * 2000) / 100;
      const item = await createItem({
        ...chairs(),
        code: `CH-${seed}`,
      });
      for (let step = 0; step < 40; step++) {
        const at = pick(sections).id;
        const roll = next();
        const response =
          roll < 0.25
            ? await admin.call(
                "POST",
                `/api/inventory/items/${item.id}/movements`,
                { type: "receive", sectionId: at, quantity: amount() || 1 },
              )
            : roll < 0.4
              ? await admin.call(
                  "POST",
                  `/api/inventory/items/${item.id}/movements`,
                  {
                    type: "damage_loss",
                    sectionId: at,
                    quantity: amount() || 1,
                  },
                )
              : roll < 0.55
                ? await admin.call(
                    "POST",
                    `/api/inventory/items/${item.id}/movements`,
                    {
                      type: "adjust",
                      sectionId: at,
                      quantity: (amount() || 1) * (next() < 0.5 ? -1 : 1),
                      reason: "Property test",
                    },
                  )
                : roll < 0.75
                  ? await admin.call(
                      "POST",
                      `/api/inventory/items/${item.id}/counts`,
                      { sectionId: at, quantity: amount() },
                    )
                  : roll < 0.9
                    ? await admin.call(
                        "POST",
                        `/api/inventory/items/${item.id}/transfers`,
                        {
                          fromSectionId: at,
                          toSectionId: pick(
                            sections.filter((other) => other.id !== at),
                          ).id,
                          quantity: amount() || 1,
                        },
                      )
                    : await (async () => {
                        const corrigible = (await movements(item.id)).filter(
                          (m) => !m.correctsId && m.type !== "transfer",
                        );
                        if (!corrigible.length)
                          return new Response(null, { status: 409 });
                        const target = pick(corrigible);
                        return admin.call(
                          "POST",
                          `/api/inventory/movements/${target.id}/corrections`,
                          {
                            quantity:
                              target.type === "damage_loss"
                                ? -(amount() || 1)
                                : target.type === "receive"
                                  ? amount() || 1
                                  : amount(),
                            reason: "Property test",
                          },
                        );
                      })();
        // A refused movement (not enough stock, nothing to correct) changes
        // nothing; either way the cache must still match the ledger.
        expect([200, 201, 409], `seed ${seed} step ${step}`).toContain(
          response.status,
        );
        await expectLedgerMatchesCache(item.id);
      }
      const shown = await admin.get<InventoryItem>(
        `/api/inventory/items/${item.id}`,
      );
      const [{ total }] = await db
        .select({
          total: sql<string>`coalesce(sum(${stockMovements.quantity}), 0)`,
        })
        .from(stockMovements)
        .where(eq(stockMovements.itemId, item.id));
      expect(shown.totalQuantity).toBeCloseTo(Number(total), 4);
    }
  });

  it("has no path that sets a quantity directly (AC1)", async () => {
    const warehouse = await section("Warehouse");
    const item = await createItem(chairs());
    await record(item.id, {
      type: "receive",
      sectionId: warehouse.id,
      quantity: 5,
    });
    // Quantities in an item update are ignored.
    await admin.send("PUT", `/api/inventory/items/${item.id}`, {
      updatedAt: await versionOf(item.id),
      ...chairs(),
      totalQuantity: 100,
      stock: [{ sectionId: warehouse.id, quantity: 100 }],
    });
    for (const [method, path] of [
      ["PUT", `/api/inventory/items/${item.id}/stock`],
      ["PATCH", `/api/inventory/items/${item.id}`],
      ["PUT", `/api/inventory/movements/${item.id}`],
      ["DELETE", `/api/inventory/movements/${item.id}`],
    ])
      expect((await admin.call(method, path, { quantity: 100 })).status).toBe(
        404,
      );
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${item.id}`))
        .totalQuantity,
    ).toBe(5);
    // Movements can't be edited or deleted, even in the database.
    await expect(
      db.update(stockMovements).set({ quantity: 100 }),
    ).rejects.toThrow();
    await expect(db.delete(stockMovements)).rejects.toThrow();
  });

  it("records each movement type with its sign, reason and user", async () => {
    const fridge = await section("Refrigerated", "consumable");
    const item = await createItem(cream());
    await record(item.id, {
      type: "receive",
      sectionId: fridge.id,
      quantity: 12,
      reason: "Sysco delivery",
    });
    await record(
      item.id,
      {
        type: "damage_loss",
        sectionId: fridge.id,
        quantity: 2,
        reason: "Spoiled",
      },
      lead,
    );
    const used = await record(item.id, {
      type: "consume",
      sectionId: fridge.id,
      quantity: 1,
    });
    expect(used.totalQuantity).toBe(9);
    expect(
      (await movements(item.id)).map((m) => [m.type, m.quantity, m.reason]),
    ).toEqual([
      ["consume", -1, ""],
      ["damage_loss", -2, "Spoiled"],
      ["receive", 12, "Sysco delivery"],
    ]);
    expect((await movements(item.id))[1].createdBy).toBe(people.lead);
    const bad = await admin.call(
      "POST",
      `/api/inventory/items/${item.id}/movements`,
      { type: "adjust", sectionId: fridge.id, quantity: -1 },
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toBe(
      "Give a reason for the adjustment.",
    );
    const unknownEvent = await admin.call(
      "POST",
      `/api/inventory/items/${item.id}/movements`,
      {
        type: "pull",
        sectionId: fridge.id,
        quantity: 1,
        eventId: "c0000000-0000-4000-8000-000000000009",
      },
    );
    expect(unknownEvent.status).toBe(404);
    const moved = await db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.type, "event:stock.moved"));
    expect(moved).toHaveLength(3);
  });

  it("corrects a movement with a new linked movement and leaves the original untouched (AC3)", async () => {
    const fridge = await section("Refrigerated", "consumable");
    const item = await createItem(cream());
    await record(item.id, {
      type: "receive",
      sectionId: fridge.id,
      quantity: 10,
    });
    const [original] = await movements(item.id);
    const [before] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, original.id));
    const after = await admin.send<StockMovement[]>(
      "POST",
      `/api/inventory/movements/${original.id}/corrections`,
      { quantity: 12, reason: "Invoice said 12" },
      201,
    );
    const correction = after.find((m) => m.correctsId === original.id)!;
    expect(correction).toMatchObject({
      type: "receive",
      quantity: 2,
      sectionId: fridge.id,
      reason: "Invoice said 12",
    });
    expect(after.find((m) => m.id === original.id)?.correctedBy).toEqual([
      correction.id,
    ]);
    const [unchanged] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, original.id));
    expect(unchanged).toEqual(before);
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${item.id}`))
        .totalQuantity,
    ).toBe(12);

    // A second correction is measured against the corrected total.
    await admin.send(
      "POST",
      `/api/inventory/movements/${original.id}/corrections`,
      { quantity: 11, reason: "One was damaged on arrival" },
      201,
    );
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${item.id}`))
        .totalQuantity,
    ).toBe(11);
    const refused = async (id: string, body: unknown, code: string) => {
      const response = await admin.call(
        "POST",
        `/api/inventory/movements/${id}/corrections`,
        body,
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(code);
    };
    await refused(
      correction.id,
      { quantity: 1, reason: "x" },
      "CORRECTS_A_CORRECTION",
    );
    await refused(original.id, { quantity: 11, reason: "x" }, "NO_CHANGE");
    await refused(
      original.id,
      { quantity: -4, reason: "x" },
      "WRONG_DIRECTION",
    );
    const other = await section("Freezer", "consumable");
    await admin.send(
      "POST",
      `/api/inventory/items/${item.id}/transfers`,
      { fromSectionId: fridge.id, toSectionId: other.id, quantity: 1 },
      201,
    );
    const transfer = (await movements(item.id)).find(
      (m) => m.type === "transfer",
    )!;
    await refused(
      transfer.id,
      { quantity: 2, reason: "x" },
      "TRANSFER_CORRECTION",
    );
    // Only inventory managers correct consumable movements.
    expect(
      (
        await cook.call(
          "POST",
          `/api/inventory/movements/${original.id}/corrections`,
          { quantity: 10, reason: "x" },
        )
      ).status,
    ).toBe(403);
    await expectLedgerMatchesCache(item.id);
  });
});

const startCount = (sectionId: string, as = admin, status = 201) =>
  as.send<StockCount>("POST", "/api/inventory/counts", { sectionId }, status);
const saveLine = (
  countId: string,
  body: { itemId: string; quantity: number; reason?: string },
  as = admin,
) =>
  as.send<StockCount>("POST", `/api/inventory/counts/${countId}/lines`, body);

describe("count mode (FLOW-82)", () => {
  it("writes a count movement for the difference (AC1)", async () => {
    const fridge = await section("Refrigerated", "consumable");
    const item = await createItem(
      cream({
        consumable: { ...cream().consumable!, storageSectionId: fridge.id },
      }),
    );
    await count(item.id, fridge.id, 15);
    const started = await startCount(fridge.id);
    expect(
      started.lines.map((line) => [line.name, line.systemQuantity]),
    ).toEqual([["Heavy Cream", 15]]);
    const saved = await saveLine(
      started.id,
      { itemId: item.id, quantity: 12, reason: "Two opened" },
      cook,
    );
    expect(saved.lines[0]).toMatchObject({
      systemQuantity: 12,
      counted: {
        quantity: 12,
        difference: -3,
        reason: "Two opened",
        countedBy: people.cook,
      },
    });
    const [latest] = await movements(item.id);
    expect(latest).toMatchObject({
      type: "count",
      quantity: -3,
      sectionId: fridge.id,
    });
    expect(
      (await admin.get<InventoryItem>(`/api/inventory/items/${item.id}`))
        .totalQuantity,
    ).toBe(12);
  });

  it("puts an item that drops below par on the low-stock list (AC2)", async () => {
    const fridge = await section("Refrigerated", "consumable");
    const item = await createItem(
      cream({
        consumable: { ...cream().consumable!, storageSectionId: fridge.id },
      }),
    );
    await count(item.id, fridge.id, 8);
    const lowStock = async () =>
      (
        await admin.get<InventoryItem[]>(
          "/api/inventory/items?kind=consumable&belowPar=true",
        )
      ).map((i) => i.name);
    expect(await lowStock()).toEqual([]);
    const started = await startCount(fridge.id);
    const saved = await saveLine(started.id, { itemId: item.id, quantity: 4 });
    expect(saved.lines[0].belowPar).toBe(true);
    expect(await lowStock()).toEqual(["Heavy Cream"]);
  });

  it("resumes a partly completed count where it left off (AC3)", async () => {
    const dry = await section("Dry Storage", "consumable");
    const stored = (name: string, storageOrder: number) =>
      createItem({
        kind: "consumable",
        subtype: "ingredient",
        name,
        category: "Dry Goods",
        unit: "lb",
        consumable: {
          purchaseUnit: "lb",
          storageSectionId: dry.id,
          storageOrder,
        },
      });
    const flour = await stored("Flour", 2);
    const sugar = await stored("Sugar", 1);
    const rice = await stored("Rice", 3);
    const started = await startCount(dry.id);
    expect(started.lines.map((line) => line.name)).toEqual([
      "Sugar",
      "Flour",
      "Rice",
    ]);
    await saveLine(started.id, { itemId: sugar.id, quantity: 20 });
    await saveLine(started.id, { itemId: flour.id, quantity: 40 });

    // Starting again opens the same count, with what was saved.
    const resumed = await startCount(dry.id, lead, 200);
    expect(resumed.id).toBe(started.id);
    expect(resumed.countedItems).toBe(2);
    expect(
      resumed.lines.map((line) => [line.name, line.counted?.quantity ?? null]),
    ).toEqual([
      ["Sugar", 20],
      ["Flour", 40],
      ["Rice", null],
    ]);
    expect(
      (await admin.get<StockCount[]>("/api/inventory/counts?status=open")).map(
        (open) => [open.sectionName, open.countedItems],
      ),
    ).toEqual([["Dry Storage", 2]]);

    // A recount replaces the line and records only the new difference.
    const recounted = await saveLine(started.id, {
      itemId: sugar.id,
      quantity: 18,
    });
    expect(recounted.lines[0].counted).toMatchObject({
      quantity: 18,
      difference: -2,
    });

    await saveLine(started.id, { itemId: rice.id, quantity: 5 });
    const done = await admin.send<StockCount>(
      "POST",
      `/api/inventory/counts/${started.id}/complete`,
      {},
    );
    expect(done.status).toBe("completed");
    const late = await admin.call(
      "POST",
      `/api/inventory/counts/${started.id}/lines`,
      { itemId: rice.id, quantity: 6 },
    );
    expect(late.status).toBe(409);
    expect((await late.json()).error.code).toBe("COUNT_COMPLETED");
    expect((await startCount(dry.id)).id).not.toBe(started.id);
    await expectLedgerMatchesCache(sugar.id);
  });

  it("lets the kitchen count ingredients and FT+ count bar stock and supplies", async () => {
    const bar = await section("Bar Storage", "consumable");
    const beer = await createItem({
      kind: "consumable",
      subtype: "bar",
      name: "Lager",
      category: "Beer",
      consumable: {
        purchaseUnit: "case",
        packCount: 24,
        storageSectionId: bar.id,
      },
    });
    const limes = await createItem({
      kind: "consumable",
      subtype: "ingredient",
      name: "Limes",
      category: "Produce",
      consumable: { purchaseUnit: "each", storageSectionId: bar.id },
    });
    const started = await startCount(bar.id, cook);
    expect(started.lines.map((line) => [line.name, line.canCount])).toEqual([
      ["Lager", false],
      ["Limes", true],
    ]);
    expect(
      (
        await cook.call("POST", `/api/inventory/counts/${started.id}/lines`, {
          itemId: beer.id,
          quantity: 3,
        })
      ).status,
    ).toBe(403);
    await saveLine(started.id, { itemId: limes.id, quantity: 30 }, cook);
    await saveLine(
      started.id,
      { itemId: beer.id, quantity: 48 },
      fullTimeStaff,
    );
    expect(
      (
        await fullTimeStaff.call(
          "POST",
          `/api/inventory/counts/${started.id}/lines`,
          { itemId: limes.id, quantity: 3 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await partTimeStaff.call("POST", "/api/inventory/counts", {
          sectionId: bar.id,
        })
      ).status,
    ).toBe(403);
    // Count mode is for storage sections.
    const warehouse = await section("Warehouse");
    expect(
      (
        await admin.call("POST", "/api/inventory/counts", {
          sectionId: warehouse.id,
        })
      ).status,
    ).toBe(409);
  });
});

describe("cost history (FLOW-83)", () => {
  it("logs every cost change with its source and emits a cost-changed event (AC2)", async () => {
    const item = await createItem(cream());
    await admin.send("PUT", `/api/inventory/items/${item.id}`, {
      updatedAt: await versionOf(item.id),
      ...cream(),
      consumable: { ...cream().consumable!, unitCostCents: 2650 },
    });
    // Saving without a cost change, or as a part-time user who can't see the
    // cost, adds nothing.
    await admin.send("PUT", `/api/inventory/items/${item.id}`, {
      updatedAt: await versionOf(item.id),
      ...cream(),
      name: "Heavy Cream 40%",
      consumable: { ...cream().consumable!, unitCostCents: 2650 },
    });
    await partTimeLead.send("PUT", `/api/inventory/items/${item.id}`, {
      updatedAt: await versionOf(item.id),
      ...cream(),
      consumable: { ...cream().consumable!, unitCostCents: undefined },
    });
    const history = await admin.get<CostChange[]>(
      `/api/inventory/items/${item.id}/cost-history`,
    );
    expect(
      history.map((change) => [
        change.previousCents,
        change.unitCostCents,
        change.source,
        change.changedBy,
      ]),
    ).toEqual([
      [2400, 2650, "manual", people.admin],
      [null, 2400, "manual", people.admin],
    ]);
    const events = await db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.type, "event:inventory_item.cost_changed"));
    expect(events.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: item.id,
          previousCents: 2400,
          unitCostCents: 2650,
          source: "manual",
        }),
      ]),
    );
    expect(events).toHaveLength(2);
    expect(
      (
        await partTimeStaff.call(
          "GET",
          `/api/inventory/items/${item.id}/cost-history`,
        )
      ).status,
    ).toBe(403);
  });
});

const titos = (overrides: Partial<ItemInput> = {}): ItemInput => ({
  kind: "consumable",
  subtype: "bar",
  name: "Tito's Vodka",
  category: "Liquor",
  tier: "mid",
  consumable: {
    purchaseUnit: "case",
    packCount: 12,
    eachSize: { quantity: 750, unit: "ml" },
    unitCostCents: 2299,
    preferredVendor: "Imperio",
    parLevel: 6,
  },
  bar: { brand: "Tito's", subcategory: "Vodka", container: "bottle" },
  ...overrides,
});

describe("bar stock (FLOW-90)", () => {
  it("stores bar fields and filters by category, subcategory, tier and distributor (AC2)", async () => {
    const created = await createItem(titos());
    expect(created).toMatchObject({
      category: "Liquor",
      tier: "mid",
      bar: { brand: "Tito's", subcategory: "Vodka", container: "bottle" },
      consumable: {
        packCount: 12,
        eachSize: { quantity: 750, unit: "ml" },
        preferredVendor: "Imperio",
      },
    });
    await createItem(
      titos({
        name: "Rail Vodka",
        tier: "rail",
        bar: { brand: "", subcategory: "Vodka", container: "bottle" },
        consumable: { ...titos().consumable!, preferredVendor: "Southern" },
      }),
    );
    await createItem(
      titos({
        name: "Pinot Grigio",
        category: "Wine",
        tier: "",
        bar: {
          brand: "Pinot Grigio",
          subcategory: "White",
          container: "bottle",
        },
      }),
    );
    const names = async (query: string) =>
      (
        await admin.get<InventoryItem[]>(
          `/api/inventory/items?kind=consumable&subtype=bar&${query}`,
        )
      ).map((item) => item.name);
    expect(await names("category=Wine")).toEqual(["Pinot Grigio"]);
    expect(await names("subcategory=White")).toEqual(["Pinot Grigio"]);
    expect(await names("subcategory=Vodka")).toEqual([
      "Rail Vodka",
      "Tito's Vodka",
    ]);
    expect(await names("tier=rail")).toEqual(["Rail Vodka"]);
    expect(await names("vendor=southern")).toEqual(["Rail Vodka"]);
  });

  it("rejects bar details on other items and categories outside the bar list", async () => {
    for (const [input, message] of [
      [titos({ category: "Soda" }), "Pick a bar category."],
      [titos({ tier: "call" }), "The tier is rail, mid, high or premium."],
      [
        titos({
          category: "Beer",
          bar: { subcategory: "Vodka" },
        }),
        "Only wine and liquor have a subcategory.",
      ],
      [
        titos({ bar: { subcategory: "Scotch" } }),
        "Pick Vodka, Tequila, Gin, Rum, Whiskey or Cognac.",
      ],
      [
        { ...cream(), bar: { brand: "Horizon" } },
        "Only bar stock has bar details.",
      ],
    ] as const) {
      const response = await admin.call("POST", "/api/inventory/items", input);
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toBe(message);
    }
  });

  it("counts bar stock through count mode, like ingredients (AC1)", async () => {
    const bar = await section("Bar Storage", "consumable");
    const item = await createItem(
      titos({
        consumable: { ...titos().consumable!, storageSectionId: bar.id },
      }),
    );
    const started = await startCount(bar.id);
    const saved = await saveLine(started.id, {
      itemId: item.id,
      quantity: 3.25,
    });
    expect(saved.lines[0]).toMatchObject({
      name: "Tito's Vodka",
      belowPar: true,
      counted: { quantity: 3.25, difference: 3.25 },
    });
  });

  it("counts beer and wine to the nearest 0.5 and liquor to the nearest 0.25", async () => {
    const bar = await section("Bar Storage", "consumable");
    const storage = { ...titos().consumable!, storageSectionId: bar.id };
    const vodka = await createItem(titos({ consumable: storage }));
    const beer = await createItem(
      titos({
        name: "Modelo",
        category: "Beer",
        tier: "",
        consumable: { ...storage, packCount: 24 },
        bar: { brand: "", subcategory: "", container: "bottle" },
      }),
    );
    const started = await startCount(bar.id);
    const refused = async (
      itemId: string,
      quantity: number,
      message: string,
    ) => {
      const response = await admin.call(
        "POST",
        `/api/inventory/counts/${started.id}/lines`,
        { itemId, quantity },
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatchObject({
        code: "COUNT_STEP",
        message,
      });
    };
    await refused(vodka.id, 3.3, "Count liquor to the nearest 0.25.");
    await refused(beer.id, 1.25, "Count beer and wine to the nearest 0.5.");
    await saveLine(started.id, { itemId: vodka.id, quantity: 0.75 });
    await saveLine(started.id, { itemId: beer.id, quantity: 7.5 });
    await expectLedgerMatchesCache(beer.id);
  });
});
