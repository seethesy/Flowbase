import { z } from "zod";
import { id, localDate, text, timestamp } from "./schema-primitives";
import { orderQuantity, type Unit } from "./units";

export const orderLineSchema = z.object({
  itemId: id,
  itemName: z.string(),
  vendorId: id.nullable(),
  vendorName: z.string(),
  orderingInstructions: z.string(),
  quantity: z.number().finite().min(0),
  purchaseUnit: z.string(),
  shortage: z.number().finite().min(0),
  orderBy: localDate.nullable(),
  eventIds: z.array(id),
  eventTitles: z.array(z.string()),
  note: text(1000).default(""),
});
export type OrderLine = z.infer<typeof orderLineSchema>;
export const orderListInputSchema = z.object({ from: localDate, to: localDate })
  .refine((value) => value.from <= value.to, "End date must be on or after start date.");
export const orderListLinesSchema = z.object({ lines: z.array(orderLineSchema).max(500) });
export const orderListSchema = orderListInputSchema.safeExtend({
  id, status: z.enum(["draft", "submitted", "approved", "rejected"]),
  lines: z.array(orderLineSchema), approvalId: id.nullable(),
  createdAt: timestamp, updatedAt: timestamp,
});
export type OrderList = z.infer<typeof orderListSchema>;

export type OrderCandidate = {
  itemId: string; itemName: string; unit: Unit; purchaseUnit: Unit;
  packCount: number | null; eachSize: { quantity: number; unit: Unit } | null;
  vendorId: string | null; vendorName: string; orderingInstructions: string;
  onHand: number; parLevel: number | null;
  shortages: { eventId: string; eventTitle: string; quantity: number; orderBy: string | null }[];
};

// Event shortages and the par gap describe the same demand; use the larger gap,
// then convert once and round to whole purchase units.
export function suggestOrderLines(candidates: OrderCandidate[]): OrderLine[] {
  return candidates.flatMap((item) => {
    const shortage = item.shortages.reduce((sum, row) => sum + row.quantity, 0);
    const gap = Math.max(shortage, Math.max(0, (item.parLevel ?? 0) - item.onHand));
    if (gap <= 0) return [];
    const purchased = orderQuantity(gap, item.unit, item.purchaseUnit, {
      packCount: item.packCount, eachSize: item.eachSize,
    });
    return [{ itemId: item.itemId, itemName: item.itemName, vendorId: item.vendorId,
      vendorName: item.vendorName || "Unassigned vendor",
      orderingInstructions: item.orderingInstructions,
      quantity: purchased.ok ? purchased.value : 0, purchaseUnit: item.purchaseUnit,
      shortage: gap,
      orderBy: item.shortages.map((row) => row.orderBy).filter((value): value is string => !!value).sort()[0] ?? null,
      eventIds: [...new Set(item.shortages.map((row) => row.eventId))],
      eventTitles: [...new Set(item.shortages.map((row) => row.eventTitle))],
      note: purchased.ok ? "" : "Set purchase quantity: stock and purchase units cannot be converted." }];
  });
}
