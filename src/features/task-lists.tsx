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
import { preparationApi } from "../services/preparation";
import { sopsApi } from "../services/sops";
import { dateTimeLabel } from "./inventory-labels";
import "./tasks.css";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy } from "../app/copy";
import { copySlug } from "../../shared/copy";

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
          <T id="task-lists.task-actions.claim">Claim</T>
        </Button>
      )}
      <Button
        variant="outline"
       
        disabled={busy}
        aria-label={`Complete ${task.title}`}
        onClick={() => void run(() => tasksApi.update(task.id, { status: "done" }))}
      >
        <T id="task-lists.task-actions.done">Done</T>
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
  const sops = useResource(["sops", "options"], () => sopsApi.list(), { reference: true });
  const delegates = can("tasks.delegate");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>(delegates ? "delegated" : "general");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("17:00");
  const [event, setEvent] = useState(eventId ?? "");
  const [sopId, setSopId] = useState("");
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
        sopId: sopId || null,
        assigneeIds: assignees,
        overseerId: overseer || (others ? actor.userId : null),
      });
      setTitle("");
      setSopId("");
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
      title={<T id="task-lists.new-task-drawer.new-task">New task</T>}
      description={<T id="task-lists.new-task-drawer.add-a-task-for-yourself">Add a task for yourself or the team.</T>}
    >
      <form className="task-form" onSubmit={submit}>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label={<T id="task-lists.new-task-drawer.title">Title</T>}>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.type">Type</T>}>
          <select value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {taskTypes.map((option) => (
              <option key={option} value={option}>
                {taskTypeLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.priority">Priority</T>}>
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
        <FormField label={<T id="task-lists.new-task-drawer.sop">SOP</T>}>
          <select value={sopId} onChange={(e) => setSopId(e.target.value)}>
            <option value="">No SOP</option>
            {(sops.data ?? []).map((sop) => <option key={sop.id} value={sop.id}>{sop.title} ({sop.category})</option>)}
          </select>
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.due-date">Due date</T>}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>
        <FormField label={<T id="task-lists.new-task-drawer.due-time">Due time</T>}>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </FormField>
        {!eventId && (
          <FormField label={<T id="task-lists.new-task-drawer.event">Event</T>}>
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
            <FormField label={<T id="task-lists.new-task-drawer.assign-to">Assign to</T>} hint={<T id="task-lists.new-task-drawer.hold-ctrl-or-to-pick">Hold Ctrl or ⌘ to pick several people.</T>}>
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
              label={<T id="task-lists.new-task-drawer.overseer">Overseer</T>}
              hint={<T id="task-lists.new-task-drawer.when-you-assign-someone-else">When you assign someone else, you oversee it unless you pick someone.</T>}
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
            <RoundCheck
              checked={assignees.includes(actor.userId)}
              onChange={(e) => setAssignees(e.target.checked ? [actor.userId] : [])}
            />
            <T id="task-lists.new-task-drawer.assign-to-me">Assign to me</T>
          </label>
        )}
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            <T id="task-lists.new-task-drawer.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            <T id="task-lists.new-task-drawer.add-task">Add task</T>
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
  empty: ReactNode;
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
      <PageHeader title={<T id="task-lists.task-dashboard-page.tasks">Tasks</T>} subtitle={<T id="task-lists.task-dashboard-page.your-tasks-and-the-ones">Your tasks and the ones you oversee.</T>}>
        {taskScope(actor) === "all" && (
          <Button asChild variant="outline">
            <Link to="/tasks/all"><T id="task-lists.task-dashboard-page.team-tasks">Team tasks</T></Link>
          </Button>
        )}
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
      <Section title={<T id="task-lists.task-dashboard-page.my-tasks">My tasks</T>}>
        <DashboardGroup
          title="Overdue"
          section={data.overdue}
          filter={mine("overdue")}
          empty={<T id="task-lists.task-dashboard-page.nothing-overdue">Nothing overdue.</T>}
        >
          {act}
        </DashboardGroup>
        <DashboardGroup
          title="Due today"
          section={data.today}
          filter={mine("today")}
          empty={<T id="task-lists.task-dashboard-page.nothing-else-due-today">Nothing else due today.</T>}
        >
          {act}
        </DashboardGroup>
        <DashboardGroup
          title="Upcoming"
          section={data.upcoming}
          filter={mine("upcoming")}
          empty={<T id="task-lists.task-dashboard-page.nothing-coming-up">Nothing coming up.</T>}
        >
          {act}
        </DashboardGroup>
      </Section>
      <Section title={<T id="task-lists.task-dashboard-page.overseeing">Overseeing</T>}>
        <DashboardGroup
          title="Tasks I oversee"
          section={data.overseeing}
          filter={{ mine: "true", overseerId: actor.userId }}
          empty={<T id="task-lists.task-dashboard-page.you-don-t-oversee-any">{"You don't oversee any open tasks."}</T>}
        >
          {() => null}
        </DashboardGroup>
      </Section>
      {data.needsDelegation && (
        <Section title={<T id="task-lists.task-dashboard-page.needs-delegation">Needs delegation</T>}>
          <DashboardGroup
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
  const nameTheseFiltersToSavePlaceholder = useCopy("task-lists.task-list.name-these-filters-to-save.placeholder", "Name these filters to save them as a view");
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
        <T id="task-lists.task-list.tasks">← Tasks</T>
      </Link>
      <PageHeader
        title={communal ? <T id="task-lists.task-list.team-tasks">Team tasks</T> : <T id="task-lists.task-list.my-tasks">My tasks</T>}
        subtitle={
          communal
            ? <T id="task-lists.task-list.every-open-task-on-the">Every open task on the team. Claim one to take it on.</T>
            : <T id="task-lists.task-list.the-tasks-you-re-assigned">{"The tasks you're assigned to, oversee or created."}</T>
        }
      >
        <Button onClick={() => setAdding(true)}><T id="task-lists.task-list.new-task">New task</T></Button>
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
            placeholder={nameTheseFiltersToSavePlaceholder} data-copy-id="task-lists.task-list.name-these-filters-to-save.placeholder"
            maxLength={80}
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!viewName.trim()}>
            <T id="task-lists.task-list.save-view">Save view</T>
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
            <T id="task-lists.task-list.delete-view" values={{ name: matchingView.name }}>{"Delete view “{name}”"}</T>
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
        <EmptyState title={<T id="task-lists.task-list.no-tasks">No tasks</T>} description={<T id="task-lists.task-list.no-tasks-match-these-filters">No tasks match these filters.</T>} />
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
  const pull = useResource(["event-pull-list", event.id], () => preparationApi.pullList(event.id));
  const tbdPullLines = pull.data?.groups.flatMap((group) => group.lines).filter((line) => line.tbd) ?? [];
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
      title={<T id="task-lists.event-tasks-section.tasks">Tasks</T>}
      action={
        <Button variant="outline" onClick={() => setAdding(true)}>
          <T id="task-lists.event-tasks-section.add-task">Add task</T>
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
            <T id="task-lists.event-tasks-section.apply-template">Apply template</T>
          </Button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {tbdPullLines.length > 0 && <p role="alert" className="warning-message">
        <T id="task-lists.event-tasks-section.production-list-pull-quantity-tbd">{"Production list: pull quantity TBD for "}</T>{tbdPullLines.map((line) => line.name).join(", ")}.
      </p>}
      {list.data?.filter((task) => task.type === "production" && task.status !== "done" && !task.assignees.length)
        .map((task) => <p key={task.id} role="alert" className="warning-message">
          {task.title.toLowerCase().includes("balloon arch")
            ? <T id="task-lists.event-tasks-section.who-is-building-the-balloon">Who is building the balloon arch?</T>
            : <T id="task-lists.event-tasks-section.who-is-assigned-to" values={{ title: task.title }}>{"Who is assigned to {title}?"}</T>}
        </p>)}
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
        <p className="task-empty"><T id="task-lists.event-tasks-section.no-tasks-on-this-event">No tasks on this event yet.</T></p>
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
