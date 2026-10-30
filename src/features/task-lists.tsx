import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  taskDueBucketLabels,
  taskDueBuckets,
  taskFilterSchema,
  taskPriorities,
  taskPriorityLabels,
  taskStatuses,
  taskStatusLabels,
  taskTypeLabels,
  taskTypes,
  type TaskDashboardSection,
  type TaskDueBucket,
  type TaskFilter,
  type TaskPriority,
  type TaskSummary,
  type TaskType,
} from "../../shared/tasks";
import type { FlowEvent } from "../../shared/core-records";
import { taskScope } from "../../shared/policy";
import { businessTimeToUtc, isBusinessTime } from "../../shared/time";
import { LoadMore, usePagedList } from "../app/paging";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  EmptyState,
  FilterBar,
  FormField,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { eventsApi } from "../services/core";
import { staffApi } from "../services/staff";
import { tasksApi } from "../services/tasks";
import { dateTimeLabel } from "./inventory-labels";
import "./tasks.css";

// Task lists (FLOW-59/60/61): the dashboard at /tasks (my tasks by when they're
// due, the tasks I oversee, and "Needs delegation" for managers), the communal
// list at /tasks/all with filters and saved views, the new-task form, and the
// event hub's Tasks section. The API enforces who sees what; these screens only
// hide what a person can't use.

const names = (people: { name: string }[]) =>
  people.map((person) => person.name).join(", ") || "Unassigned";

// Active staff, for assignee and overseer pickers.
function useActiveStaff() {
  const staff = useResource(["staff"], () => staffApi.list(), { reference: true });
  return (staff.data ?? []).filter((member) => member.active);
}

// Upcoming events, for the event filter and the new-task form.
function useUpcomingEvents() {
  const events = useResource(
    ["tasks", "event-options"],
    async () => (await eventsApi.list({})).rows,
    { reference: true },
  );
  return events.data ?? [];
}

function TaskLine({
  task,
  children,
}: {
  task: TaskSummary;
  children?: ReactNode;
}) {
  return (
    <li className="task-line">
      <div>
        <Link to={`/tasks/${task.id}`}>{task.title}</Link>
        <small>
          {[
            taskTypeLabels[task.type],
            taskStatusLabels[task.status],
            task.dueAt ? `Due ${dateTimeLabel(task.dueAt)}` : "No due date",
            names(task.assignees),
            task.position,
            task.eventTitle,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
      {children && <div className="task-line-actions">{children}</div>}
    </li>
  );
}

// Claim and complete, where they apply. onChanged reloads the list.
function TaskActions({
  task,
  onChanged,
  onError,
}: {
  task: TaskSummary;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { actor } = usePermissions();
  const [busy, setBusy] = useState(false);
  if (!actor || task.status === "done") return null;
  const run = async (change: () => Promise<unknown>) => {
    setBusy(true);
    onError("");
    try {
      await change();
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mine = task.assignees.some((person) => person.id === actor.userId);
  return (
    <>
      {!mine && (
        <Button
          variant="outline"
         
          disabled={busy}
          aria-label={`Claim ${task.title}`}
          onClick={() => void run(() => tasksApi.claim(task.id))}
        >
          Claim
        </Button>
      )}
      <Button
        variant="outline"
       
        disabled={busy}
        aria-label={`Complete ${task.title}`}
        onClick={() => void run(() => tasksApi.update(task.id, { status: "done" }))}
      >
        Done
      </Button>
    </>
  );
}

// The new-task form. Someone who may delegate assigns anyone and is the overseer
// by default when assigning others (FLOW-60); everyone else assigns themselves.
export function NewTaskDrawer({
  open,
  onClose,
  onCreated,
  eventId = null,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  eventId?: string | null;
}) {
  const { actor, can } = usePermissions();
  const staff = useActiveStaff();
  const events = useUpcomingEvents();
  const delegates = can("tasks.delegate");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>(delegates ? "delegated" : "general");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("17:00");
  const [event, setEvent] = useState(eventId ?? "");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [overseer, setOverseer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!actor) return null;
  const others = assignees.some((id) => id !== actor.userId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (dueDate && !isBusinessTime(dueDate, dueTime || "17:00")) {
      setError("That time doesn't exist on that date in New York. Pick another time.");
      return;
    }
    setBusy(true);
    try {
      await tasksApi.create({
        title,
        type,
        priority,
        dueAt: dueDate
          ? businessTimeToUtc(dueDate, dueTime || "17:00").toISOString()
          : null,
        eventId: event || null,
        assigneeIds: assignees,
        overseerId: overseer || (others ? actor.userId : null),
      });
      setTitle("");
      setAssignees([]);
      setOverseer("");
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title="New task"
      description="Add a task for yourself or the team."
    >
      <form className="task-form" onSubmit={submit}>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label="Title">
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {taskTypes.map((option) => (
              <option key={option} value={option}>
                {taskTypeLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Priority">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            {taskPriorities.map((option) => (
              <option key={option} value={option}>
                {taskPriorityLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
        <FormField label="Due time">
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </FormField>
        {!eventId && (
          <FormField label="Event">
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">No event</option>
              {events.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} ({option.date})
                </option>
              ))}
            </select>
          </FormField>
        )}
        {delegates ? (
          <>
            <FormField label="Assign to" hint="Hold Ctrl or ⌘ to pick several people.">
              <select
                multiple
                value={assignees}
                onChange={(e) =>
                  setAssignees(Array.from(e.target.selectedOptions, (option) => option.value))
                }
              >
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.id === actor.userId ? `${member.name} (me)` : member.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Overseer"
              hint="When you assign someone else, you oversee it unless you pick someone."
            >
              <select value={overseer} onChange={(e) => setOverseer(e.target.value)}>
                <option value="">{others ? "Me" : "No overseer"}</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </FormField>
          </>
        ) : (
          <label className="task-check">
            <input
              type="checkbox"
              checked={assignees.includes(actor.userId)}
              onChange={(e) => setAssignees(e.target.checked ? [actor.userId] : [])}
            />
            Assign to me
          </label>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            Add task
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

// A link to the task list showing exactly the tasks a dashboard section counts.
const listLink = (filter: TaskFilter) =>
  `/tasks/all?${new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString()}`;

function DashboardGroup({
  title,
  section,
  filter,
  empty,
  children,
}: {
  title: string;
  section: TaskDashboardSection;
  filter: TaskFilter;
  empty: string;
  children: (task: TaskSummary) => ReactNode;
}) {
  const label = `${title} (${section.count})`;
  return (
    <div className="task-group" role="region" aria-label={title}>
      <div className="task-group-head">
        <h3>{label}</h3>
        {section.count > 0 && <Link to={listLink(filter)}>View all</Link>}
      </div>
      {section.tasks.length ? (
        <ul className="task-lines">
          {section.tasks.map((task) => (
            <TaskLine key={task.id} task={task}>
              {children(task)}
            </TaskLine>
          ))}
        </ul>
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
      <select
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
      </select>
      <Button type="submit" variant="outline" disabled={busy || !person}>
        Assign
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
      <PageHeader title="Tasks" subtitle="Your tasks and the ones you oversee.">
        {taskScope(actor) === "all" && (
          <Button asChild variant="outline">
            <Link to="/tasks/all">Team tasks</Link>
          </Button>
        )}
        {can("tasks.templates") && (
          <Button asChild variant="outline">
            <Link to="/tasks/templates">Templates</Link>
          </Button>
        )}
        <Button onClick={() => setAdding(true)}>New task</Button>
      </PageHeader>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <Section title="My tasks">
        <DashboardGroup
          title="Overdue"
          section={data.overdue}
          filter={mine("overdue")}
          empty="Nothing overdue."
        >
          {act}
        </DashboardGroup>
        <DashboardGroup
          title="Due today"
          section={data.today}
          filter={mine("today")}
          empty="Nothing else due today."
        >
          {act}
        </DashboardGroup>
        <DashboardGroup
          title="Upcoming"
          section={data.upcoming}
          filter={mine("upcoming")}
          empty="Nothing coming up."
        >
          {act}
        </DashboardGroup>
      </Section>
      <Section title="Overseeing">
        <DashboardGroup
          title="Tasks I oversee"
          section={data.overseeing}
          filter={{ mine: "true", overseerId: actor.userId }}
          empty="You don't oversee any open tasks."
        >
          {() => null}
        </DashboardGroup>
      </Section>
      {data.needsDelegation && (
        <Section title="Needs delegation">
          <DashboardGroup
            title="Unassigned in the next 14 days"
            section={data.needsDelegation}
            filter={{ unassigned: "true" }}
            empty="Every task coming up has someone on it."
          >
            {(task) => (
              <QuickAssign task={task} staff={staff} onChanged={reload} onError={setError} />
            )}
          </DashboardGroup>
        </Section>
      )}
      {adding && (
        <NewTaskDrawer open onClose={() => setAdding(false)} onCreated={reload} />
      )}
    </>
  );
}

const filterKeys = [
  "type",
  "status",
  "assigneeId",
  "overseerId",
  "eventId",
  "due",
  "unassigned",
  "mine",
  "includeDone",
] as const;

// The filters in the URL, so dashboard links, the back button and saved views
// all show the same list. Unknown values are dropped.
function filterFrom(params: URLSearchParams): TaskFilter {
  const raw = Object.fromEntries(
    filterKeys.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  );
  const parsed = taskFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

// /tasks/all: the communal list (FLOW-59). Part-time staff only see their own
// tasks, so the list keeps mine=true for them.
export function TaskList() {
  const { actor } = usePermissions();
  const [params, setParams] = useSearchParams();
  const staff = useActiveStaff();
  const events = useUpcomingEvents();
  const views = useResource(["tasks", "views"], () => tasksApi.views());
  const [adding, setAdding] = useState(false);
  const [viewName, setViewName] = useState("");
  const [error, setError] = useState("");
  const communal = actor ? taskScope(actor) === "all" : false;
  const filter: TaskFilter = {
    ...filterFrom(params),
    ...(communal ? {} : { mine: "true" as const }),
  };
  const key = JSON.stringify(filter);
  const list = usePagedList(["tasks", "list", key], (cursor) =>
    tasksApi.list(filter, cursor),
  );
  const setFilter = (next: TaskFilter) => {
    const clean = Object.fromEntries(
      Object.entries(next).filter((entry): entry is [string, string] => !!entry[1]),
    );
    setParams(new URLSearchParams(clean), { replace: true });
  };
  // filterFrom checks the value when the URL is read back.
  const change = (field: keyof TaskFilter, value: string) =>
    setFilter({ ...filter, [field]: value || undefined } as TaskFilter);
  const matchingView = views.data?.find(
    (view) => JSON.stringify(view.filter) === JSON.stringify(filterFrom(params)),
  );
  const saveView = async (e: FormEvent) => {
    e.preventDefault();
    if (!viewName.trim()) return;
    setError("");
    try {
      await tasksApi.saveView({ name: viewName.trim(), filter: filterFrom(params) });
      setViewName("");
      views.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <>
      <Link className="back-link" to="/tasks">
        ← Tasks
      </Link>
      <PageHeader
        title={communal ? "Team tasks" : "My tasks"}
        subtitle={
          communal
            ? "Every open task on the team. Claim one to take it on."
            : "The tasks you're assigned to, oversee or created."
        }
      >
        <Button onClick={() => setAdding(true)}>New task</Button>
      </PageHeader>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <FilterBar>
        <select
          aria-label="Saved view"
          value={matchingView?.id ?? ""}
          onChange={(e) => {
            const view = views.data?.find((option) => option.id === e.target.value);
            setFilter(view ? view.filter : {});
          }}
        >
          <option value="">{matchingView ? "All tasks" : "Saved views"}</option>
          {views.data?.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        {communal && (
          <select
            aria-label="Whose tasks"
            value={filter.mine ?? ""}
            onChange={(e) => change("mine", e.target.value)}
          >
            <option value="">Everyone's</option>
            <option value="true">Mine</option>
          </select>
        )}
        <select
          aria-label="Type"
          value={filter.type ?? ""}
          onChange={(e) => change("type", e.target.value)}
        >
          <option value="">All types</option>
          {taskTypes.map((option) => (
            <option key={option} value={option}>
              {taskTypeLabels[option]}
            </option>
          ))}
        </select>
        <select
          aria-label="Assignee"
          value={filter.unassigned ? "none" : (filter.assigneeId ?? "")}
          onChange={(e) =>
            setFilter({
              ...filter,
              assigneeId: e.target.value && e.target.value !== "none" ? e.target.value : undefined,
              unassigned: e.target.value === "none" ? "true" : undefined,
            })
          }
        >
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Event"
          value={filter.eventId ?? ""}
          onChange={(e) => change("eventId", e.target.value)}
        >
          <option value="">Any event</option>
          {events.map((option: FlowEvent) => (
            <option key={option.id} value={option.id}>
              {option.title} ({option.date})
            </option>
          ))}
        </select>
        <select
          aria-label="Due"
          value={filter.due ?? ""}
          onChange={(e) => change("due", e.target.value)}
        >
          <option value="">Any due date</option>
          {taskDueBuckets.map((option) => (
            <option key={option} value={option}>
              {taskDueBucketLabels[option]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={filter.status ?? (filter.includeDone ? "any" : "")}
          onChange={(e) =>
            setFilter({
              ...filter,
              status:
                e.target.value && e.target.value !== "any"
                  ? (e.target.value as TaskFilter["status"])
                  : undefined,
              includeDone: e.target.value === "any" ? "true" : undefined,
            })
          }
        >
          <option value="">Open</option>
          <option value="any">Any status</option>
          {taskStatuses.map((option) => (
            <option key={option} value={option}>
              {taskStatusLabels[option]}
            </option>
          ))}
        </select>
      </FilterBar>
      <div className="task-views">
        <form className="task-inline-form" onSubmit={saveView}>
          <input
            aria-label="View name"
            placeholder="Name these filters to save them as a view"
            maxLength={80}
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!viewName.trim()}>
            Save view
          </Button>
        </form>
        {matchingView && (
          <Button
            variant="ghost"
            onClick={async () => {
              setError("");
              try {
                await tasksApi.deleteView(matchingView.id);
                views.reload();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Delete view “{matchingView.name}”
          </Button>
        )}
      </div>
      {list.error ? (
        <LoadError message={list.error} />
      ) : !list.data ? (
        <LoadingSkeleton />
      ) : list.data.length ? (
        <ul className="task-lines" aria-label="Tasks">
          {list.data.map((task) => (
            <TaskLine key={task.id} task={task}>
              <TaskActions task={task} onChanged={list.reload} onError={setError} />
            </TaskLine>
          ))}
        </ul>
      ) : (
        <EmptyState title="No tasks" description="No tasks match these filters." />
      )}
      <LoadMore list={list} />
      {adding && (
        <NewTaskDrawer open onClose={() => setAdding(false)} onCreated={list.reload} />
      )}
    </>
  );
}

// The event hub's Tasks section: the event's tasks, adding one, and applying a
// task template (FLOW-62) for people who delegate.
export function EventTasksSection({ event }: { event: FlowEvent }) {
  const { actor, can } = usePermissions();
  const communal = actor ? taskScope(actor) === "all" : false;
  const filter: TaskFilter = {
    eventId: event.id,
    includeDone: "true",
    ...(communal ? {} : { mine: "true" as const }),
  };
  const list = usePagedList(["tasks", "event", event.id, communal], (cursor) =>
    tasksApi.list(filter, cursor),
  );
  const delegates = can("tasks.delegate");
  const templates = useResource(["tasks", "templates"], () => tasksApi.templates(), {
    enabled: delegates,
  });
  const [template, setTemplate] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const apply = async () => {
    setError("");
    setMessage("");
    try {
      const result = await tasksApi.applyTemplate(template, event.id);
      setMessage(
        `Added ${result.created.length} task${result.created.length === 1 ? "" : "s"}` +
          (result.skipped ? `; ${result.skipped} already on this event.` : "."),
      );
      list.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Section
      title="Tasks"
      action={
        <Button variant="outline" onClick={() => setAdding(true)}>
          Add task
        </Button>
      }
    >
      {delegates && (templates.data?.length ?? 0) > 0 && (
        <div className="task-inline-form">
          <select
            aria-label="Task template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            <option value="">Choose a task template</option>
            {templates.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <Button variant="outline" disabled={!template} onClick={() => void apply()}>
            Apply template
          </Button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {list.error ? (
        <LoadError message={list.error} />
      ) : !list.data ? (
        <LoadingSkeleton />
      ) : list.data.length ? (
        <ul className="task-lines" aria-label="Event tasks">
          {list.data.map((task) => (
            <TaskLine key={task.id} task={task}>
              <TaskActions task={task} onChanged={list.reload} onError={setError} />
            </TaskLine>
          ))}
        </ul>
      ) : (
        <p className="task-empty">No tasks on this event yet.</p>
      )}
      <LoadMore list={list} />
      {/* Mounted only when open: its staff and event pickers load nothing until then. */}
      {adding && (
        <NewTaskDrawer
          open
          onClose={() => setAdding(false)}
          onCreated={list.reload}
          eventId={event.id}
        />
      )}
    </Section>
  );
}
