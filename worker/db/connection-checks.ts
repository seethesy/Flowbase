import { desc, isNull } from "drizzle-orm";
import type { ConnectionCheck } from "../../shared/api";
import type { Db } from "./client";
import { connectionChecks } from "./schema";

type Row = typeof connectionChecks.$inferSelect;
const toCheck = (row: Row): ConnectionCheck => ({
  id: row.id,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

export async function listConnectionChecks(
  db: Db,
  limit = 10,
): Promise<ConnectionCheck[]> {
  const rows = await db
    .select()
    .from(connectionChecks)
    .where(isNull(connectionChecks.archivedAt))
    .orderBy(desc(connectionChecks.createdAt))
    .limit(limit);
  return rows.map(toCheck);
}

export async function createConnectionCheck(
  db: Db,
  note: string,
): Promise<ConnectionCheck> {
  const [row] = await db.insert(connectionChecks).values({ note }).returning();
  return toCheck(row);
}
