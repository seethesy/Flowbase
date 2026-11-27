// Tasks, task lists, templates and SOPs.
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { proposalLineKinds } from "../../../shared/proposal-mapping";
import { taskPriorities, taskStatuses, taskTypes, type TaskFilter } from "../../../shared/tasks";
import { type JSONContent } from "@tiptap/core";
import { baseColumns, oneOf, timestamptz } from "../conventions";

// Task engine (FLOW-58): the one task table every module writes through the task
// service (worker/records/tasks/tasks.ts). created_by is the creator; completed_by and
// completed_at say who marked it done and when. User, event, client and item ids
// have no foreign keys, like created_by: the DB suite truncates those tables
// without CASCADE, and the service checks the ids instead.
// Versioned standard operating procedures (FLOW-139). Current content is on
// the SOP; each saved version is immutable in sop_versions.
export const sops = pgTable(
  "sops",
  {
    ...baseColumns(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    content: jsonb("content").$type<JSONContent>().notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("sops_category_title_idx").on(table.category, table.title)],
).enableRLS();
export const sopVersions = pgTable(
  "sop_versions",
  {
    ...baseColumns(),
    sopId: uuid("sop_id").notNull().references(() => sops.id),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    content: jsonb("content").$type<JSONContent>().notNull(),
  },
  (table) => [uniqueIndex("sop_versions_sop_version_idx").on(table.sopId, table.version)],
).enableRLS();
export const tasks = pgTable(
  "tasks",
  {
    ...baseColumns(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    type: text("type", { enum: taskTypes }).notNull().default("general"),
    status: text("status", { enum: taskStatuses }).notNull().default("todo"),
    priority: text("priority", { enum: taskPriorities })
      .notNull()
      .default("normal"),
    dueAt: timestamptz("due_at"),
    eventId: uuid("event_id"),
    clientId: uuid("client_id"),
    inventoryItemId: uuid("inventory_item_id"),
    // No BEO table yet; the id is stored as given.
    beoId: uuid("beo_id"),
    sopId: uuid("sop_id").references(() => sops.id),
    completedAt: timestamptz("completed_at"),
    completedBy: uuid("completed_by"),
    // The staff position expected to do it (FLOW-62).
    position: text("position"),
    // The template item it came from (FLOW-62). One task per item and event, even
    // archived, so re-applying a template never brings back a task someone removed.
    templateItemId: uuid("template_item_id"),
  },
  (table) => [
    index("tasks_status_due_idx").on(table.status, table.dueAt),
    uniqueIndex("tasks_event_template_item_idx")
      .on(table.eventId, table.templateItemId)
      .where(sql`${table.templateItemId} is not null`),
    index("tasks_event_idx").on(table.eventId),
    index("tasks_created_by_idx").on(table.createdBy),
    oneOf("tasks_type_check", table.type, taskTypes),
    oneOf("tasks_status_check", table.status, taskStatuses),
    oneOf("tasks_priority_check", table.priority, taskPriorities),
  ],
).enableRLS();
// A task's assignees. Removing someone archives their row.
export const taskAssignees = pgTable(
  "task_assignees",
  {
    ...baseColumns(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    userId: uuid("user_id").notNull(),
  },
  (table) => [
    uniqueIndex("task_assignees_task_user_idx")
      .on(table.taskId, table.userId)
      .where(sql`${table.archivedAt} is null`),
    index("task_assignees_user_idx").on(table.userId),
  ],
).enableRLS();
// Managers are stored per task so later role changes do not rewrite history.
export const taskManagers = pgTable(
  "task_managers",
  {
    ...baseColumns(),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    userId: uuid("user_id").notNull(),
  },
  (table) => [
    uniqueIndex("task_managers_task_user_idx")
      .on(table.taskId, table.userId)
      .where(sql`${table.archivedAt} is null`),
    index("task_managers_user_idx").on(table.userId),
  ],
).enableRLS();
export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    ...baseColumns(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    doneAt: timestamptz("done_at"),
    doneBy: uuid("done_by"),
  },
  (table) => [index("task_checklist_items_task_idx").on(table.taskId)],
).enableRLS();
// Comments on a task; created_by is the author.
export const taskComments = pgTable(
  "task_comments",
  {
    ...baseColumns(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    body: text("body").notNull(),
  },
  (table) => [index("task_comments_task_idx").on(table.taskId, table.createdAt)],
).enableRLS();
// Saved task views (FLOW-59 AC3): one person's named set of task-list filters.
export const taskViews = pgTable(
  "task_views",
  {
    ...baseColumns(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    filter: jsonb("filter").$type<TaskFilter>().notNull().default({}),
  },
  (table) => [
    index("task_views_user_idx").on(table.userId, table.createdAt),
  ],
).enableRLS();
// Task templates (FLOW-62): reusable sets of tasks with due dates relative to an
// event (shared/tasks.ts templateDueAt). Removing an item archives it, so tasks
// already made from it stay matched to it.
export const taskTemplates = pgTable(
  "task_templates",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    sopUrl: text("sop_url"),
    sopId: uuid("sop_id").references(() => sops.id),
    matchCatalogId: uuid("match_catalog_id"),
    matchLineKind: text("match_line_kind", { enum: proposalLineKinds }),
    matchEventType: text("match_event_type"),
  },
  (table) => [
    uniqueIndex("task_templates_name_idx")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`),
    oneOf("task_templates_match_line_kind_check", table.matchLineKind, proposalLineKinds),
  ],
).enableRLS();
export const taskTemplateItems = pgTable(
  "task_template_items",
  {
    ...baseColumns(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => taskTemplates.id),
    title: text("title").notNull(),
    type: text("type", { enum: taskTypes }).notNull().default("production"),
    offsetDays: integer("offset_days").notNull(),
    // "HH:MM" in business time; null = the event's start time.
    time: text("time"),
    position: text("position"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("task_template_items_template_idx").on(table.templateId),
    oneOf("task_template_items_type_check", table.type, taskTypes),
  ],
).enableRLS();
