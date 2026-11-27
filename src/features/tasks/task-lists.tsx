import { Dropdown } from "../../components/ui/Dropdown";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { taskDueBucketLabels, taskDueBuckets, taskFilterSchema, taskPriorities, taskPriorityLabels, taskPrioritySchema, taskStatuses, taskStatusLabels, taskStatusSchema, taskTypeLabels, taskTypeSchema, taskTypes, type TaskFilter, type TaskSummary, type TaskUpdate } from "../../../shared/tasks";
import { type FlowEvent } from "../../../shared/core-records";
import { mayManageTask, taskScope } from "../../../shared/policy";
import { businessTimeToUtc, isBusinessTime, utcToBusinessTime } from "../../../shared/time";
import { LoadMore, usePagedList } from "../../app/paging";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { Button, EditableCell, EmptyState, FilterBar, LoadingSkeleton, PageHeader, Section, ErrorText } from "../../components/shared";
import { tasksApi } from "../../services/tasks";
import { preparationApi } from "../../services/preparation";
import { dateTimeLabel } from "../inventory/inventory-labels";
import { T, useCopy, LabelT, joined } from "../../app/copy";
import { NewTaskDrawer, names, useActiveStaff, useUpcomingEvents } from "./task-form";
import { TaskTable } from "./task-table";
import "./tasks.css";

// Task lists (FLOW-59/60/61): the communal list at /tasks/all with filters and
// saved views (its rows are the shared task table, FLOW-345), and the event
// hub's Tasks section (still one line per task). The dashboard at /tasks is in
// task-dashboard.tsx and the new-task form in task-form.tsx. The API enforces
// who sees what; these screens only hide what a person can't use.

// One task in a list. On All tasks (onChanged given) every stored field shown is
// edited in place (FLOW-261/275): the status by anyone who sees the task, the
// rest by whoever may manage it (mayManageTask). The API checks the same rules;
// a refused or failed save rolls the field back and shows why.
function TaskLine({
  task,
  children,
  onChanged,
  staff = [],
  events = [],
}: {
  task: TaskSummary;
  children?: ReactNode;
  onChanged?: () => void;
  staff?: { id: string; name: string }[];
  events?: FlowEvent[];
}) {
  const { actor } = usePermissions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [display, setDisplay] = useState(task.title);
  useEffect(() => setDisplay(task.title), [task.title]);
  const [error, setError] = useState("");
  const cancelled = useRef(false);
  const editable = Boolean(onChanged && actor && mayManageTask(actor, {
    createdBy: task.creator?.id ?? null, managerIds: task.managers.map((person) => person.id) }));
  const save = async () => {
    if (cancelled.current || draft === display) { setEditing(false); return; }
    const before = display;
    setDisplay(draft); setEditing(false); setError("");
    try { await tasksApi.update(task.id, { title: draft }); onChanged?.(); }
    catch (cause) { setDisplay(before); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const patch = async (change: TaskUpdate) => {
    await tasksApi.update(task.id, change);
    onChanged?.();
  };
  // A due date keeps the task's time of day (5 PM when it had none).
  const due = task.dueAt ? utcToBusinessTime(new Date(task.dueAt)) : null;
  // FLOW-275: the Due field reads as it does elsewhere ("Due 2026-09-03 18:00").
  const dueText = useCopy("task-lists.task-line.due", "Due {date}", { date: task.dueAt ? dateTimeLabel(task.dueAt) : "" });
  const noDueText = useCopy("task-lists.task-line.no-due-date", "No due date");
  const managersLabel = useCopy("task-lists.task-line.managers", "Managers");
  const people = [
    ...staff,
    ...[...task.assignees, ...task.managers]
      .filter((person) => !staff.some((member) => member.id === person.id)),
  ].map((person) => ({ value: person.id, label: person.name }));
  const eventOptions = [
    { value: "", label: "No event" },
    ...(task.eventId && !events.some((event) => event.id === task.eventId)
      ? [{ value: task.eventId, label: task.eventTitle ?? "Linked event" }] : []),
    ...events.map((event) => ({ value: event.id, label: `${event.title} (${event.date})` })),
  ];
  const fields = onChanged && actor ? (
    <div className="task-line-fields">
      <EditableCell label="Status" row={task} edit="select" value={task.status}
        options={taskStatuses.map((value) => ({ value, label: taskStatusLabels[value] }))}
        save={(_row, value) => patch({ status: taskStatusSchema.parse(value) })} />
      {editable ? <>
        <EditableCell label="Type" row={task} edit="select" value={task.type}
          options={taskTypes.map((value) => ({ value, label: taskTypeLabels[value] }))}
          save={(_row, value) => patch({ type: taskTypeSchema.parse(value) })} />
        <EditableCell label="Priority" row={task} edit="select" value={task.priority}
          options={taskPriorities.map((value) => ({ value, label: taskPriorityLabels[value] }))}
          save={(_row, value) => patch({ priority: taskPrioritySchema.parse(value) })} />
        <EditableCell label="Due" row={task} edit="date" value={due?.date ?? ""}
          displayText={task.dueAt ? dueText : noDueText}
          save={(_row, value) => {
            if (value && !isBusinessTime(value, due?.time ?? "17:00"))
              return Promise.reject(new Error("Pick a due date that exists in New York time."));
            return patch({ dueAt: value ? businessTimeToUtc(value, due?.time ?? "17:00").toISOString() : null });
          }} />
        <EditableCell label="Assignees" row={task} edit="select" multiple options={people}
          value={task.assignees.map((person) => person.id).join(",")}
          save={(_row, value) => patch({ assigneeIds: value.split(",").filter(Boolean) })} />
        <EditableCell label={managersLabel} row={task} edit="select" multiple value={task.managers.map((person) => person.id).join(",")}
          options={people}
          save={(_row, value) => patch({ managerIds: value.split(",").filter(Boolean) })} />
        <EditableCell label="Position" row={task} edit="text" value={task.position ?? ""}
          save={(_row, value) => patch({ position: value.trim() || null })} />
        <EditableCell label="Event" row={task} edit="select" value={task.eventId ?? ""} options={eventOptions}
          save={(_row, value) => patch({ eventId: value || null })} />
      </> : <small>
        {joined([
          <LabelT id="labels.task-type" value={task.type}>{taskTypeLabels[task.type]}</LabelT>,
          task.dueAt
            ? <T id="task-lists.task-line.due" values={{ date: dateTimeLabel(task.dueAt) }}>{"Due {date}"}</T>
            : <T id="task-lists.task-line.no-due-date">No due date</T>,
          task.assignees.length ? names(task.assignees) : <T id="task-lists.task-line.unassigned">Unassigned</T>,
          task.position,
          task.eventTitle,
        ])}
      </small>}
    </div>
  ) : null;
  return (
    <li className="task-line">
      <div>
        <Link to={`/tasks/${task.id}`}>{display}</Link>
        {editable && (editing ? <input aria-label={`Edit ${task.title}`} autoFocus value={draft}
          onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") { cancelled.current = true; setDraft(display); setEditing(false); }
          }} /> : <button type="button" className="task-inline-edit" onClick={() => {
            cancelled.current = false; setDraft(display); setEditing(true);
          }}><T id="task-lists.task-line.edit">Edit</T></button>)}
        {error && <span className="table-edit-error" role="alert">{error}</span>}
        {fields ?? <small>
          {joined([
            <LabelT id="labels.task-type" value={task.type}>{taskTypeLabels[task.type]}</LabelT>,
            <LabelT id="labels.task-status" value={task.status}>{taskStatusLabels[task.status]}</LabelT>,
            task.dueAt
              ? <T id="task-lists.task-line.due" values={{ date: dateTimeLabel(task.dueAt) }}>{"Due {date}"}</T>
              : <T id="task-lists.task-line.no-due-date">No due date</T>,
            task.assignees.length ? names(task.assignees) : <T id="task-lists.task-line.unassigned">Unassigned</T>,
            task.position,
            task.eventTitle,
          ])}
        </small>}
      </div>
      {children && <div className="task-line-actions">{children}</div>}
    </li>
  );
}

// Claim and complete, where they apply. onChanged reloads the list.
export function TaskActions({
  task,
  onChanged,
  onError,
}: {
  task: TaskSummary;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { actor, can } = usePermissions();
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
  const open = task.assignees.length === 0;
  return (
    <>
      {!mine && open && (
        <Button
          variant="outline"
          disabled={busy}
          aria-label={`Pick up ${task.title}`}
          onClick={() =>
            void run(() => tasksApi.claim(task.id, { unassignedOnly: true }))
          }
        >
          <T id="task-lists.task-actions.pick-up">Pick up</T>
        </Button>
      )}
      {!mine && !open && can("tasks.delegate") && (
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

// /tasks/all: the communal list (FLOW-59). Roles limited to their own tasks see
// those plus the open unassigned tasks (FLOW-272).
export function TaskList() {
  const nameTheseFiltersToSavePlaceholder = useCopy("task-lists.task-list.name-these-filters-to-save.placeholder", "Name these filters to save them as a view");
  const managerFilterLabel = useCopy("task-lists.task-list.manager-filter", "Manager");
  const { actor } = usePermissions();
  const [params, setParams] = useSearchParams();
  const staff = useActiveStaff();
  const events = useUpcomingEvents();
  const views = useResource(["tasks", "views"], () => tasksApi.views());
  const [adding, setAdding] = useState(false);
  const [viewName, setViewName] = useState("");
  const [error, setError] = useState("");
  // Everyone opens the list; roles limited to their own tasks also see the open
  // unassigned ones, which they can pick up (FLOW-272).
  const communal = actor ? taskScope(actor) === "all" : false;
  const filter: TaskFilter = filterFrom(params);
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
      <PageHeader pageKey="tasks.all"
        title={communal ? <T id="task-lists.task-list.team-tasks">Team tasks</T> : <T id="task-lists.task-list.all-tasks">All tasks</T>}
        subtitle={
          communal
            ? <T id="task-lists.task-list.every-open-task-on-the">Every open task on the team. Claim one to take it on.</T>
            : <T id="task-lists.task-list.your-tasks-and-the-open">{"Your tasks and the open unassigned ones. Pick one up to take it on."}</T>
        }
      >
        <Button onClick={() => setAdding(true)}><T id="task-lists.task-list.new-task">New task</T></Button>
      </PageHeader>
      <ErrorText message={error} />
      <PageGrid pageKey="tasks.all">
      <Block id="filters" name="Filters" h={6}>
      <FilterBar>
        <Dropdown
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
        </Dropdown>
        <Dropdown
          aria-label="Whose tasks"
          value={filter.mine ?? ""}
          onChange={(e) => change("mine", e.target.value)}
        >
          <option value="">Everyone's</option>
          <option value="true">Mine</option>
        </Dropdown>
        <Dropdown
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
        </Dropdown>
        <Dropdown
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
        </Dropdown>
        <Dropdown
          aria-label={managerFilterLabel}
          value={filter.overseerId ?? ""}
          onChange={(e) => change("overseerId", e.target.value)}
        >
          <option value="">Any manager</option>
          {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </Dropdown>
        <Dropdown
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
        </Dropdown>
        <Dropdown
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
        </Dropdown>
        <Dropdown
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
        </Dropdown>
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
      </Block>
      <Block id="list" name="Task list" h={24}>
      {list.error ? (
        <ErrorText message={list.error} />
      ) : !list.data ? (
        <LoadingSkeleton />
      ) : list.data.length ? (
        // The same task table as the Tasks subtab's cards (FLOW-345 Q1).
        <div role="region" aria-label="Tasks">
          <TaskTable tasks={list.data} staff={staff} copyKey="tasks.all.table" onChanged={list.reload} onError={setError} />
        </div>
      ) : (
        <EmptyState title={<T id="task-lists.task-list.no-tasks">No tasks</T>} description={<T id="task-lists.task-list.no-tasks-match-these-filters">No tasks match these filters.</T>} />
      )}
      <LoadMore list={list} />
      </Block>
      </PageGrid>
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
  // FLOW-275: task fields are edited in place here too, as on All tasks. Staff
  // (the assignee and manager choices) load only once the event has tasks, so an
  // event page without tasks makes no extra request.
  const staff = useActiveStaff(Boolean(list.data?.length));
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
          <Dropdown
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
          </Dropdown>
          <Button variant="outline" disabled={!template} onClick={() => void apply()}>
            <T id="task-lists.event-tasks-section.apply-template">Apply template</T>
          </Button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <ErrorText message={error} />
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
        <ErrorText message={list.error} />
      ) : !list.data ? (
        <LoadingSkeleton />
      ) : list.data.length ? (
        <ul className="task-lines" aria-label="Event tasks">
          {list.data.map((task) => (
            <TaskLine key={task.id} task={task} onChanged={list.reload} staff={staff} events={[event]}>
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
