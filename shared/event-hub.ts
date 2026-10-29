import { z } from "zod";
import { clientSchema, eventSchema } from "./core-records";

// The event hub (FLOW-57): one route per event that gathers everything about it.
// Sections are listed in display order. A section appears only once its module
// exists and the viewer may see it; each module ticket adds its own.
export const hubSectionSchema = z.enum([
  "details",
  "client",
  "proposal",
  "booking",
  "beo",
  "pull_list",
  // Equipment holds, conflicts and consumable needs (FLOW-76/77/85).
  "inventory",
  "tasks",
  "timeline",
  "staff",
  "trucks",
  "files",
  "history",
]);
export type HubSection = z.infer<typeof hubSectionSchema>;

export const eventHubSchema = z.object({
  event: eventSchema,
  // null when the viewer can't see the client record (the event still names it).
  client: clientSchema.nullable(),
  sections: z.array(hubSectionSchema),
  canEdit: z.boolean(),
  // Admin or the event's salesperson (FLOW-56).
  canChangeStatus: z.boolean(),
});
export type EventHub = z.infer<typeof eventHubSchema>;
