import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";
import {
  claimButton,
  taskPriorities,
  taskPriorityLabels,
  taskPrioritySchema,
  taskRowState,
  taskStatuses,
  taskStatusLabels,
  taskStatusSchema,
  taskTypeLabels,
  type Task,
  type TaskSummary,
} from "../../../shared/tasks";
import { mayManageTask } from "../../../shared/policy";
import { businessTimeToUtc, isBusinessTime, utcToBusinessTime } from "../../../shared/time";
import type { StaffMember } from "../../../shared/staff";
import { usePermissions } from "../../app/permissions";
import { LabelT, T } from "../../app/copy";
import { Button, DataTable, useTableRemove } from "../../components/shared";
import { RoundCheck } from "../../components/ui/round-check";
import { peopleOptions } from "../../components/ui/people-picker";
import { tasksApi } from "../../services/tasks";
import { dateTimeLabel } from "../inventory/inventory-labels";
import { names } from "./task-form";
import "./tasks.css";

// The task tables (FLOW-345): the Tasks subtab's four cards and All tasks. Like
// the app's other tables: a check circle first that marks the task done (and
// un-done), row colors for overdue, due today and done, fields edited in place
// (FLOW-261), Pick up / Drop, and Delete with Undo (FLOW-260). The API checks the
// same rules: status for anyone who sees the task, the rest for whoever manages
// it (mayManageTask).

const mayManage = (actor: ReturnType<typeof usePermissions>["actor"], task: TaskSummary) =>
  !!actor && mayManageTask(actor, { createdBy: task.creator?.id ?? null, managerIds: task.managers.map((person) => person.id) });

// New York wall-clock "YYYY-MM-DDTHH:MM" for the Due cell's editor.
const localDue = (dueAt: string | null) => {
  if (!dueAt) return "";
  const { date, time } = utcToBusinessTime(new Date(dueAt));
  return `${date}T${time}`;
};

// Pick up, or Drop for an assignee (claimButton). Colored, on tables and the task
// page alike (FLOW-346).
export function ClaimButton({ task, onDone, onError, busy = false }: {
  task: Pick<Task, "id" | "title" | "status" | "assignees">;
  onDone: (task: Task) => void;
  onError: (message: string) => void;
  busy?: boolean;
}) {
  const { actor, can } = usePermissions();
  const [running, setRunning] = useState(false);
  const kind = claimButton(task, actor?.userId ?? null, can("tasks.write"));
  if (!kind) return null;
  const run = async () => {
    setRunning(true);
    onError("");
    try {
      onDone(kind === "drop" ? await tasksApi.drop(task.id) : await tasksApi.claim(task.id));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };
  return kind === "drop"
    ? <Button className="task-drop" disabled={busy || running} aria-label={`Drop ${task.title}`} onClick={() => void run()}>
      <T id="task-lists.task-actions.drop">Drop</T></Button>
    : <Button className="task-pick-up" disabled={busy || running} aria-label={`Pick up ${task.title}`} onClick={() => void run()}>
      <T id="task-lists.task-actions.pick-up">Pick up</T></Button>;
}

// The title, linking to the task, with Edit for whoever manages it (FLOW-275).
function TitleCell({ task, editable, save }: { task: TaskSummary; editable: boolean; save: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [error, setError] = useState("");
  const finish = async (commit: boolean) => {
    setEditing(false);
    const title = draft.trim();
    if (!commit || !title || title === task.title) { setDraft(task.title); return; }
    setError("");
    try { await save(title); } catch (cause) { setDraft(task.title); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  if (editing)
    return <input className="table-edit-input" aria-label={`Edit ${task.title}`} autoFocus value={draft} maxLength={300}
      onChange={(event) => setDraft(event.target.value)} onBlur={() => void finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") void finish(false);
      }} />;
  return <span className="task-title-cell">
    <Link className="task-title" to={`/tasks/${task.id}`}>{task.title}</Link>
    {editable && <button type="button" className="task-inline-edit" aria-label={`Rename ${task.title}`}
      onClick={() => { setDraft(task.title); setEditing(true); }}><T id="task-lists.task-line.edit">Edit</T></button>}
    {error && <span className="table-edit-error" role="alert">{error}</span>}
  </span>;
}

// A row's Delete: the table's own delete, so Undo and Ctrl/Cmd+Z work as on other tables.
function DeleteButton({ task }: { task: TaskSummary }) {
  const remove = useTableRemove();
  if (!remove) return null;
  return <Button variant="ghost" className="task-delete" aria-label={`Delete ${task.title}`} onClick={() => void remove([task.id])}>
    <T id="task-lists.task-actions.delete">Delete</T>
  </Button>;
}

export function TaskTable({
  tasks,
  staff,
  copyKey,
  onChanged,
  onError,
  actions,
  now = new Date(),
}: {
  tasks: TaskSummary[];
  // Active staff, for the assignee (anyone, with or without an account) and
  // manager (Admin accounts) choices.
  staff: Pick<StaffMember, "id" | "name" | "active" | "hasAccount" | "role">[];
  copyKey: string;
  onChanged: () => void;
  onError: (message: string) => void;
  // More per-row controls, e.g. Needs delegation's quick assign.
  actions?: (task: TaskSummary) => ReactNode;
  now?: Date;
}) {
  const navigate = useNavigate();
  const { actor } = usePermissions();
  const patch = async (task: TaskSummary, change: Parameters<typeof tasksApi.update>[1]) => {
    await tasksApi.update(task.id, change);
    onChanged();
  };
  // The people a cell may pick, plus whoever is on the task already.
  const choices = (kind: "assignees" | "managers", current: { id: string; name: string }[]) => [
    ...peopleOptions(staff, kind).map((person) => ({ value: person.id, label: person.name })),
    ...current.filter((person) => !peopleOptions(staff, kind).some((member) => member.id === person.id))
      .map((person) => ({ value: person.id, label: person.name })),
  ];
  const columns: ColumnDef<TaskSummary, unknown>[] = [
    {
      id: "done",
      header: "",
      enableSorting: false,
      meta: { exportable: false },
      cell: ({ row }) => (
        <RoundCheck
          checked={row.original.status === "done"}
          aria-label={`Done: ${row.original.title}`}
          onChange={(event) => {
            onError("");
            patch(row.original, { status: event.target.checked ? "done" : "todo" })
              .catch((cause: unknown) => onError(cause instanceof Error ? cause.message : String(cause)));
          }}
        />
      ),
    },
    {
      accessorKey: "title",
      header: "Task",
      // The title stays a link to the task; a manager renames it with Edit.
      cell: ({ row }) => <TitleCell task={row.original} editable={mayManage(actor, row.original)}
        save={(title) => patch(row.original, { title })} />,
      meta: { opensRecord: true },
    },
    {
      id: "eventTitle",
      header: "Event",
      accessorFn: (task) => task.eventTitle ?? "",
      cell: ({ row }) => row.original.eventId && row.original.eventTitle
        ? <Link to={`/events/${row.original.eventId}`}>{row.original.eventTitle}</Link>
        : "—",
    },
    {
      id: "dueAt",
      header: "Due",
      // An ISO instant sorts by date and time together (FLOW-296).
      accessorFn: (task) => task.dueAt ?? "",
      cell: ({ row }) => row.original.dueAt ? dateTimeLabel(row.original.dueAt)
        : <T id="task-lists.dashboard-table.no-due-date">No due date</T>,
      meta: {
        csv: (task) => (task.dueAt ? dateTimeLabel(task.dueAt) : ""),
        edit: "datetime",
        canEdit: (task) => mayManage(actor, task),
        editValue: (task) => localDue(task.dueAt),
        onEdit: (task, value) => {
          if (!value) return patch(task, { dueAt: null });
          // A date alone keeps the task's time of day (5 PM when it had none).
          const [date, time = localDue(task.dueAt).split("T")[1] || "17:00"] = value.split("T");
          if (!isBusinessTime(date, time))
            return Promise.reject(new Error("Pick a due time that exists in New York time."));
          return patch(task, { dueAt: businessTimeToUtc(date, time).toISOString() });
        },
      },
    },
    {
      id: "priority",
      header: "Priority",
      accessorFn: (task) => taskPriorityLabels[task.priority],
      cell: ({ row }) => <LabelT id="labels.task-priority" value={row.original.priority}>{taskPriorityLabels[row.original.priority]}</LabelT>,
      meta: {
        edit: "select",
        canEdit: (task) => mayManage(actor, task),
        editValue: (task) => task.priority,
        editOptions: taskPriorities.map((value) => ({ value, label: taskPriorityLabels[value] })),
        onEdit: (task, value) => patch(task, { priority: taskPrioritySchema.parse(value) }),
      },
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (task) => taskStatusLabels[task.status],
      cell: ({ row }) => <LabelT id="labels.task-status" value={row.original.status}>{taskStatusLabels[row.original.status]}</LabelT>,
      // Anyone who sees a task may change its status.
      meta: {
        edit: "select",
        editValue: (task) => task.status,
        editOptions: taskStatuses.map((value) => ({ value, label: taskStatusLabels[value] })),
        onEdit: (task, value) => patch(task, { status: taskStatusSchema.parse(value) }),
      },
    },
    {
      id: "assignees",
      header: "Assignee",
      accessorFn: (task) => names(task.assignees),
      cell: ({ row }) => row.original.assignees.length
        ? names(row.original.assignees)
        : <T id="task-lists.dashboard-table.unassigned">Unassigned</T>,
      meta: {
        edit: "select",
        editMultiple: true,
        canEdit: (task) => mayManage(actor, task),
        editValue: (task) => task.assignees.map((person) => person.id).join(","),
        editOptions: (task) => choices("assignees", task.assignees),
        onEdit: (task, value) => patch(task, { assigneeIds: value.split(",").filter(Boolean) }),
      },
    },
    {
      id: "managers",
      header: "Managers",
      accessorFn: (task) => task.managers.map((person) => person.name).join(", "),
      meta: {
        edit: "select",
        editMultiple: true,
        canEdit: (task) => mayManage(actor, task),
        editValue: (task) => task.managers.map((person) => person.id).join(","),
        editOptions: (task) => choices("managers", task.managers),
        onEdit: (task, value) => patch(task, { managerIds: value.split(",").filter(Boolean) }),
      },
    },
    {
      id: "type",
      header: "Type",
      accessorFn: (task) => taskTypeLabels[task.type],
      cell: ({ row }) => <LabelT id="labels.task-type" value={row.original.type}>{taskTypeLabels[row.original.type]}</LabelT>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      meta: { exportable: false },
      cell: ({ row }) => (
        <div className="task-line-actions">
          <ClaimButton task={row.original} onDone={onChanged} onError={onError} />
          {actions?.(row.original)}
          {mayManage(actor, row.original) && <DeleteButton task={row.original} />}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      copyKey={copyKey}
      data={tasks}
      columns={columns}
      onRow={(task) => navigate(`/tasks/${task.id}`)}
      label={<T id="task-lists.dashboard-table.tasks">tasks</T>}
      rowClassName={(task) => {
        const state = taskRowState(task, now);
        return state ? `task-row--${state}` : undefined;
      }}
      selection={{
        rowId: (task) => task.id,
        // Archive (the creator or a manager, FLOW-344); restore undoes it. A
        // task this person may not delete is skipped with the reason.
        onDelete: async (ids) => {
          const deleted: string[] = [];
          const skipped: { id: string; name: string; reason: string }[] = [];
          for (const id of ids) {
            const task = tasks.find((entry) => entry.id === id);
            try {
              await tasksApi.setArchived(id, true);
              deleted.push(id);
            } catch (cause) {
              skipped.push({ id, name: task?.title ?? id, reason: cause instanceof Error ? cause.message : String(cause) });
            }
          }
          onChanged();
          return { deleted, skipped };
        },
        onRestore: async (ids) => {
          for (const id of ids) await tasksApi.setArchived(id, false);
          onChanged();
        },
      }}
    />
  );
}
