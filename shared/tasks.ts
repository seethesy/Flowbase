import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";
import { addLocalDays, businessTimeToUtc, isBusinessTime, utcToBusinessTime } from "./time";

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
  // The staff position expected to do it (FLOW-62 template default), e.g. "Server".
  position: text(100).nullable().default(null),
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
    position: text(100).nullable(),
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

// When a task is due, in business time (FLOW-59 filter, FLOW-61 dashboard):
// overdue = past its due time; today = later today; upcoming = after today, or no
// due date at all.
export const taskDueBuckets = ["overdue", "today", "upcoming"] as const;
export const taskDueBucketSchema = z.enum(taskDueBuckets);
export type TaskDueBucket = z.infer<typeof taskDueBucketSchema>;
export const taskDueBucketLabels: Record<TaskDueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  upcoming: "Upcoming",
};

// The instants that bound the buckets: now, and the start of tomorrow in New York.
export function dueBounds(now: Date) {
  const today = utcToBusinessTime(now).date;
  return { now, tomorrow: businessTimeToUtc(addLocalDays(today, 1), "00:00") };
}
export function dueBucket(dueAt: string | null, now: Date): TaskDueBucket {
  if (dueAt === null) return "upcoming";
  const due = Date.parse(dueAt);
  const { tomorrow } = dueBounds(now);
  if (due < now.getTime()) return "overdue";
  return due < tomorrow.getTime() ? "today" : "upcoming";
}

// GET /api/tasks filters. Every given filter applies. Without mine=true this is
// the communal list (FLOW-59), which part-time staff can't open (403).
export const taskFilterSchema = z.object({
  type: taskTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  assigneeId: id.optional(),
  overseerId: id.optional(),
  eventId: id.optional(),
  due: taskDueBucketSchema.optional(),
  // Tasks with nobody assigned.
  unassigned: z.enum(["true"]).optional(),
  // Tasks this user is assigned to, oversees or created.
  mine: z.enum(["true"]).optional(),
  // Done tasks are left out unless status=done or includeDone=true.
  includeDone: z.enum(["true"]).optional(),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

// Saved views (FLOW-59 AC3): a name and a set of filters, kept per user.
export const taskViewFilterSchema = taskFilterSchema.strict();
export const taskViewInputSchema = z.object({
  name: text(80).min(1, "Name the view."),
  filter: taskViewFilterSchema,
});
export type TaskViewInput = z.infer<typeof taskViewInputSchema>;
export const taskViewSchema = taskViewInputSchema.extend({
  id,
  createdAt: timestamp,
});
export type TaskView = z.infer<typeof taskViewSchema>;
export const MAX_TASK_VIEWS = 30;

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
  position: z.string().nullable(),
  // The template item it was created from (FLOW-62), if any.
  templateItemId: id.nullable(),
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

// Task dashboard (FLOW-61): each section's count is the number of tasks matching
// it, and its tasks are the first DASHBOARD_SECTION_SIZE of them, soonest due first.
export const DASHBOARD_SECTION_SIZE = 50;
// "Needs delegation" covers events starting in the next 14 days (AC1).
export const NEEDS_DELEGATION_DAYS = 14;
const dashboardSection = z.object({
  count: z.number().int().min(0),
  tasks: z.array(taskSummarySchema),
});
export type TaskDashboardSection = z.infer<typeof dashboardSection>;
export const taskDashboardSchema = z.object({
  overdue: dashboardSection,
  today: dashboardSection,
  upcoming: dashboardSection,
  overseeing: dashboardSection,
  // Null for people who don't delegate from the dashboard (mayTriageTasks).
  needsDelegation: dashboardSection.nullable(),
});
export type TaskDashboard = z.infer<typeof taskDashboardSchema>;

// Task templates (FLOW-62): reusable sets of tasks with due dates relative to the
// event. An item is due offsetDays from the event's date (negative = before), at
// its own time of day, or at the event's start time when it has none. "T-14 days"
// is offsetDays -14 with no time; "day before 4:00 PM" is -1 at 16:00.
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 16:00.");
const httpUrl = z
  .string()
  .max(2000)
  .url("Enter a full web address.")
  .refine((value) => /^https?:\/\//i.test(value), "Use an http or https link.");
export const taskTemplateItemInputSchema = z.object({
  // Kept on update so already-applied tasks stay matched to their item.
  id: id.optional(),
  title: text(200).min(1, "Enter a task title."),
  type: taskTypeSchema.default("production"),
  offsetDays: z.number().int().min(-365).max(365),
  time: timeOfDay.nullable().default(null),
  position: text(100).nullable().default(null),
});
export type TaskTemplateItemInput = z.input<typeof taskTemplateItemInputSchema>;
export const taskTemplateInputSchema = z.object({
  name: text(120).min(1, "Name the template."),
  sopUrl: httpUrl.nullable().default(null),
  items: z
    .array(taskTemplateItemInputSchema)
    .min(1, "Add at least one task.")
    .max(100),
});
export type TaskTemplateInput = z.input<typeof taskTemplateInputSchema>;
export const taskTemplateItemSchema = z.object({
  id,
  title: z.string(),
  type: taskTypeSchema,
  offsetDays: z.number().int(),
  time: z.string().nullable(),
  position: z.string().nullable(),
});
export type TaskTemplateItem = z.infer<typeof taskTemplateItemSchema>;
export const taskTemplateSchema = z.object({
  id,
  name: z.string(),
  sopUrl: z.string().nullable(),
  items: z.array(taskTemplateItemSchema),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type TaskTemplate = z.infer<typeof taskTemplateSchema>;
export const applyTemplateInputSchema = z.object({ eventId: id });
export const applyTemplateResultSchema = z.object({
  created: z.array(taskSummarySchema),
  // Items that already had a task on this event (AC2).
  skipped: z.number().int().min(0),
});
export type ApplyTemplateResult = z.infer<typeof applyTemplateResultSchema>;

// "T-14 days", "Day before 4:00 PM", "Event day", "2 days after 9:00 AM".
export function offsetLabel(item: { offsetDays: number; time: string | null }) {
  const days = Math.abs(item.offsetDays);
  const day =
    item.offsetDays === 0
      ? "Event day"
      : item.offsetDays === -1
        ? "Day before"
        : item.offsetDays === 1
          ? "Day after"
          : item.offsetDays < 0
            ? `T-${days} days`
            : `T+${days} days`;
  if (!item.time) return day;
  const [hour, minute] = item.time.split(":").map(Number);
  const clock = `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  return `${day} ${clock}`;
}

// When an item is due for an event starting at eventStartsAt (AC1). A time that
// doesn't happen on that date (clocks spring forward) moves to the next hour.
export function templateDueAt(
  eventStartsAt: Date,
  item: { offsetDays: number; time: string | null },
): Date {
  const start = utcToBusinessTime(eventStartsAt);
  const date = addLocalDays(start.date, item.offsetDays);
  const time = item.time ?? start.time;
  if (isBusinessTime(date, time)) return businessTimeToUtc(date, time);
  const [hour, minute] = time.split(":").map(Number);
  return businessTimeToUtc(
    date,
    `${String(hour + 1).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  );
}
