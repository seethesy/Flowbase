import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// FLOW-328 AC4: Sales › Leads and Sales › Proposals moved to the new Leads
// heading, and each role keeps what the Admin hid (FLOW-284).
it("moves each role's hidden Sales tabs to the Leads heading", async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must point to disposable CI Postgres.");
  const admin = postgres(url, { max: 1 });
  const database = `nav_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
  const folder = await mkdtemp(join(tmpdir(), "flowbase-nav-"));
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
    const move = journal.entries.findIndex((entry: { tag: string }) => entry.tag.endsWith("_flow_328_leads_heading_visibility"));
    expect(move).toBeGreaterThan(0);
    const before = journal.entries.slice(0, move);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: before }));
    for (const entry of before) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    await migrate(db, { migrationsFolder: folder });

    await client`insert into role_nav_hidden (role, hidden) values
      ('salesperson', '["sales.proposals"]'::jsonb),
      ('staff', '["reports", "sales"]'::jsonb),
      ('kitchen_lead', '["sales.leads", "sales.venues"]'::jsonb),
      ('technical', '["events.beos"]'::jsonb),
      ('sales_manager', '["reports.time-tracking", "reports.operational-reports"]'::jsonb),
      ('part_time_staff', '["reports.time-tracking"]'::jsonb)`;

    await migrate(db, { migrationsFolder: "drizzle" });

    const rows = await client<{ role: string; hidden: string[] }[]>`select role, hidden from role_nav_hidden order by role`;
    expect(Object.fromEntries(rows.map((row) => [row.role, row.hidden]))).toEqual({
      kitchen_lead: ["leads.overview", "sales.venues"],
      part_time_staff: [],
      sales_manager: ["sales.time-tracking"],
      salesperson: ["leads.proposals"],
      // The whole Sales heading was hidden, so the new Leads heading is too.
      staff: ["leads", "sales", "sales.time-tracking"],
      technical: ["leads.beos"],
    });
  } finally {
    await client?.end();
    if (created) await admin.unsafe(`DROP DATABASE "${database}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  }
}, 30_000);
