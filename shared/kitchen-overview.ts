import { z } from "zod";
import { id } from "./schema-primitives";

// Kitchen › Overview (FLOW-293): every menu item of every event from today
// through the next 14 days (New York time) at Negotiation or later, one row per
// event kitchen line, with who in the kitchen is in charge of it.
export const KITCHEN_OVERVIEW_DAYS = 14;

export const kitchenOverviewRowSchema = z.object({
  lineId: id,
  eventId: id,
  eventTitle: z.string(),
  // The event's New York date, and the food ready time: when food leaves the
  // kitchen, falling back to the event start ("HH:MM").
  date: z.string(),
  foodReadyTime: z.string(),
  guestCount: z.number().int().nullable(),
  menuItem: z.string(),
  course: z.string(),
  // The line's planned quantity; null when not set.
  servingSize: z.number().nullable(),
  specialRequests: z.string(),
  allergies: z.array(z.string()),
  inChargeStaffId: id.nullable(),
});
export type KitchenOverviewRow = z.infer<typeof kitchenOverviewRowSchema>;

export const kitchenOverviewSchema = z.object({
  rows: z.array(kitchenOverviewRowSchema),
  // Active staff whose role or position is Kitchen, plus anyone already in
  // charge of a row shown, by name.
  staff: z.array(z.object({ id, name: z.string() })),
  // May change In charge (the people who edit the kitchen menu).
  canEdit: z.boolean(),
});
export type KitchenOverview = z.infer<typeof kitchenOverviewSchema>;

// PATCH /api/kitchen/lines/:id/in-charge; null clears it.
export const kitchenInChargeInputSchema = z.object({ staffId: id.nullable() }).strict();
export type KitchenInChargeInput = z.infer<typeof kitchenInChargeInputSchema>;
export const kitchenInChargeResultSchema = z.object({ lineId: id, inChargeStaffId: id.nullable() });

// Kitchen roles; a staff position counts when its name says Kitchen.
export const kitchenRoles = ["kitchen_lead", "kitchen_staff"] as const;
export const isKitchenPosition = (position: string) => /kitchen/i.test(position);
