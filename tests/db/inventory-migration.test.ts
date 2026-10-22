import { mkdtemp, readFile, copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

it("upgrades the audit-log schema to the ledger without losing stock or movement history", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must point to disposable CI Postgres.");
  const admin = postgres(url, { max: 1 });
  const database = `ledger_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "flowbase-ledger-"));
  let client: ReturnType<typeof postgres> | undefined;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    created = true;
    const upgradeUrl = new URL(url);
    upgradeUrl.pathname = `/${database}`;
    client = postgres(upgradeUrl.toString(), { max: 1 });
    const db = drizzle(client);
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const beforeLedger = journal.entries.filter((entry: { idx: number }) => entry.idx < 10);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: beforeLedger }));
    for (const entry of beforeLedger) {
      await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    }
    await migrate(db, { migrationsFolder: folder });
    const [item] = await client`insert into inventory_items (kind, subtype, name) values ('rental', 'furniture', 'Migration chair') returning id`;
    const sections = await client`insert into inventory_sections (name, kind) values ('Upgrade source', 'rental'), ('Upgrade destination', 'rental') returning id`;
    const source = sections[0].id;
    const destination = sections[1].id;
    await client`insert into inventory_stock (item_id, section_id, quantity) values (${item.id}, ${source}, 7), (${item.id}, ${destination}, 3)`;
    await client`insert into stock_movements (item_id, type, quantity, to_section_id, note) values (${item.id}, 'adjustment', 10, ${source}, 'Starting count')`;
    const [transfer] = await client`insert into stock_movements (item_id, type, quantity, from_section_id, to_section_id, note) values (${item.id}, 'transfer', 3, ${source}, ${destination}, 'Moved chairs') returning id`;

    await migrate(db, { migrationsFolder: "drizzle" });
    const totals = await client`select s.section_id, s.quantity, sum(m.quantity) as ledger from inventory_stock s join stock_movements m on m.item_id = s.item_id and m.section_id = s.section_id group by s.section_id, s.quantity order by s.section_id`;
    expect(totals).toHaveLength(2);
    for (const row of totals) expect(Number(row.ledger)).toBe(Number(row.quantity));
    const movements = await client`select type, section_id, quantity, reason, transfer_id from stock_movements order by quantity`;
    expect(movements).toHaveLength(3);
    expect(movements.map((row) => ({ ...row, quantity: Number(row.quantity) }))).toEqual([
      { type: "transfer", section_id: source, quantity: -3, reason: "Moved chairs", transfer_id: transfer.id },
      { type: "transfer", section_id: destination, quantity: 3, reason: "Moved chairs", transfer_id: transfer.id },
      { type: "count", section_id: source, quantity: 10, reason: "Starting count", transfer_id: null },
    ]);
    await expect(client`update stock_movements set quantity = 0`).rejects.toThrow("append-only");
    await expect(client`delete from stock_movements`).rejects.toThrow("append-only");
    expect(await client`select id from inventory_sections where name = 'Unlabeled'`).toHaveLength(1);
    expect((await client`select to_regclass('public.audit_log') as name`)[0].name).toBe("audit_log");
    // A repeated deploy must skip all applied migrations, including the seed.
    await migrate(db, { migrationsFolder: "drizzle" });
    expect(await client`select id from stock_movements`).toHaveLength(3);
  } finally {
    await client?.end();
    if (created) await admin.unsafe(`DROP DATABASE "${database}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);
