import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { businessTimeToUtc } from "../../shared/time";

// Cursor paging (FLOW-179) and the SQL item filters (FLOW-180) against Postgres.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const admin: Actor = {
  userId: "e0000000-0000-4000-8000-000000000001",
  role: "admin",
  employmentType: "full_time",
};
const app = createApp({ withDb, resolveActor: async () => admin });
const get = (path: string) => app.request(path, {}, env);

// Follows X-Next-Cursor until X-Has-More says the list is done.
async function everyPage<T>(path: string, limit: number) {
  const pages: T[][] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await get(
      `${path}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(response.status).toBe(200);
    pages.push((await response.json()) as T[]);
    const more = response.headers.get("X-Has-More");
    expect(more === "true" || more === "false").toBe(true);
    cursor = response.headers.get("X-Next-Cursor");
    expect(more === "true").toBe(cursor !== null);
    if (!cursor) break;
  }
  return pages;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, ingest_receipts, jobs cascade`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("clients", () => {
  beforeEach(async () => {
    await db.execute(sql`
      insert into clients (name, kind)
      select 'Client ' || lpad(n::text, 3, '0'), 'organization'
      from generate_series(1, 599) as n
      union all select 'Zinnia Hall', 'organization'
    `);
  });

  it("returns every client exactly once, in order, across pages (AC3)", async () => {
    const pages = await everyPage<{ name: string }>("/api/clients", 50);
    expect(pages).toHaveLength(12);
    const names = pages.flat().map((row) => row.name);
    expect(names).toHaveLength(600);
    expect(new Set(names).size).toBe(600);
    expect(names).toEqual([...names].sort());
    expect(names.at(-1)).toBe("Zinnia Hall");
  });

  it("answers the first 100 by default and says more exist", async () => {
    const response = await get("/api/clients");
    expect(((await response.json()) as unknown[]).length).toBe(100);
    expect(response.headers.get("X-Has-More")).toBe("true");
  });

  it("finds the client past the first page by searching (AC1)", async () => {
    const response = await get("/api/clients?search=zinnia");
    expect(((await response.json()) as { name: string }[]).map((c) => c.name)).toEqual([
      "Zinnia Hall",
    ]);
    expect(response.headers.get("X-Has-More")).toBe("false");
  });

  it("matches contact names too, as the screen did", async () => {
    await db.execute(sql`
      insert into client_contacts (client_id, name, role)
      select id, 'Odessa Quill', 'primary_poc' from clients where name = 'Client 007'
    `);
    const response = await get("/api/clients?search=odessa");
    expect(((await response.json()) as { name: string }[]).map((c) => c.name)).toEqual([
      "Client 007",
    ]);
  });

  it("refuses a cursor it didn't issue", async () => {
    for (const cursor of ["nonsense", "WyJ4Il0", encodeURIComponent("%%%")])
      expect((await get(`/api/clients?cursor=${cursor}`)).status).toBe(400);
  });
});

describe("events", () => {
  beforeEach(async () => {
    await db.execute(sql`insert into clients (name, kind) values ('Juniper & Co.', 'organization')`);
    // 600 events, one every 29 hours from two years ago to now: several share a
    // calendar date, none share a start time.
    await db.execute(sql`
      insert into events (title, client_id, starts_at)
      select 'Event ' || lpad(n::text, 3, '0'), (select id from clients limit 1),
        now() - interval '730 days' + n * interval '29 hours'
      from generate_series(1, 600) as n
    `);
  });

  it("pages through every event soonest first (AC3)", async () => {
    const pages = await everyPage<{ title: string; startsAt: string }>("/api/events", 70);
    const rows = pages.flat();
    expect(rows).toHaveLength(600);
    expect(new Set(rows.map((row) => row.title)).size).toBe(600);
    const starts = rows.map((row) => Date.parse(row.startsAt));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("limits to a date window, and reaches any other range (AC2)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const inWindow = await everyPage<{ startsAt: string }>(
      `/api/events?from=2025-01-01&to=${today}`,
      500,
    );
    const from = businessTimeToUtc("2025-01-01", "00:00").getTime();
    for (const row of inWindow.flat())
      expect(Date.parse(row.startsAt)).toBeGreaterThanOrEqual(from);
    expect(inWindow.flat().length).toBeGreaterThan(0);
    expect(inWindow.flat().length).toBeLessThan(600);
  });
});

describe("leads with the same received time", () => {
  it("pages through rows that share a millisecond exactly once", async () => {
    // Microseconds apart: the cursor works at millisecond precision, so these
    // are tied on time and ordered by id.
    await db.execute(sql`
      insert into leads (channel, source, name, received_at)
      select 'manual', 'website', 'Lead ' || n,
        date_trunc('milliseconds', now()) + n * interval '1 microsecond'
      from generate_series(1, 40) as n
    `);
    const rows = (await everyPage<{ id: string }>("/api/leads", 7)).flat();
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((row) => row.id)).size).toBe(40);
  });
});

describe("inventory items", () => {
  let rental: string;
  let storage: string;
  beforeEach(async () => {
    const sections = await db.execute<{ id: string; kind: string }>(
      sql`select id, kind from inventory_sections where archived_at is null order by sort_order`,
    );
    rental = sections.find((s) => s.kind === "rental")!.id;
    storage = sections.find((s) => s.kind === "consumable")!.id;
    // 300 ingredients: even ones hold n units in storage, every third is from
    // Acme, and par is 100, so those holding fewer than 100 are below par.
    await db.execute(sql`
      insert into inventory_items (kind, subtype, name, unit)
      select 'consumable', 'ingredient', 'Ingredient ' || lpad(n::text, 3, '0'), 'lb'
      from generate_series(1, 300) as n
    `);
    await db.execute(sql`
      insert into inventory_consumable_details (item_id, purchase_unit, preferred_vendor, par_level)
      select id, 'lb',
        case when (substring(name from 12)::int) % 3 = 0 then 'Acme Foods' else 'Other' end,
        100
      from inventory_items
    `);
    await db.execute(sql`
      insert into inventory_stock (item_id, section_id, quantity)
      select id, ${storage}, substring(name from 12)::int
      from inventory_items where (substring(name from 12)::int) % 2 = 0
    `);
    // 20 bar items: wine for the first half, liquor for the rest.
    await db.execute(sql`
      insert into inventory_items (kind, subtype, name, unit, category)
      select 'consumable', 'bar', 'Bottle ' || lpad(n::text, 2, '0'), 'each', 'Wine'
      from generate_series(1, 20) as n
    `);
    await db.execute(sql`
      insert into inventory_bar_details (item_id, subcategory, brand)
      select id, case when (substring(name from 8)::int) <= 10 then 'Red' else 'White' end, 'Vineyard'
      from inventory_items where subtype = 'bar'
    `);
    // A rental with stock in a rental section.
    await db.execute(sql`
      insert into inventory_items (kind, subtype, name) values ('rental', 'equipment', 'Chafing dish')
    `);
    await db.execute(sql`
      insert into inventory_stock (item_id, section_id, quantity)
      select id, ${rental}, 4 from inventory_items where name = 'Chafing dish'
    `);
  });

  const all = async <T>(query: string) =>
    (await everyPage<T>(`/api/inventory/items${query}`, 25)).flat();

  it("pages through every item exactly once (AC3)", async () => {
    const rows = await all<{ id: string }>("");
    expect(rows).toHaveLength(321);
    expect(new Set(rows.map((row) => row.id)).size).toBe(321);
  });

  it("filters by section in SQL, page by page", async () => {
    const rows = await all<{ name: string }>(`?sectionId=${storage}`);
    expect(rows).toHaveLength(150);
    const rentals = await all<{ name: string }>(`?sectionId=${rental}`);
    expect(rentals.map((row) => row.name)).toEqual(["Chafing dish"]);
  });

  it("filters below par and by vendor in SQL", async () => {
    // Below par: odd ones (no stock) and even ones under 100.
    const below = await all<{ belowPar: boolean }>("?belowPar=true&subtype=ingredient");
    expect(below).toHaveLength(150 + 49);
    expect(below.every((row) => row.belowPar)).toBe(true);
    const acme = await all<{ consumable: { preferredVendor: string } }>("?vendor=acme");
    expect(acme).toHaveLength(100);
    expect(acme.every((row) => row.consumable.preferredVendor === "Acme Foods")).toBe(true);
  });

  it("filters bar subcategory and searches the brand in SQL", async () => {
    expect(await all("?subcategory=Red")).toHaveLength(10);
    expect(await all("?search=vineyard")).toHaveLength(20);
  });
});

describe("movement history", () => {
  it("lists corrections on a movement even when they're on another page", async () => {
    const [section] = await db.execute<{ id: string }>(
      sql`select id from inventory_sections where kind = 'consumable' and archived_at is null limit 1`,
    );
    const [item] = await db.execute<{ id: string }>(sql`
      insert into inventory_items (kind, subtype, name, unit)
      values ('consumable', 'ingredient', 'Flour', 'lb') returning id
    `);
    const [original] = await db.execute<{ id: string }>(sql`
      insert into stock_movements (item_id, section_id, type, quantity, created_at)
      values (${item.id}, ${section.id}, 'receive', 10, now() - interval '1 day') returning id
    `);
    await db.execute(sql`
      insert into stock_movements (item_id, section_id, type, quantity, corrects_id, created_at)
      select ${item.id}, ${section.id}, 'receive', 1, ${original.id}, now() - n * interval '1 hour'
      from generate_series(1, 3) as n
    `);
    const pages = await everyPage<{ id: string; correctedBy: string[] }>(
      `/api/inventory/items/${item.id}/movements`,
      2,
    );
    const rows = pages.flat();
    expect(rows).toHaveLength(4);
    const first = rows.find((row) => row.id === original.id)!;
    expect(first.correctedBy).toHaveLength(3);
  });
});
