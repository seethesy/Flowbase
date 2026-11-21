import { taskPriorityLabels, taskStatusLabels, taskTypeLabels } from "../tasks";
import { type SourceDef } from "./types";

export const taskFields: SourceDef = {
  key: "tasks",
  label: "Tasks",
  readAction: "tasks.read",
  listPath: "/api/tasks",
  detailPath: (id) => `/api/tasks/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/tasks/${row.id}` : null),
  titleField: "title",
  fields: [
    { key: "title", label: "Task", type: "text", required: true, sortable: true, filterable: true },
    {
      key: "status",
      label: "Status",
      type: "status",
      options: { labels: taskStatusLabels, copyId: "labels.task-status" },
      sortable: true,
      filterable: true,
    },
    {
      key: "type",
      label: "Type",
      type: "status",
      options: { labels: taskTypeLabels, copyId: "labels.task-type" },
      sortable: true,
      filterable: true,
    },
    {
      key: "priority",
      label: "Priority",
      type: "status",
      options: { labels: taskPriorityLabels, copyId: "labels.task-priority" },
      sortable: true,
      filterable: true,
    },
    { key: "dueAt", label: "Due", type: "datetime", sortable: true, filterable: true },
    { key: "assignees", label: "Assignees", type: "person", filterable: true },
    { key: "overseer", label: "Overseer", type: "person", sortable: true, filterable: true },
    { key: "creator", label: "Created by", type: "person", sortable: true, filterable: true },
    {
      key: "eventTitle",
      label: "Event",
      type: "link",
      href: (row) => (typeof row.eventId === "string" ? `/events/${row.eventId}` : null),
      sortable: true,
      filterable: true,
    },
    { key: "position", label: "Position", type: "text", sortable: true, filterable: true },
    { key: "checklistDone", label: "Checklist done", type: "number", sortable: true },
    { key: "checklistTotal", label: "Checklist items", type: "number", sortable: true },
    { key: "completedAt", label: "Completed", type: "datetime", sortable: true, filterable: true },
    { key: "completedBy", label: "Completed by", type: "person", filterable: true },
    { key: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true },
  ],
};


