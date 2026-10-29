import { z } from "zod";
import type { EventStatus } from "./core-records";
import { bookingOrder } from "./reservations";
import { id, localDate, timestamp } from "./schema-primitives";
import { addLocalDays } from "./time";

// Consumable allocation and projected stock (FLOW-85). When several events need
// the same ingredient, bottle or supply, the event booked first gets the stock
// and the others are short. The rules are pure; the Worker reads stock, events
// and orders and stores the result (worker/records/allocations.ts).

// Events at Closed or later whose requirements become allocations (FLOW-85, FLOW-56):
// Closed and Preparation. A Finished or Lost event no longer needs stock set aside.
export const allocatedEventStatuses = ["closed", "preparation"] as const satisfies readonly EventStatus[];

export const requirementBases = ["fixed", "per_guest"] as const;
export const requirementBasisSchema = z.enum(requirementBases);
export type RequirementBasis = z.infer<typeof requirementBasisSchema>;
export const requirementBasisLabels: Record<RequirementBasis, string> = {
  fixed: "Fixed quantity",
  per_guest: "Per guest",
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

// What an event needs of an item: a fixed quantity, or a quantity for every guest
// (a supply ratio such as 2 napkins per guest). Changing the guest count changes
// the second kind (AC3).
export function requiredQuantity(
  line: { basis: RequirementBasis; quantity: number },
  guestCount: number | null,
): number {
  return round(line.basis === "per_guest" ? line.quantity * (guestCount ?? 0) : line.quantity);
}

export type Demand = {
  eventId: string;
  required: number;
  // When the client signed the event's first DocuSign contract (FLOW-4).
  bookedAt: string | null;
  // When the requirement was entered; breaks ties between equal booking times.
  enteredAt: string;
  // New York date of the event.
  eventDate: string;
  // The vendor's lead time, for the order-by date.
  leadTimeDays: number | null;
};

// Stock on its way, counted from its expected delivery date.
export type OnOrder = { quantity: number; expectedDelivery: string | null };

export type ItemAllocation = {
  eventId: string;
  required: number;
  allocated: number;
  // The event's unmet requirement.
  shortage: number;
  // On hand plus the orders due by the event's date, minus what earlier-booked
  // events already hold: what this event could draw on.
  projectedStock: number;
  // The event date minus the vendor's lead time; null when nothing is short.
  orderBy: string | null;
};

// Allocations are processed in booking order (earliest booked_at first; ties go to
// whichever was entered first). Projected stock = on hand + quantity on order
// (counted from its expected delivery date, so an order due after the event
// doesn't count, AC4) − earlier-booked allocations.
export function allocateConsumable(
  onHand: number,
  onOrder: readonly OnOrder[],
  demands: readonly Demand[],
): ItemAllocation[] {
  const ordered = [...demands].sort((a, b) =>
    bookingOrder(
      { id: a.eventId, bookedAt: a.bookedAt, enteredAt: a.enteredAt },
      { id: b.eventId, bookedAt: b.bookedAt, enteredAt: b.enteredAt },
    ),
  );
  let taken = 0;
  return ordered.map((demand) => {
    const inbound = onOrder
      .filter(
        (order) =>
          order.expectedDelivery !== null &&
          order.expectedDelivery <= demand.eventDate,
      )
      .reduce((sum, order) => sum + order.quantity, 0);
    const projectedStock = Math.max(0, round(onHand + inbound - taken));
    const allocated = round(Math.min(demand.required, projectedStock));
    const shortage = round(demand.required - allocated);
    taken = round(taken + allocated);
    return {
      eventId: demand.eventId,
      required: demand.required,
      allocated,
      shortage,
      projectedStock,
      orderBy:
        shortage > 0
          ? addLocalDays(demand.eventDate, -(demand.leadTimeDays ?? 0))
          : null,
    };
  });
}

// --- API shapes -------------------------------------------------------------

export const requirementLineSchema = z.object({
  itemId: id,
  basis: requirementBasisSchema.default("fixed"),
  // Units of the item's stock unit; per guest for the per_guest basis.
  quantity: z.number().min(0).max(1_000_000),
});
export type RequirementLine = z.input<typeof requirementLineSchema>;

// PUT /api/events/<id>/requirements: the event's manually entered requirements,
// replaced as a set. Menu, bar and supply planning (FLOW-135, FLOW-170) store theirs
// under their own source.
export const requirementsInputSchema = z
  .object({ lines: z.array(requirementLineSchema).max(500) })
  .refine(
    ({ lines }) => new Set(lines.map((line) => line.itemId)).size === lines.length,
    "List each item once.",
  );
export type RequirementsInput = z.input<typeof requirementsInputSchema>;

export const requirementSchema = z.object({
  itemId: id,
  itemName: z.string(),
  unit: z.string(),
  basis: requirementBasisSchema,
  quantity: z.number(),
  source: z.string(),
  // What the event needs now (per guest × guests for the per_guest basis).
  required: z.number(),
  // From the last recompute; null until the event is Closed or later and the job has run.
  allocated: z.number().nullable(),
  shortage: z.number().nullable(),
  projectedStock: z.number().nullable(),
  orderBy: localDate.nullable(),
});
export type Requirement = z.infer<typeof requirementSchema>;

// GET /api/inventory/items/<id>/allocations: who gets the item, in booking order.
export const itemAllocationSchema = z.object({
  eventId: id,
  // null when the viewer can't open the event.
  eventTitle: z.string().nullable(),
  eventDate: localDate.nullable(),
  bookedAt: timestamp.nullable(),
  required: z.number(),
  allocated: z.number(),
  shortage: z.number(),
  projectedStock: z.number(),
  orderBy: localDate.nullable(),
});
export type ItemAllocationRow = z.infer<typeof itemAllocationSchema>;
