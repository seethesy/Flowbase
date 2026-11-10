import { z } from "zod";
import { id, localDate, text, timestamp } from "./schema-primitives";

// The inventory pull list (FLOW-134): everything to pull from inventory for one
// event, grouped like the BEO's equipment lists (Q-27).
export const pullGroups = ["kitchen_equipment", "decor", "supplies"] as const;
export const pullGroupSchema = z.enum(pullGroups);
export type PullGroup = z.infer<typeof pullGroupSchema>;
export const pullGroupLabels: Record<PullGroup, string> = {
  kitchen_equipment: "Kitchen equipment",
  decor: "Decor",
  supplies: "Supplies",
};

export const pullStatuses = ["to_pull", "pulled", "loaded", "returned"] as const;
export const pullStatusSchema = z.enum(pullStatuses);
export type PullStatus = z.infer<typeof pullStatusSchema>;
export const pullStatusLabels: Record<PullStatus, string> = {
  to_pull: "To pull",
  pulled: "Pulled",
  loaded: "Loaded",
  returned: "Returned",
};

// Rental items go to Decor when their subtype says so and to Kitchen equipment
// otherwise (equipment, furniture, linen, tableware, glassware, bar); consumables
// are Supplies.
export function pullGroupOf(item: { kind: string; subtype: string | null }): PullGroup {
  if (item.kind === "consumable") return "supplies";
  return item.subtype === "decor" ? "decor" : "kitchen_equipment";
}

// A quantity of null is "TBD" (the sample BEO's "#_" and "MUCHO"): flagged until
// a number is entered.
const quantitySchema = z.number().finite().min(0).max(1_000_000).nullable();

export const pullLineInputSchema = z
  .object({
    group: pullGroupSchema,
    itemId: id.nullable().default(null),
    // A line for something not in the catalog.
    name: text(200).default(""),
    sectionId: id.nullable().default(null),
    quantity: quantitySchema.default(null),
    notes: text(1000).default(""),
    // Goes out the day before.
    setupDay: z.boolean().default(false),
  })
  .refine((line) => line.itemId !== null || line.name !== "", {
    message: "Pick an item or enter a name.",
    path: ["itemId"],
  });
export type PullLineInput = z.input<typeof pullLineInputSchema>;

export const pullLineUpdateSchema = z
  .object({
    sectionId: id.nullable(),
    quantity: quantitySchema,
    notes: text(1000),
    setupDay: z.boolean(),
  })
  .partial()
  .strict();
export type PullLineUpdate = z.infer<typeof pullLineUpdateSchema>;

export const pullLineStatusInputSchema = z.object({ status: pullStatusSchema });

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time.");
export const pullScheduleInputSchema = z
  .object({
    // New York date and time to start pulling, and who pulls.
    date: localDate.nullable(),
    time: time.nullable(),
    pullerId: id.nullable(),
  })
  .refine((value) => (value.date === null) === (value.time === null), {
    message: "Enter both a date and a time, or neither.",
    path: ["time"],
  });
export type PullScheduleInput = z.infer<typeof pullScheduleInputSchema>;

export const pullSuggestions = ["order", "sub_rent", "substitute"] as const;
export const pullSuggestionLabels: Record<(typeof pullSuggestions)[number], string> = {
  order: "Order more",
  sub_rent: "Sub-rent from a vendor",
  substitute: "Substitute another item",
};

export const pullLineSchema = z.object({
  id,
  truckId: id.nullable(),
  group: pullGroupSchema,
  itemId: id.nullable(),
  name: z.string(),
  sectionId: id.nullable(),
  sectionName: z.string().nullable(),
  // null is TBD.
  quantity: z.number().nullable(),
  tbd: z.boolean(),
  notes: z.string(),
  status: pullStatusSchema,
  setupDay: z.boolean(),
  // Built from the proposal rather than added by hand.
  generated: z.boolean(),
  // Changed by hand since it was generated.
  edited: z.boolean(),
  // Who moved it to its current status, and when.
  statusBy: z.string().nullable(),
  statusAt: timestamp.nullable(),
  // The event can't get this much of the item (an open conflict), with the ways out.
  shortfall: z.number().nullable(),
  suggestions: z.array(z.enum(pullSuggestions)),
});
export type PullLine = z.infer<typeof pullLineSchema>;

export const pullListSchema = z.object({
  eventId: id,
  // false until planning (or a manual line) has created the list.
  exists: z.boolean(),
  scheduledAt: timestamp.nullable(),
  scheduledDate: localDate.nullable(),
  scheduledTime: time.nullable(),
  pullerId: id.nullable(),
  pullerName: z.string().nullable(),
  // The date, time or puller is missing (cleared by FLOW-134 AC3).
  missingSchedule: z.boolean(),
  tbdCount: z.number().int(),
  generatedAt: timestamp.nullable(),
  groups: z.array(
    z.object({ group: pullGroupSchema, label: z.string(), lines: z.array(pullLineSchema) }),
  ),
  // events.write: edit lines, schedule, regenerate. Anyone on the event checks lines off.
  canEdit: z.boolean(),
});
export type PullList = z.infer<typeof pullListSchema>;

// What generation produces and regeneration compares (worker/records/pull-list.ts).
export type PullLineValue = {
  group: PullGroup;
  itemId: string | null;
  name: string;
  sectionId: string | null;
  quantity: number | null;
  notes: string;
  setupDay: boolean;
};
export const samePullValue = (a: PullLineValue, b: PullLineValue) =>
  a.group === b.group &&
  a.itemId === b.itemId &&
  a.sectionId === b.sectionId &&
  a.quantity === b.quantity &&
  a.notes === b.notes &&
  a.setupDay === b.setupDay;
export const pullValueLabel = (value: PullLineValue) => value.name;
export const pullValueSummary = (value: PullLineValue) =>
  `${value.quantity === null ? "TBD" : value.quantity} × ${value.name}${value.notes ? ` (${value.notes})` : ""}`;
