import {
  taskSchema,
  taskSummarySchema,
  type ChecklistItemUpdate,
  type TaskFilter,
  type TaskInput,
  type TaskUpdate,
} from "../../shared/tasks";
import { request, requestPage } from "./core";

// Tasks (FLOW-58). Every write answers with the whole task.
const base = "/api/tasks";
const task = (id: string, action = "") =>
  `${base}/${encodeURIComponent(id)}${action && `/${action}`}`;
export const tasksApi = {
  list: (filter: TaskFilter = {}, cursor?: string) => {
    const query = new URLSearchParams(
      Object.entries({ ...filter, ...(cursor ? { cursor } : {}) }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ).toString();
    return requestPage(taskSummarySchema, query ? `${base}?${query}` : base);
  },
  get: (id: string) => request(taskSchema, task(id)),
  create: (input: TaskInput) => request(taskSchema, base, "POST", input),
  update: (id: string, input: TaskUpdate) =>
    request(taskSchema, task(id), "PATCH", input),
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
};
