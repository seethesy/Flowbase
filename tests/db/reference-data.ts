import { readdirSync, readFileSync } from "node:fs";
import type postgres from "postgres";

// Migrations that seed reference data. Migrations never run again on the same
// database, so a file that clears these tables puts the rows back when it is done
// (FLOW-182). The default locations and kitchen storage are FLOW-289's.
const sectionSeeds = readdirSync("drizzle")
  .filter((name) => name.endsWith("_flow_289_default_locations.sql"))
  .map((name) => `drizzle/${name}`);

export async function restoreDefaultSections(client: ReturnType<typeof postgres>) {
  await client`truncate table inventory_locations cascade`;
  for (const path of sectionSeeds)
    for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint"))
      if (statement.trim()) await client.unsafe(statement);
}
