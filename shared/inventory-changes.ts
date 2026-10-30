import { z } from "zod";
import { itemInputSchema } from "./inventory";
import { id, timestamp } from "./schema-primitives";

const field = z.enum(["name", "description", "category", "group", "priceCents"]);
export const inventoryChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), item: itemInputSchema }),
  z.object({ type: z.literal("replace"), itemId: id, item: itemInputSchema }),
  z.object({ type: z.literal("field"), itemId: id, field,
    value: z.union([z.string().max(5000), z.number().int().min(0).max(100_000_000), z.null()]) }),
  z.object({ type: z.literal("archive"), itemId: id, archived: z.boolean() }),
  z.object({ type: z.literal("quantity"), itemId: id, sectionId: id,
    quantity: z.number().finite().min(0).max(1_000_000) }),
]);
export const inventoryChangesSchema = z.object({
  changes: z.array(inventoryChangeSchema).min(1).max(100),
});
export type InventoryChange = z.output<typeof inventoryChangeSchema>;
export type InventoryChangeInput = z.input<typeof inventoryChangeSchema>;
export const inventoryChangeResultSchema = z.object({ applied: z.boolean(), approvalId: id.nullable() });
export const pendingInventoryChangeSchema = z.object({ itemId: id, field: z.string(),
  approvalId: id, proposedBy: z.string(), proposedAt: timestamp });
