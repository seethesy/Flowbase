import { z } from "zod";
import { id } from "./schema-primitives";

export const productionItemTypes = ["task", "pull", "kitchen", "shortage", "staff", "truck", "readiness", "order", "setup"] as const;
export const productionItemSchema = z.object({
  id: z.string(), eventId: id, eventTitle: z.string(), type: z.enum(productionItemTypes),
  title: z.string(), due: z.string(), complete: z.boolean(), team: z.string(),
  assignedUserIds: z.array(id).default([]),
});
export type ProductionItem = z.infer<typeof productionItemSchema>;
export const productionListSchema = z.object({
  eventId: id, eventTitle: z.string(), eventDate: z.string(),
  items: z.array(productionItemSchema), complete: z.number().int(), total: z.number().int(),
  percent: z.number().int().min(0).max(100),
});
export type ProductionList = z.infer<typeof productionListSchema>;
export const productionOverviewSchema = z.object({
  days: z.array(z.object({ date: z.string(), items: z.array(productionItemSchema),
    trucksAssigned: z.number().int(), truckCapacity: z.number().int(), overcommitted: z.boolean(),
    truckConflict: z.boolean(), staffOvercommitted: z.boolean() })),
});
export type ProductionOverview = z.infer<typeof productionOverviewSchema>;

export function completion(items: ProductionItem[]) {
  const total = items.length;
  const complete = items.filter((item) => item.complete).length;
  return { total, complete, percent: total ? Math.round(100 * complete / total) : 100 };
}
