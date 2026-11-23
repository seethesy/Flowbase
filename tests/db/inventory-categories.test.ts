import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";

it("migrates existing rental, ingredient and Bar items to seeded categories without changing legacy Bar values, then starts the FLOW-289 lists empty", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must point to disposable CI Postgres.");
  const admin = postgres(url, { max: 1 });
  const database = `category_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "flowbase-category-"));
  let client: ReturnType<typeof postgres> | undefined;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    created = true;
    const upgradeUrl = new URL(url);
    upgradeUrl.pathname = `/${database}`;
    client = postgres(upgradeUrl.toString(), { max: 1 });
    const db = drizzle(client, { schema });
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const before = journal.entries.filter((entry: { idx: number }) => entry.idx < 65);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: before }));
    for (const entry of before) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    await migrate(db, { migrationsFolder: folder });
    await client`insert into inventory_items (kind, subtype, name, category) values
      ('rental', 'furniture', 'Sample chair', 'Guest tables'),
      ('consumable', 'ingredient', 'Sample herb', 'Herbs'),
      ('consumable', 'bar', 'Sample spirit', 'Liquor')`;
    // Up to FLOW-289, which starts the three lists empty.
    const clear = journal.entries.findIndex((entry: { tag: string }) => entry.tag.endsWith("_flow_289_clear_inventory"));
    const legacy = journal.entries.slice(0, clear);
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: legacy }));
    for (const entry of legacy) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    await migrate(db, { migrationsFolder: folder });
    const rows = await client`select i.name, i.category as legacy, c.kind, c.name as category, i.type_id
      from inventory_items i join inventory_categories c on c.id = i.category_id
      where i.name like 'Sample %' order by i.name`;
    expect(rows).toEqual([
      { name: "Sample chair", legacy: "Guest tables", kind: "rental", category: "Furniture", type_id: null },
      { name: "Sample herb", legacy: "Herbs", kind: "ingredient", category: "Ingredient", type_id: null },
      { name: "Sample spirit", legacy: "Liquor", kind: "bar", category: "Bar", type_id: null },
    ]);
    await migrate(db, { migrationsFolder: "drizzle" });
    // FLOW-289 AC5: the lists start empty, with the default locations.
    for (const table of ["master_inventory_items", "bar_inventory_items", "kitchen_ingredients", "inventory_stock", "stock_movements"])
      expect((await client.unsafe(`select count(*)::int as count from ${table}`))[0].count, table).toBe(0);
    expect(await client`select to_regclass('public.inventory_items') as legacy`).toEqual([{ legacy: null }]);
    expect((await client`select name, kind from inventory_locations where archived_at is null order by kind, sort_order`).map((row) => `${row.kind}:${row.name}`)).toEqual([
      "location:Warehouse", "location:Storage Box", "location:Jamie's - Garage", "location:Jamie's - Basement",
      "location:Jamie's - Main Floor", "location:Cozy Cafe", "location:Vendor",
      "storage:Fridge", "storage:Freezer", "storage:Pantry",
    ]);
    const app = createApp({
      withDb: ((_env, run) => run(db)) as RunWithDb,
      resolveActor: async () => ({ role: "admin", userId: "b0000000-0000-4000-8000-000000000001" }),
    });
    const categoryRows = await client`select id, name from inventory_categories where kind = 'rental'`;
    const furnitureId = categoryRows.find((row) => row.name === "Furniture")?.id;
    const equipmentId = categoryRows.find((row) => row.name === "Equipment")?.id;
    const createdType = await app.request("/api/inventory/types", {
      method: "POST", body: JSON.stringify({ categoryId: equipmentId, name: "Carts" }),
      headers: { "Content-Type": "application/json" },
    }, { ASSETS: { fetch } });
    expect(createdType.status).toBe(201);
    const type = await createdType.json() as { id: string };
    const invalid = await app.request("/api/inventory/items", {
      method: "POST",
      body: JSON.stringify({ kind: "rental", subtype: "furniture", name: "Wrong type", categoryId: furnitureId, typeId: type.id }),
      headers: { "Content-Type": "application/json" },
    }, { ASSETS: { fetch } });
    expect(invalid.status).toBe(400);
    const optional = await app.request("/api/inventory/items", {
      method: "POST",
      body: JSON.stringify({ kind: "rental", subtype: "furniture", name: "Unclassified chair" }),
      headers: { "Content-Type": "application/json" },
    }, { ASSETS: { fetch } });
    expect(optional.status).toBe(201);
    const createdItem = await optional.json() as { id: string; updatedAt: string };
    const furniture = await client`select id from inventory_categories where name = 'Furniture'`;
    const linked = await app.request(`/api/inventory/items/${createdItem.id}/inline`, {
      method: "PATCH", body: JSON.stringify({ field: "categoryId", value: furniture[0].id, updatedAt: createdItem.updatedAt }),
      headers: { "Content-Type": "application/json" },
    }, { ASSETS: { fetch } });
    expect(linked.status).toBe(200);
    const usedArchive = await app.request(`/api/inventory/categories/${furniture[0].id}`, {
      method: "PATCH", body: JSON.stringify({ archived: true }), headers: { "Content-Type": "application/json" },
    }, { ASSETS: { fetch } });
    expect(usedArchive.status).toBe(409);
  } finally {
    await client?.end();
    if (created) await admin.unsafe(`DROP DATABASE "${database}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
}, 60_000);
