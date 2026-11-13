import { eq, inArray } from "drizzle-orm";
import type { RequirementItem } from "../../shared/inventory-requirements";
import type { DbLike } from "../db/client";
import { inventoryItems, inventoryRentalDetails, inventoryServiceDetails } from "../db/schema";

// Catalog rows for expanding kits and services (shared/inventory-requirements.ts):
// the pull list (FLOW-134) and holds (FLOW-212, FLOW-213) read them the same way.

export type CatalogItem = RequirementItem & { kind: string; subtype: string | null;
  ratioQuantity: number | null; ratioBasis: string | null };

// Loads the items a set of ids needs, following kit components and service
// inclusions until nothing new turns up.
export async function loadCatalog(db: DbLike, ids: string[]) {
  const catalog = new Map<string, CatalogItem>();
  let pending = [...new Set(ids)];
  while (pending.length) {
    const rows = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        kind: inventoryItems.kind,
        subtype: inventoryItems.subtype,
        ratioQuantity: inventoryItems.ratioQuantity,
        ratioBasis: inventoryItems.ratioBasis,
        active: inventoryItems.active,
        archivedAt: inventoryItems.archivedAt,
        includes: inventoryServiceDetails.includes,
        components: inventoryRentalDetails.components,
      })
      .from(inventoryItems)
      .leftJoin(inventoryServiceDetails, eq(inventoryServiceDetails.itemId, inventoryItems.id))
      .leftJoin(inventoryRentalDetails, eq(inventoryRentalDetails.itemId, inventoryItems.id))
      .where(inArray(inventoryItems.id, pending));
    const next = new Set<string>();
    for (const row of rows) {
      catalog.set(row.id, {
        id: row.id,
        name: row.name,
        kind: row.kind,
        subtype: row.subtype,
        ratioQuantity: row.ratioQuantity,
        ratioBasis: row.ratioBasis,
        active: row.active,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        service: row.kind === "service" ? { includes: row.includes ?? [] } : null,
        rental: row.kind === "rental" ? { components: row.components ?? [] } : null,
      });
      for (const line of row.includes ?? []) next.add(line.itemId);
      for (const line of row.components ?? []) next.add(line.itemId);
    }
    pending = [...next].filter((id) => !catalog.has(id));
  }
  return catalog;
}
