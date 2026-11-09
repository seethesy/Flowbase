import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";
import { taskStatusSchema } from "./tasks";

// The kitchen menu (FLOW-137): the kitchen's view of one event, matching the BEO's
// Food Setup section. Dishes come from the mapped proposal; the Kitchen Lead plans
// quantities and assigns prep as kitchen tasks (F-04-01).
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time.");

export const kitchenLineInputSchema = z.object({
  recipeId: id,
  // Course, e.g. Mains. Defaults to the dish's recipe category.
  course: text(100).default(""),
  // null is TBD.
  plannedQuantity: z.number().finite().min(0).max(1_000_000).nullable().default(null),
  notes: text(1000).default(""),
});
export type KitchenLineInput = z.input<typeof kitchenLineInputSchema>;

export const kitchenLineUpdateSchema = z
  .object({
    course: text(100).min(1, "Enter a course."),
    plannedQuantity: z.number().finite().min(0).max(1_000_000).nullable(),
    notes: text(1000),
  })
  .partial()
  .strict();
export type KitchenLineUpdate = z.infer<typeof kitchenLineUpdateSchema>;

// New York time on the event date; null clears it.
export const kitchenTimesInputSchema = z.object({ leavesKitchenTime: time.nullable() });
export type KitchenTimesInput = z.infer<typeof kitchenTimesInputSchema>;

export const kitchenLineSchema = z.object({
  id,
  recipeId: id,
  name: z.string(),
  course: z.string(),
  plannedQuantity: z.number().nullable(),
  tbd: z.boolean(),
  notes: z.string(),
  allergens: z.array(z.string()),
  dietaryTags: z.array(z.string()),
  // Has a yield, so scaled ingredients can be worked out.
  scalable: z.boolean(),
  generated: z.boolean(),
  edited: z.boolean(),
});
export type KitchenLine = z.infer<typeof kitchenLineSchema>;

export const kitchenTaskSchema = z.object({
  id,
  title: z.string(),
  status: taskStatusSchema,
  assignees: z.array(z.object({ id, name: z.string() })),
});
export type KitchenTask = z.infer<typeof kitchenTaskSchema>;

export const kitchenMenuSchema = z.object({
  eventId: id,
  exists: z.boolean(),
  // The event's servings count, falling back to its guest count.
  servings: z.number().int().nullable(),
  // Food leaves the kitchen, and the crew's arrival at the venue (FLOW-140).
  leavesKitchenAt: timestamp.nullable(),
  leavesKitchenTime: time.nullable(),
  venueArrivalAt: timestamp.nullable(),
  courses: z.array(z.object({ course: z.string(), lines: z.array(kitchenLineSchema) })),
  // Kitchen tasks on this event, newest first.
  tasks: z.array(kitchenTaskSchema),
  generatedAt: timestamp.nullable(),
  canEdit: z.boolean(),
  // The Kitchen Lead and managers hand out prep tasks.
  canAssign: z.boolean(),
});
export type KitchenMenu = z.infer<typeof kitchenMenuSchema>;

export type KitchenLineValue = {
  recipeId: string;
  name: string;
  course: string;
  plannedQuantity: number | null;
  notes: string;
};
export const sameKitchenValue = (a: KitchenLineValue, b: KitchenLineValue) =>
  a.recipeId === b.recipeId &&
  a.course === b.course &&
  a.plannedQuantity === b.plannedQuantity &&
  a.notes === b.notes;
export const kitchenValueLabel = (value: KitchenLineValue) => value.name;
export const kitchenValueSummary = (value: KitchenLineValue) =>
  `${value.plannedQuantity === null ? "TBD" : value.plannedQuantity} × ${value.name} (${value.course})`;
