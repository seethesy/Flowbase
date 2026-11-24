import { Dropdown } from "../../components/ui/Dropdown";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";
import { taskStatuses, taskStatusLabels, taskStatusSchema, taskTypeLabels, type TaskDashboardSection, type TaskDueBucket, type TaskFilter, type TaskSummary } from "../../../shared/tasks";
import { taskScope } from "../../../shared/policy";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { Button, DataTable, DateTimeCell, instantParts, LoadingSkeleton, PageHeader, Section } from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { tasksApi } from "../../services/tasks";
import { dateTimeLabel } from "../inventory/inventory-labels";
import { T, LabelT } from "../../app/copy";
import { copySlug } from "../../../shared/copy";
import { NewTaskDrawer, names, useActiveStaff } from "./task-form";
import { TaskActions } from "./task-lists";
import "./tasks.css";

// The task dashboard at /tasks (FLOW-60): my tasks by when they're due, the tasks
// I oversee, and "Needs delegation" for managers.

// A link to the task list showing exactly the tasks a dashboard section counts.
const listLink = (filter: TaskFilter) =>
  `/tasks/all?${new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString()}`;

// A dashboard section's tasks as a table (FLOW-297): the shared data table, so
// an Admin in live edit picks and resizes its columns (one column set for every
// section), the status changes in place without opening the task, and a click
// anywhere else on the row opens it.
function DashboardTaskTable({
  tasks,
  actions,
  onChanged,
  onError,
}: {
  tasks: TaskSummary[];
  actions: (task: TaskSummary) => ReactNode;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const columns: ColumnDef<TaskSummary, unknown>[] = [
    {
      accessorKey: "title",
      header: "Task",
      cell: ({ row }) => <Link to={`/tasks/${row.original.id}`}>{row.original.title}</Link>,
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
      cell: ({ row }) => {
        const due = instantParts(row.original.dueAt);
        return due ? <DateTimeCell date={due.date} time={due.time} /> : <T id="task-lists.dashboard-table.no-due-date">No due date</T>;
      },
      meta: { csv: (task) => (task.dueAt ? dateTimeLabel(task.dueAt) : "") },
    },
    {
      id: "assignees",
      header: "Assignee",
      accessorFn: (task) => names(task.assignees),
      cell: ({ row }) => row.original.assignees.length
        ? names(row.original.assignees)
        : <T id="task-lists.dashboard-table.unassigned">Unassigned</T>,
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (task) => taskStatusLabels[task.status],
      cell: ({ row }) => <LabelT id="labels.task-status" value={row.original.status}>{taskStatusLabels[row.original.status]}</LabelT>,
      // Anyone who sees a task may change its status (as on All tasks).
      meta: {
        edit: "select",
        editValue: (task) => task.status,
        editOptions: taskStatuses.map((value) => ({ value, label: taskStatusLabels[value] })),
        onEdit: async (task, value) => {
          await tasksApi.update(task.id, { status: taskStatusSchema.parse(value) });
          onChanged();
        },
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
      cell: ({ row }) => <div className="task-line-actions">{actions(row.original)}</div>,
    },
  ];
  return (
    <DataTable
      copyKey="tasks.dashboard.table"
      data={tasks}
      columns={columns}
      onRow={(task) => navigate(`/tasks/${task.id}`)}
      label={<T id="task-lists.dashboard-table.tasks">tasks</T>}
      // FLOW-260 selection, with a bulk Done (tasks have no Delete).
      selection={{
        rowId: (task) => task.id,
        actions: (ids, clear) => (
          <Button
            variant="outline"
            onClick={async () => {
              onError("");
              try {
                await Promise.all(ids.map((id) => tasksApi.update(id, { status: "done" })));
                clear();
                onChanged();
              } catch (cause) {
                onError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <T id="task-lists.dashboard-table.mark-selected-done">Mark done</T>
          </Button>
        ),
      }}
    />
  );
}

function DashboardGroup({
  title,
  section,
  filter,
  empty,
  onChanged,
  onError,
  children,
}: {
  title: string;
  section: TaskDashboardSection;
  filter: TaskFilter;
  empty: ReactNode;
  onChanged: () => void;
  onError: (message: string) => void;
  children: (task: TaskSummary) => ReactNode;
}) {

  return (
    <div className="task-group" role="region" aria-label={title}>
      <div className="task-group-head">
        <h3>
          <T id={`task-lists.dashboard-group.${copySlug(title)}`} values={{ count: section.count }}>
            {`${title} ({count})`}
          </T>
        </h3>
        {section.count > 0 && <Link to={listLink(filter)}><T id="task-lists.dashboard-group.view-all">View all</T></Link>}
      </div>
      {section.tasks.length ? (
        <DashboardTaskTable tasks={section.tasks} actions={children} onChanged={onChanged} onError={onError} />
      ) : (
        <p className="task-empty">{empty}</p>
      )}
    </div>
  );
}

// Quick-assign for "Needs delegation": pick a person, then Assign.
function QuickAssign({
  task,
  staff,
  onChanged,
  onError,
}: {
  task: TaskSummary;
  staff: { id: string; name: string }[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { actor } = usePermissions();
  const [person, setPerson] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="task-quick-assign"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!person || !actor) return;
        setBusy(true);
        onError("");
        try {
          await tasksApi.update(task.id, {
            assigneeIds: [person],
            ...(task.overseer ? {} : { overseerId: actor.userId }),
          });
          onChanged();
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Dropdown
        aria-label={`Assign ${task.title} to`}
        value={person}
        onChange={(e) => setPerson(e.target.value)}
      >
        <option value="">Choose a person</option>
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Dropdown>
      <Button type="submit" variant="outline" disabled={busy || !person}>
        <T id="task-lists.quick-assign.assign">Assign</T>
      </Button>
    </form>
  );
}

// /tasks: each person's home for their own work and the work they oversee.
export function TaskDashboardPage() {
  const { actor, can } = usePermissions();
  const dashboard = useResource(["tasks", "dashboard"], () => tasksApi.dashboard());
  const staff = useActiveStaff();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  if (dashboard.error) return <LoadError message={dashboard.error} />;
  if (!dashboard.data || !actor) return <LoadingSkeleton />;
  const data = dashboard.data;
  const reload = () => dashboard.reload();
  const act = (task: TaskSummary) => (
    <TaskActions task={task} onChanged={reload} onError={setError} />
  );
  const mine = (due: TaskDueBucket): TaskFilter => ({
    mine: "true",
    assigneeId: actor.userId,
    due,
  });
  return (
    <>
      <PageHeader pageKey="tasks.dashboard" title={<T id="task-lists.task-dashboard-page.tasks">Tasks</T>} subtitle={<T id="task-lists.task-dashboard-page.your-tasks-and-the-ones">Your tasks and the ones you oversee.</T>}>
        <Button asChild variant="outline">
          <Link to="/tasks/all">
            {taskScope(actor) === "all" ? <T id="task-lists.task-dashboard-page.team-tasks">Team tasks</T> : <T id="task-lists.task-dashboard-page.all-tasks">All tasks</T>}
          </Link>
        </Button>
        {can("tasks.templates") && (
          <Button asChild variant="outline">
            <Link to="/tasks/templates"><T id="task-lists.task-dashboard-page.templates">Templates</T></Link>
          </Button>
        )}
        <Button onClick={() => setAdding(true)}><T id="task-lists.task-dashboard-page.new-task">New task</T></Button>
      </PageHeader>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <PageGrid pageKey="tasks.dashboard">
<Block id="my-tasks" name="My tasks" h={16}>
<Section title={<T id="task-lists.task-dashboard-page.my-tasks">My tasks</T>}>
        <DashboardGroup
          onChanged={reload}
          onError={setError}
          title="Overdue"
          section={data.overdue}
          filter={mine("overdue")}
          empty={<T id="task-lists.task-dashboard-page.nothing-overdue">Nothing overdue.</T>}
        >
          {act}
        </DashboardGroup>
        <DashboardGroup
          onChanged={reload}
          onError={setError}
          title="Due today"
          section={data.today}
          filter={mine("today")}
          empty={<T id="task-lists.task-dashboard-page.nothing-else-due-today">Nothing else due today.</T>}
        >
          {act}
        </DashboardGroup>
        <DashboardGroup
          onChanged={reload}
          onError={setError}
          title="Upcoming"
          section={data.upcoming}
          filter={mine("upcoming")}
          empty={<T id="task-lists.task-dashboard-page.nothing-coming-up">Nothing coming up.</T>}
        >
          {act}
        </DashboardGroup>
      </Section>
</Block>
      <Block id="overseeing" name="Overseeing" h={8}>
<Section title={<T id="task-lists.task-dashboard-page.overseeing">Overseeing</T>}>
        <DashboardGroup
          onChanged={reload}
          onError={setError}
          title="Tasks I oversee"
          section={data.overseeing}
          filter={{ mine: "true", overseerId: actor.userId }}
          empty={<T id="task-lists.task-dashboard-page.you-don-t-oversee-any">{"You don't oversee any open tasks."}</T>}
        >
          {() => null}
        </DashboardGroup>
      </Section>
</Block>
      {data.needsDelegation && (
        <Block id="needs-delegation" name="Needs delegation" h={8}>
        <Section title={<T id="task-lists.task-dashboard-page.needs-delegation">Needs delegation</T>}>
          <DashboardGroup
          onChanged={reload}
          onError={setError}
            title="Unassigned in the next 14 days"
            section={data.needsDelegation}
            filter={{ unassigned: "true" }}
            empty={<T id="task-lists.task-dashboard-page.every-task-coming-up-has">Every task coming up has someone on it.</T>}
          >
            {(task) => (
              <QuickAssign task={task} staff={staff} onChanged={reload} onError={setError} />
            )}
          </DashboardGroup>
        </Section>
        </Block>
      )}
</PageGrid>
      {adding && (
        <NewTaskDrawer open onClose={() => setAdding(false)} onCreated={reload} />
      )}
    </>
  );
}
