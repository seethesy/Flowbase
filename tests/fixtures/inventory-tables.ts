import { inArray } from "drizzle-orm";
import type { DbLike } from "../../worker/db/client";
import {
  barInventoryItems,
  kitchenIngredients,
  masterInventoryItems,
} from "../../worker/db/schema";

// FLOW-289: items live in three tables with the same columns. Tests insert
// through these helpers, which pick the table from the item's kind and subtype
// as the API does (worker/records/inventory/inventory-common.ts).
export type ItemValues = typeof masterInventoryItems.$inferInsert;
type ItemTable = typeof masterInventoryItems;

export const itemTables = [masterInventoryItems, barInventoryItems, kitchenIngredients] as unknown as ItemTable[];

export function itemTableFor(item: { kind?: string | null; subtype?: string | null }): ItemTable {
  if (item.kind === "consumable" && item.subtype === "bar") return barInventoryItems as unknown as ItemTable;
  if (item.kind === "consumable" && item.subtype === "ingredient") return kitchenIngredients as unknown as ItemTable;
  return masterInventoryItems;
}

// Inserts items into their own tables and returns the rows in the order given.
export async function insertItems(db: DbLike, values: ItemValues | ItemValues[]) {
  const list = Array.isArray(values) ? values : [values];
  const rows: (typeof masterInventoryItems.$inferSelect)[] = [];
  for (const value of list) {
    const [row] = await db.insert(itemTableFor(value)).values(value).returning();
    rows.push(row);
  }
  return rows;
}

// Deletes items from whichever table holds them.
export async function deleteItems(db: DbLike, ids: string[]) {
  if (!ids.length) return;
  for (const table of itemTables) await db.delete(table).where(inArray(table.id, ids));
}
