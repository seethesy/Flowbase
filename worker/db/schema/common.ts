// Column helpers and value lists shared by several schema files.
import { index, numeric, uuid, type ExtraConfigColumn } from "drizzle-orm/pg-core";

// Trigram index for global search (FLOW-46): fuzzy name matching with pg_trgm.
export const trigram = (name: string, column: ExtraConfigColumn) =>
  index(name).using("gin", column.op("gin_trgm_ops"));
// Inventory (FLOW-69/70/81). Quantities can be fractional (2.5 lb), so they are
// numeric, read as numbers. Units are the codes in shared/units.ts.
export const quantity = (name: string) =>
  numeric(name, { precision: 14, scale: 4, mode: "number" });
// A reference to an item of any list (the ledger, stock, counts): no foreign key,
// since it points at whichever table the item is in (FLOW-289).
export const anyItemReference = () => uuid("item_id").notNull();
