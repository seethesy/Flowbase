import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { inventorySections, stockMovements } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { findItem, recordMovement } from "../../worker/records/inventory";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { InventoryItem, ItemInput, Section } from "../../shared/inventory";

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
    sql`truncate table stock_movements, inventory_stock, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, inventory_sections, jobs`,
  );
});
afterAll(async () => {
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

  it("transfers with one movement and updates both sections (AC2)", async () => {
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
      .where(eq(stockMovements.type, "transfer"));
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      itemId: item.id,
      quantity: 10,
      fromSectionId: warehouse.id,
      toSectionId: jamies.id,
      createdBy: people.lead,
    });
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
          type: "transfer",
          changes: [{ sectionId: vendor.id, delta: 1 }],
          quantity: 1,
          fromSectionId: null,
          toSectionId: vendor.id,
          note: "",
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
      {
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
  it("hides costs from part-time users and keeps them on their edits (AC3)", async () => {
    const item = await createItem(cream());
    const seen = await cook.get<InventoryItem>(
      `/api/inventory/items/${item.id}`,
    );
    expect(seen.consumable).toMatchObject({
      unitCostCents: null,
      costHidden: true,
    });
    const listed = await cook.get<InventoryItem[]>("/api/inventory/items");
    expect(listed[0].consumable?.unitCostCents).toBeNull();

    // JSON drops the undefined cost, as the form does for a hidden cost.
    await partTimeLead.send("PUT", `/api/inventory/items/${item.id}`, {
      ...cream(),
      name: "Heavy Cream 36%",
      consumable: { ...cream().consumable!, unitCostCents: undefined },
    });
    const after = await admin.get<InventoryItem>(
      `/api/inventory/items/${item.id}`,
    );
    expect(after.name).toBe("Heavy Cream 36%");
    expect(after.consumable?.unitCostCents).toBe(2400);

    expect(
      (
        await partTimeLead.call(
          "PUT",
          `/api/inventory/items/${item.id}`,
          cream(),
        )
      ).status,
    ).toBe(403);
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
