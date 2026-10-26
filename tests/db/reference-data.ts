import { readFileSync } from "node:fs";
import type postgres from "postgres";

// Migrations that seed reference data. Migrations never run again on the same
// database, so a file that clears these tables puts the rows back when it is done
// (FLOW-182).
const sectionSeeds = [
  "drizzle/0005_default_inventory_sections.sql",
  "drizzle/0012_unlabeled_section.sql",
];

export async function restoreDefaultSections(client: ReturnType<typeof postgres>) {
  await client`truncate table inventory_sections cascade`;
  for (const path of sectionSeeds)
    for (const statement of readFileSync(path, "utf8").split("--> statement-breakpoint"))
      if (statement.trim()) await client.unsafe(statement);
}
