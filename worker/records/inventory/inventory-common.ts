import type { z } from "zod";
import type {
  correctionInputSchema,
  countInputSchema,
  countLineInputSchema,
  movementInputSchema,
  sectionInputSchema,
  transferInputSchema,
} from "../../../shared/inventory";
import { eq } from "drizzle-orm";
import { inventoryListOf, type InventoryList, type ItemKind } from "../../../shared/inventory";
import type { DbLike } from "../../db/client";
import {
  allInventoryItems,
  barInventoryItems,
  inventoryLocations,
  kitchenIngredients,
  masterInventoryItems,
} from "../../db/schema";
import { ApiError, notFound } from "../../hono";

// Types and helpers shared by the inventory record files (FLOW-193).
export type ItemRow = typeof masterInventoryItems.$inferSelect;
export type SectionRow = typeof inventoryLocations.$inferSelect;
export type TransferInput = z.output<typeof transferInputSchema>;
export type CountInput = z.output<typeof countInputSchema>;
export type CountLineInput = z.output<typeof countLineInputSchema>;
export type MovementInput = z.output<typeof movementInputSchema>;
export type CorrectionInput = z.output<typeof correctionInputSchema>;
export type SectionInput = z.output<typeof sectionInputSchema>;

// Four decimal places, as stored; keeps 0.1 + 0.2 from drifting.
export const round = (value: number) => Math.round(value * 10_000) / 10_000;

export const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);

// The three inventory lists (FLOW-289) are three tables with the same columns.
// Reads that don't care which list an item is in use the all_inventory_items view;
// a write or a row lock goes to the item's own table. The tables are typed as
// Master's: the column names and types are the same, only the table name differs.
export type ItemTable = typeof masterInventoryItems;
const tables = {
  master: masterInventoryItems,
  bar: barInventoryItems,
  kitchen: kitchenIngredients,
} as const;
export const itemTable = (list: InventoryList): ItemTable =>
  tables[list] as unknown as ItemTable;
export const itemTableOf = (item: { kind: ItemKind; subtype: string | null }) =>
  itemTable(inventoryListOf(item));

// Locks the item's row in its own table (FOR UPDATE can't run on the union view).
// undefined when there is no such item.
export async function lockItemRow(tx: DbLike, id: string): Promise<ItemRow | undefined> {
  const [found] = await tx
    .select({ kind: allInventoryItems.kind, subtype: allInventoryItems.subtype })
    .from(allInventoryItems)
    .where(eq(allInventoryItems.id, id));
  if (!found) return undefined;
  const table = itemTableOf(found);
  const [row] = await tx.select().from(table).where(eq(table.id, id)).for("update");
  return row;
}
export async function requireLockedItem(tx: DbLike, id: string) {
  const row = await lockItemRow(tx, id);
  if (!row) throw notFound("Item");
  return row;
}
