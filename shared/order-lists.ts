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

// Order list statuses (Q-15, FLOW-87): draft → submitted → approved → ordered →
// partially_received → received | cancelled. A rejected list goes back to editing.
export const orderListStatuses = ["draft", "submitted", "approved", "rejected", "ordered",
  "partially_received", "received", "cancelled"] as const;
export type OrderListStatus = (typeof orderListStatuses)[number];
// Statuses after approval, when the list's lines are fixed and orders are recorded.
export const placedListStatuses = ["approved", "ordered", "partially_received", "received", "cancelled"] as const;
export const isPlaced = (status: OrderListStatus) => (placedListStatuses as readonly string[]).includes(status);

// One vendor's order, placed by hand on the vendor's portal and recorded here
// (FLOW-87), then received line by line (FLOW-88).
export const vendorOrderStatuses = ["ordered", "partially_received", "received", "cancelled"] as const;
export type VendorOrderStatus = (typeof vendorOrderStatuses)[number];
export const receiptLineSchema = z.object({
  // Purchase units that arrived in usable condition.
  quantity: z.number().finite().min(0),
  // Actual cost of one purchase unit; null when not entered.
  unitCostCents: z.number().int().min(0).nullable(),
  note: z.string(),
});
export const vendorOrderLineSchema = z.object({
  itemId: id,
  itemName: z.string(),
  purchaseUnit: z.string(),
  // From the approved list; ordered differs when the portal order changed it.
  approvedQuantity: z.number().finite().min(0),
  ordered: z.number().finite().min(0),
  received: z.number().finite().min(0),
  // Short or damaged deliveries, noted per line.
  note: z.string(),
});
export type VendorOrderLine = z.infer<typeof vendorOrderLineSchema>;
export const vendorOrderReceiptSchema = z.object({
  at: timestamp,
  by: id.nullable(),
  lines: z.array(receiptLineSchema.safeExtend({ itemId: id })),
});
export type VendorOrderReceipt = z.infer<typeof vendorOrderReceiptSchema>;
export const vendorOrderSchema = z.object({
  id,
  vendorId: id.nullable(),
  vendorName: z.string(),
  status: z.enum(vendorOrderStatuses),
  portalOrderNumber: z.string(),
  orderedOn: localDate,
  expectedDelivery: localDate,
  // Null when the user can't see costs, or none was entered.
  totalCents: z.number().int().nullable(),
  notes: z.string(),
  lines: z.array(vendorOrderLineSchema),
  receipts: z.array(vendorOrderReceiptSchema),
  createdAt: timestamp,
});
export type VendorOrder = z.infer<typeof vendorOrderSchema>;

export const orderListSchema = orderListInputSchema.safeExtend({
  id, status: z.enum(orderListStatuses),
  lines: z.array(orderLineSchema), approvalId: id.nullable(),
  orders: z.array(vendorOrderSchema).default([]),
  createdAt: timestamp, updatedAt: timestamp,
});
export type OrderList = z.infer<typeof orderListSchema>;

// POST /api/order-lists/<id>/orders: Admin records one vendor's portal order (AC1:
// the portal order number and expected delivery date are required).
export const recordOrderInputSchema = z.object({
  vendorName: z.string().min(1),
  portalOrderNumber: text(100).min(1, "Enter the portal order number."),
  orderedOn: localDate,
  expectedDelivery: localDate,
  totalCents: z.number().int().min(0).nullable().default(null),
  notes: text(1000).default(""),
  // Changes from the approved lines: the quantity actually ordered per item.
  // Items left out are ordered as approved; 0 drops the item.
  lines: z.array(z.object({ itemId: id, ordered: z.number().finite().min(0).max(1_000_000) }))
    .max(500).default([]),
}).refine((value) => value.expectedDelivery >= value.orderedOn,
  { message: "Expected delivery must be on or after the order date.", path: ["expectedDelivery"] });
export type RecordOrderInput = z.input<typeof recordOrderInputSchema>;

// POST /api/order-lists/<id>/orders/<orderId>/receive: one delivery (FLOW-88).
export const receiveInputSchema = z.object({
  lines: z.array(z.object({
    itemId: id,
    quantity: z.number().finite().min(0).max(1_000_000),
    unitCostCents: z.number().int().min(0).nullable().default(null),
    note: text(500).default(""),
  })).min(1).max(500),
  // Nothing more is coming: close the order even if lines are short.
  complete: z.boolean().default(false),
});
export type ReceiveInput = z.input<typeof receiveInputSchema>;

const tidy = (value: number) => Math.round(value * 10_000) / 10_000;

// What is still to arrive on a line, in purchase units.
export const outstanding = (line: Pick<VendorOrderLine, "ordered" | "received">) =>
  Math.max(0, tidy(line.ordered - line.received));

// Adds one delivery to the order's lines and works out its status (FLOW-88 AC1):
// received once every line has arrived in full, or when the user says nothing more
// is coming; otherwise partially received.
export function applyReceipt(
  lines: VendorOrderLine[],
  receipt: { itemId: string; quantity: number; note: string }[],
  complete: boolean,
): { lines: VendorOrderLine[]; status: VendorOrderStatus } {
  const byItem = new Map(receipt.map((row) => [row.itemId, row]));
  const next = lines.map((line) => {
    const row = byItem.get(line.itemId);
    if (!row) return line;
    return { ...line, received: tidy(line.received + row.quantity),
      note: row.note ? (line.note ? `${line.note}\n${row.note}` : row.note) : line.note };
  });
  const done = complete || next.every((line) => outstanding(line) === 0);
  return { lines: next, status: done ? "received" : "partially_received" };
}

// The list's status follows its vendor orders: ordered until something arrives,
// then partially received until every vendor's order has been received or
// cancelled. Vendors not ordered yet keep the list from being received.
export function listStatusFromOrders(
  vendors: string[],
  orders: Pick<VendorOrder, "vendorName" | "status">[],
): OrderListStatus {
  const active = orders.filter((order) => order.status !== "cancelled");
  if (!active.length)
    return orders.length && vendors.every((vendor) => orders.some((order) => order.vendorName === vendor))
      ? "cancelled" : "approved";
  const covered = vendors.every((vendor) => orders.some((order) => order.vendorName === vendor));
  if (covered && active.every((order) => order.status === "received")) return "received";
  if (active.some((order) => order.status !== "ordered")) return "partially_received";
  return "ordered";
}

// Vendors the list orders from: the groups of lines with something to buy.
export const listVendors = (lines: Pick<OrderLine, "vendorName" | "quantity">[]) =>
  [...new Set(lines.filter((line) => line.quantity > 0).map((line) => line.vendorName))].sort();

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
