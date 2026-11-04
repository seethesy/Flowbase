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

// --- Bar tiers (FLOW-170) ------------------------------------------------------

// A tier line asks for a quantity of a tier ("12 bottles of rail vodka") instead of
// an item. Bar items of one category and tier are allocated together as a pool
// (A1): in booking order, each event first takes its item lines from those items,
// then its tier lines from whichever matching items still have stock, most first.
// What a tier line can't get is short on the tier's house pick, or the first item
// by name, so the order list reorders that item (A2).

export type PoolItem = {
  itemId: string;
  name: string;
  onHand: number;
  onOrder: readonly OnOrder[];
  leadTimeDays: number | null;
  housePick: boolean;
};

export type PoolTierDemand = {
  // The tier line's id.
  lineId: string;
  required: number;
  // Pool items the line can draw from (same subcategory, or any when the line
  // names none).
  candidates: readonly string[];
};

export type PoolDemand = Omit<Demand, "required" | "leadTimeDays"> & {
  // Item lines: what the event needs of each pool item.
  items: Readonly<Record<string, number>>;
  tiers: readonly PoolTierDemand[];
};

export type TierAllocation = {
  eventId: string;
  lineId: string;
  required: number;
  allocated: number;
  shortage: number;
  // The item the shortage is ordered as; null when the tier has no items.
  reorderItemId: string | null;
  orderBy: string | null;
};

// The item a tier's shortage is ordered as (A2).
export function reorderItem(items: readonly Pick<PoolItem, "itemId" | "name" | "housePick">[]) {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId));
  return sorted.find((item) => item.housePick) ?? sorted[0] ?? null;
}

export function allocatePool(
  items: readonly PoolItem[],
  demands: readonly PoolDemand[],
): { items: (ItemAllocation & { itemId: string })[]; tiers: TierAllocation[] } {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const taken = new Map(items.map((item) => [item.itemId, 0]));
  const ordered = [...demands].sort((a, b) =>
    bookingOrder(
      { id: a.eventId, bookedAt: a.bookedAt, enteredAt: a.enteredAt },
      { id: b.eventId, bookedAt: b.bookedAt, enteredAt: b.enteredAt },
    ),
  );
  const itemResults: (ItemAllocation & { itemId: string })[] = [];
  const tierResults: TierAllocation[] = [];
  for (const demand of ordered) {
    const projected = (itemId: string) => {
      const item = byId.get(itemId)!;
      const inbound = item.onOrder
        .filter((order) => order.expectedDelivery !== null && order.expectedDelivery <= demand.eventDate)
        .reduce((sum, order) => sum + order.quantity, 0);
      return Math.max(0, round(item.onHand + inbound - taken.get(itemId)!));
    };
    const rows = new Map<string, ItemAllocation & { itemId: string }>();
    const row = (itemId: string) => {
      let found = rows.get(itemId);
      if (!found) {
        found = { itemId, eventId: demand.eventId, required: 0, allocated: 0, shortage: 0,
          projectedStock: projected(itemId), orderBy: null };
        rows.set(itemId, found);
      }
      return found;
    };
    const take = (itemId: string, wanted: number) => {
      // The row records what the item had before this event took any of it.
      const target = row(itemId);
      const got = round(Math.min(wanted, projected(itemId)));
      taken.set(itemId, round(taken.get(itemId)! + got));
      target.allocated = round(target.allocated + got);
      return got;
    };
    const short = (itemId: string, quantity: number) => {
      const target = row(itemId);
      target.shortage = round(target.shortage + quantity);
      target.required = round(target.required + quantity);
    };
    // Item lines first, as for any consumable.
    for (const [itemId, required] of Object.entries(demand.items)) {
      if (!byId.has(itemId) || required <= 0) continue;
      row(itemId).required = round(row(itemId).required + required);
      const got = take(itemId, required);
      if (got < required) row(itemId).shortage = round(row(itemId).shortage + required - got);
    }
    // Then tier lines, the narrowest first (rail vodka before any rail liquor).
    for (const tier of [...demand.tiers].sort((a, b) => a.candidates.length - b.candidates.length)) {
      let remaining = tier.required;
      const candidates = tier.candidates.filter((itemId) => byId.has(itemId));
      const sorted = [...candidates].sort((a, b) =>
        projected(b) - projected(a) || byId.get(a)!.name.localeCompare(byId.get(b)!.name));
      for (const itemId of sorted) {
        if (remaining <= 0) break;
        const before = remaining;
        const got = take(itemId, remaining);
        if (got > 0) row(itemId).required = round(row(itemId).required + got);
        remaining = round(before - got);
      }
      const reorder = reorderItem(candidates.map((itemId) => byId.get(itemId)!));
      if (remaining > 0 && reorder) short(reorder.itemId, remaining);
      tierResults.push({
        eventId: demand.eventId,
        lineId: tier.lineId,
        required: tier.required,
        allocated: round(tier.required - remaining),
        shortage: remaining,
        reorderItemId: reorder?.itemId ?? null,
        orderBy: remaining > 0
          ? addLocalDays(demand.eventDate, -((reorder && byId.get(reorder.itemId)!.leadTimeDays) ?? 0))
          : null,
      });
    }
    for (const result of rows.values()) {
      result.orderBy = result.shortage > 0
        ? addLocalDays(demand.eventDate, -(byId.get(result.itemId)!.leadTimeDays ?? 0))
        : null;
      // Items a tier line looked at but took nothing from have no allocation.
      if (result.required > 0 || result.shortage > 0) itemResults.push(result);
    }
  }
  return { items: itemResults, tiers: tierResults };
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

// --- Bar plan (FLOW-170) ----------------------------------------------------------

export const barTierLineSchema = z.object({
  category: z.string().trim().min(1).max(100),
  // Empty: any subcategory of the category (e.g. any rail liquor).
  subcategory: z.string().trim().max(100).default(""),
  tier: z.enum(["rail", "mid", "high", "premium"]),
  basis: requirementBasisSchema.default("fixed"),
  // In the tier's items' stock unit (bottles for liquor and wine).
  quantity: z.number().min(0).max(1_000_000),
});
export type BarTierLineInput = z.input<typeof barTierLineSchema>;

// PUT /api/events/<id>/bar-plan: the event's bar lines, by item and by tier,
// replaced as a set.
export const barPlanInputSchema = z
  .object({
    items: z.array(requirementLineSchema).max(500).default([]),
    tiers: z.array(barTierLineSchema).max(100).default([]),
  })
  .refine(
    ({ items }) => new Set(items.map((line) => line.itemId)).size === items.length,
    "List each item once.",
  )
  .refine(
    ({ tiers }) =>
      new Set(tiers.map((line) => `${line.category}|${line.subcategory ?? ""}|${line.tier}`)).size === tiers.length,
    "List each tier once.",
  );
export type BarPlanInput = z.input<typeof barPlanInputSchema>;

export const barTierPlanSchema = z.object({
  id,
  category: z.string(),
  subcategory: z.string(),
  tier: z.enum(["rail", "mid", "high", "premium"]),
  basis: requirementBasisSchema,
  quantity: z.number(),
  required: z.number(),
  // From the last recompute; null until the event is Closed or later.
  allocated: z.number().nullable(),
  shortage: z.number().nullable(),
  orderBy: localDate.nullable(),
  reorderItemName: z.string().nullable(),
  // Names of the bar items the line can draw from.
  items: z.array(z.string()),
});
export type BarTierPlan = z.infer<typeof barTierPlanSchema>;

export const barPlanSchema = z.object({
  items: z.array(requirementSchema),
  tiers: z.array(barTierPlanSchema),
});
export type BarPlan = z.infer<typeof barPlanSchema>;
