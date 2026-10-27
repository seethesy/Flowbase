import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";

// FLOW-180 AC1: with 2,000 items and 600 events seeded, the median CPU of one
// list call (one page, through the HTTP handler so JSON encoding counts) stays
// under the 10 ms Workers Free allows. Measured in Node, which runs the same V8
// as workerd; CPU time excludes time spent waiting on Postgres.
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
  userId: "e0000000-0000-4000-8000-000000000002",
  role: "admin",
  employmentType: "full_time",
};
const app = createApp({ withDb, resolveActor: async () => admin });
const BUDGET_MS = 10;

// A Worker isolate serves many requests, so only warm calls are measured: the
// first ones pay for compiling the handler, as they do once per isolate.
async function medianCpuMs(path: string, runs = 21) {
  for (let i = 0; i < 10; i += 1) await (await app.request(path, {}, env)).text();
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = process.cpuUsage();
    const response = await app.request(path, {}, env);
    await response.text();
    const used = process.cpuUsage(start);
    expect(response.status).toBe(200);
    samples.push((used.user + used.system) / 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.execute(
    sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, ingest_receipts, jobs cascade`,
  );
  const [section] = await db.execute<{ id: string }>(
    sql`select id from inventory_sections where kind = 'consumable' and archived_at is null limit 1`,
  );
  // 2,000 items: half ingredients with details and stock, the rest rentals.
  await db.execute(sql`
    insert into inventory_items (kind, subtype, name, unit, "group", code)
    select case when n % 2 = 0 then 'consumable' else 'rental' end,
      case when n % 2 = 0 then 'ingredient' else 'equipment' end,
      'Item ' || lpad(n::text, 4, '0'), 'each', 'Group ' || (n % 20), 'C' || n
    from generate_series(1, 2000) as n
  `);
  await db.execute(sql`
    insert into inventory_consumable_details (item_id, purchase_unit, preferred_vendor, par_level, storage_section_id)
    select id, 'case', 'Acme Foods', 10, ${section.id} from inventory_items where kind = 'consumable'
  `);
  await db.execute(sql`
    insert into inventory_rental_details (item_id, price_cents)
    select id, 1500 from inventory_items where kind = 'rental'
  `);
  await db.execute(sql`
    insert into inventory_stock (item_id, section_id, quantity)
    select id, ${section.id}, 25 from inventory_items where kind = 'consumable'
  `);
  // 500 clients with a contact each, and 600 events across two years.
  await db.execute(sql`
    insert into clients (name, kind)
    select 'Client ' || lpad(n::text, 3, '0'), 'organization' from generate_series(1, 500) as n
  `);
  await db.execute(sql`
    insert into client_contacts (client_id, name, role, email)
    select id, 'Contact for ' || name, 'primary_poc', 'contact@example.com' from clients
  `);
  await db.execute(sql`
    insert into events (title, client_id, starts_at)
    select 'Event ' || n, (select id from clients order by name offset (n % 500) limit 1),
      now() - interval '365 days' + n * interval '29 hours'
    from generate_series(1, 600) as n
  `);
}, 120_000);
// Leave no generated rows behind: other files count rows by id prefix
// (tests/db/seed.test.ts), and random ids can match it.
afterAll(async () => {
  await db.execute(
    sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, ingest_receipts, jobs cascade`,
  );
  await client.end();
});

const lists: [string, string][] = [
  ["inventory items", "/api/inventory/items"],
  ["ingredients", "/api/inventory/items?kind=consumable&subtype=ingredient&belowPar=false"],
  ["clients", "/api/clients"],
  ["events", "/api/events"],
];

// Shared code (routing, the query builder, the driver) compiles on whichever
// list runs first; warm every list before measuring so the order doesn't matter.
beforeAll(async () => {
  for (const [, path] of lists)
    for (let i = 0; i < 5; i += 1) await (await app.request(path, {}, env)).text();
}, 60_000);

it.each(lists)("lists %s within the CPU budget", async (_name, path) => {
  const median = await medianCpuMs(path);
  console.log(`median CPU for ${path}: ${median.toFixed(2)} ms`);
  expect(median).toBeLessThan(BUDGET_MS);
});
