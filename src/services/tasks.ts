import { z } from "zod";
import {
  applyTemplateResultSchema,
  taskDashboardSchema,
  taskSchema,
  taskSummarySchema,
  taskTemplateSchema,
  taskViewSchema,
  type ChecklistItemUpdate,
  type TaskFilter,
  type TaskInput,
  type TaskTemplateInput,
  type TaskUpdate,
  type TaskViewInput,
} from "../../shared/tasks";
import { request, requestPage } from "./core";

// Tasks (FLOW-58). Every write answers with the whole task. The dashboard
// (FLOW-61), saved views (FLOW-59) and templates (FLOW-62) live under it too.
const base = "/api/tasks";
const task = (id: string, action = "") =>
  `${base}/${encodeURIComponent(id)}${action && `/${action}`}`;
const template = (id: string, action = "") =>
  `${base}/templates/${encodeURIComponent(id)}${action && `/${action}`}`;
export const tasksApi = {
  list: (filter: TaskFilter = {}, cursor?: string) => {
    const query = new URLSearchParams(
      Object.entries({ ...filter, ...(cursor ? { cursor } : {}) }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ).toString();
    return requestPage(taskSummarySchema, query ? `${base}?${query}` : base);
  },
  dashboard: () => request(taskDashboardSchema, `${base}/dashboard`),
  get: (id: string) => request(taskSchema, task(id)),
  create: (input: TaskInput) => request(taskSchema, base, "POST", input),
  update: (id: string, input: TaskUpdate) =>
    request(taskSchema, task(id), "PATCH", input),
  claim: (id: string) => request(taskSchema, task(id, "claim"), "POST", {}),
  addChecklistItem: (id: string, label: string) =>
    request(taskSchema, task(id, "checklist"), "POST", { label }),
  updateChecklistItem: (id: string, itemId: string, input: ChecklistItemUpdate) =>
    request(
      taskSchema,
      task(id, `checklist/${encodeURIComponent(itemId)}`),
      "PATCH",
      input,
    ),
  addComment: (id: string, body: string) =>
    request(taskSchema, task(id, "comments"), "POST", { body }),
  views: () => request(taskViewSchema.array(), `${base}/views`),
  saveView: (input: TaskViewInput) =>
    request(taskViewSchema, `${base}/views`, "POST", input),
  deleteView: (id: string) =>
    request(
      z.null(),
      `${base}/views/${encodeURIComponent(id)}/archive`,
      "POST",
      {},
    ),
  templates: () => request(taskTemplateSchema.array(), `${base}/templates`),
  createTemplate: (input: TaskTemplateInput) =>
    request(taskTemplateSchema, `${base}/templates`, "POST", input),
  updateTemplate: (id: string, input: TaskTemplateInput) =>
    request(taskTemplateSchema, template(id), "PUT", input),
  archiveTemplate: (id: string) =>
    request(z.null(), template(id, "archive"), "POST", {}),
  applyTemplate: (id: string, eventId: string) =>
    request(applyTemplateResultSchema, template(id, "apply"), "POST", { eventId }),
};
