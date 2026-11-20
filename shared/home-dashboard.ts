import { z } from "zod";
import { roleSchema } from "./access";
import { pipelineStatusSchema } from "./pipeline";
import { taskSummarySchema } from "./tasks";

export const homeDashboardSchema = z.object({
  myLeads: z.object({ id: z.uuid(), client: z.string(), event: z.string(), date: z.string().nullable(), status: pipelineStatusSchema }).array().nullable(),
  upcomingEvents: z.object({ id: z.uuid(), date: z.iso.datetime(), event: z.string(), venue: z.string().nullable(), guests: z.number().nullable() }).array(),
  workingStaff: z.object({ id: z.uuid(), name: z.string(), position: z.string(), since: z.iso.datetime() }).array(),
  myTasks: taskSummarySchema.array(),
  allTasks: z.object({ task: taskSummarySchema, assigneeRoles: roleSchema.array() }).array().nullable(),
  roles: roleSchema.array(),
  hideCompletedTasksAfterDays: z.number().int(),
});
export type HomeDashboard = z.infer<typeof homeDashboardSchema>;
