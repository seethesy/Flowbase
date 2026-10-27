import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../../worker/db/schema";
import { seedDatabase, seedId, seedUsers } from "../../worker/db/seed";
import { assertTestDatabaseUrl } from "./test-database";
import { createApp } from "../../worker/app";

it("seeds repeatable counts, all roles and employment types, lifecycle stages and balanced opening stock", async () => {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL);
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema: s });
  try {
    // Other integration files intentionally clear their own tables. Re-seed here
    // so this assertion is independent of shuffled file order.
    await seedDatabase(url);
    const counts = async () =>
      Promise.all(
        [
          s.users,
          s.clients,
          s.clientContacts,
          s.events,
          s.inventoryItems,
          s.stockMovements,
          s.inventoryStock,
        ].map(
          async (table) =>
            (
              await db.select({ count: sql<number>`count(*)::int` }).from(table)
            )[0].count,
        ),
      );
    const before = await counts();
    await client`update clients set notes='Keep development edits' where id=${seedId(3, 1)}`;
    await seedDatabase(url);
    expect(await counts()).toEqual(before);
    expect(
      (await client`select notes from clients where id=${seedId(3, 1)}`)[0]
        .notes,
    ).toBe("Keep development edits");
    const seeded = await db
      .select()
      .from(s.users)
      .where(sql`${s.users.id}::text like 'f0260001-%'`);
    expect(seeded).toHaveLength(14);
    expect(
      new Set(seeded.map((u) => `${u.role}/${u.employmentType}`)).size,
    ).toBe(14);
    for (const [table, expected] of [
      ["clients", 35],
      ["client_contacts", 45],
      ["events", 10],
      ["inventory_items", 50],
    ] as const) {
      const rows = await client.unsafe(
        `select count(*)::int as count from "${table}" where id::text like 'f026%'`,
      );
      expect(rows[0].count, table).toBe(expected);
    }
    const stages =
      await client`select distinct status from events where id::text like 'f026%'`;
    expect(stages.length).toBe(10);
    const sections =
      await client`select distinct s.name from inventory_stock x join inventory_sections s on s.id=x.section_id join inventory_items i on i.id=x.item_id where i.kind='rental' and i.id::text like 'f026%'`;
    expect(sections.map((s) => s.name).sort()).toEqual([
      "Cafe",
      "Jamie's",
      "Vendor",
      "Warehouse",
    ]);
    const unbalanced =
      await client`select x.id from inventory_stock x where x.item_id::text like 'f026%' and x.quantity <> (select coalesce(sum(m.quantity),0) from stock_movements m where m.item_id=x.item_id and m.section_id=x.section_id)`;
    expect(unbalanced).toHaveLength(0);
    const app = createApp({
      withDb: (_env, run) => run(db),
      resolveActor: async () => ({
        userId: seedUsers[0].id,
        role: "admin",
        employmentType: "full_time",
      }),
    });
    const response = await app.request(
      `/api/clients/${seedId(3, 1)}`,
      {},
      { ASSETS: { fetch } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Juniper & Co." });
  } finally {
    await client.end();
  }
}, 30_000);
