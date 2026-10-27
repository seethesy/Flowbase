import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";

// Task engine (FLOW-58): one task model that every module uses (design principle
// 3). Kitchen, production and truck-loading tasks are rows of the same table with
// their own type, so they appear in the same task lists. Other modules create and
// update tasks through the service in worker/records/tasks.ts, never through
// tables of their own.

export const taskTypes = [
  "general",
  "delegated",
  "kitchen",
  "production",
  "truck_load",
  "misc",
] as const;
export const taskTypeSchema = z.enum(taskTypes);
export type TaskType = z.infer<typeof taskTypeSchema>;
export const taskTypeLabels: Record<TaskType, string> = {
  general: "General",
  delegated: "Delegated",
  kitchen: "Kitchen",
  production: "Production",
  truck_load: "Truck loading",
  misc: "Misc",
};

export const taskStatuses = ["todo", "in_progress", "blocked", "done"] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const taskPriorities = ["low", "normal", "high", "urgent"] as const;
export const taskPrioritySchema = z.enum(taskPriorities);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

// What a task can link to. A BEO has no table yet, so its id is stored as given.
export const taskLinkKeys = [
  "eventId",
  "clientId",
  "inventoryItemId",
  "beoId",
] as const;
export type TaskLinkKey = (typeof taskLinkKeys)[number];

const uniqueIds = (max: number, message: string) =>
  z
    .array(id)
    .max(max)
    .refine((values) => new Set(values).size === values.length, message);

const checklistLabel = text(300).min(1, "Enter a checklist item.");

export const taskInputSchema = z.object({
  title: text(200).min(1, "Enter a title."),
  description: text(5000).default(""),
  type: taskTypeSchema.default("general"),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("normal"),
  dueAt: timestamp.nullable().default(null),
  assigneeIds: uniqueIds(20, "List each assignee once.").default([]),
  overseerId: id.nullable().default(null),
  eventId: id.nullable().default(null),
  clientId: id.nullable().default(null),
  inventoryItemId: id.nullable().default(null),
  beoId: id.nullable().default(null),
  checklist: z.array(checklistLabel).max(100).default([]),
});
export type TaskInput = z.input<typeof taskInputSchema>;

// PATCH /api/tasks/<id>: any subset. Checklist items have their own routes.
export const taskUpdateSchema = z
  .object({
    title: text(200).min(1, "Enter a title."),
    description: text(5000),
    type: taskTypeSchema,
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueAt: timestamp.nullable(),
    assigneeIds: uniqueIds(20, "List each assignee once."),
    overseerId: id.nullable(),
    eventId: id.nullable(),
    clientId: id.nullable(),
    inventoryItemId: id.nullable(),
    beoId: id.nullable(),
  })
  .partial()
  .strict();
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

export const checklistItemInputSchema = z.object({ label: checklistLabel });
export const checklistItemUpdateSchema = z
  .object({ label: checklistLabel, done: z.boolean() })
  .partial()
  .strict();
export type ChecklistItemUpdate = z.infer<typeof checklistItemUpdateSchema>;

export const taskCommentInputSchema = z.object({
  body: text(5000).min(1, "Write a comment."),
});

// GET /api/tasks filters. Every given filter applies.
export const taskFilterSchema = z.object({
  type: taskTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  assigneeId: id.optional(),
  eventId: id.optional(),
  // Tasks this user is assigned to, oversees or created.
  mine: z.enum(["true"]).optional(),
  // Done tasks are left out unless status=done or includeDone=true.
  includeDone: z.enum(["true"]).optional(),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

const person = z.object({ id, name: z.string() });
export type TaskPerson = z.infer<typeof person>;

export const checklistItemSchema = z.object({
  id,
  label: z.string(),
  done: z.boolean(),
  doneAt: timestamp.nullable(),
  doneBy: person.nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const taskCommentSchema = z.object({
  id,
  body: z.string(),
  author: person.nullable(),
  createdAt: timestamp,
});
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskSummarySchema = z.object({
  id,
  title: z.string(),
  type: taskTypeSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueAt: timestamp.nullable(),
  assignees: z.array(person),
  overseer: person.nullable(),
  creator: person.nullable(),
  eventId: id.nullable(),
  // Null when the event is gone or the viewer can't open it.
  eventTitle: z.string().nullable(),
  clientId: id.nullable(),
  inventoryItemId: id.nullable(),
  beoId: id.nullable(),
  checklistDone: z.number().int(),
  checklistTotal: z.number().int(),
  // Who marked the task done, and when (null until it is done).
  completedAt: timestamp.nullable(),
  completedBy: person.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskSchema = taskSummarySchema.extend({
  description: z.string(),
  checklist: z.array(checklistItemSchema),
  comments: z.array(taskCommentSchema),
  // May change the details, assignees and overseer (mayManageTask).
  canManage: z.boolean(),
});
export type Task = z.infer<typeof taskSchema>;

// Status rules: a task records who completed it and when as it moves to done,
// and forgets both when it is reopened. Any status may follow any other.
export function completion(
  before: { status: TaskStatus; completedAt: Date | null; completedBy: string | null },
  status: TaskStatus,
  by: string | null,
  now: Date,
): { completedAt: Date | null; completedBy: string | null } {
  if (status !== "done") return { completedAt: null, completedBy: null };
  if (before.status === "done")
    return { completedAt: before.completedAt, completedBy: before.completedBy };
  return { completedAt: now, completedBy: by };
}
