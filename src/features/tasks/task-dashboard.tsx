import { Dropdown } from "../../components/ui/Dropdown";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { type TaskDashboardSection, type TaskFilter, type TaskSummary } from "../../../shared/tasks";
import type { StaffMember } from "../../../shared/staff";
import { taskScope } from "../../../shared/policy";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { Button, LoadingSkeleton, PageHeader, Section, ErrorText } from "../../components/shared";
import { tasksApi } from "../../services/tasks";
import { T } from "../../app/copy";
import { NewTaskDrawer, useActiveStaff } from "./task-form";
import { TaskTable } from "./task-table";
import "./tasks.css";

// The task dashboard at /tasks (FLOW-60/345): four task tables.

// A link to the task list showing exactly the tasks a dashboard section counts.
const listLink = (filter: TaskFilter) =>
  `/tasks/all?${new URLSearchParams(
    Object.entries(filter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ).toString()}`;

// A dashboard card's table (FLOW-345): the shared task table, one column set for
// every card (an Admin picks and resizes it in live edit), with a link to the
// task list showing exactly the tasks the card counts.
function DashboardCard({
  title,
  label,
  section,
  filter,
  empty,
  staff,
  onChanged,
  onError,
  actions,
}: {
  title: ReactNode;
  // The card's accessible name.
  label: string;
  section: TaskDashboardSection;
  filter: TaskFilter;
  empty: ReactNode;
  staff: StaffMember[];
  onChanged: () => void;
  onError: (message: string) => void;
  actions?: (task: TaskSummary) => ReactNode;
}) {
  return (
    <div role="region" aria-label={label}>
      <Section title={title}
        action={section.count > 0 ? <Link to={listLink(filter)}><T id="task-lists.dashboard-group.view-all">View all</T></Link> : undefined}>
        {section.tasks.length
          ? <TaskTable tasks={section.tasks} staff={staff} copyKey="tasks.dashboard.table" onChanged={onChanged} onError={onError} actions={actions} />
          : <p className="task-empty">{empty}</p>}
      </Section>
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
            ...(task.managers.length ? {} : { managerIds: [actor.userId] }),
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

// /tasks: each person's home for their own work and the work they manage
// (FLOW-345): All Tasks, My Tasks, Managing and, for those who triage, Needs
// Delegation. Done tasks stay for the Settings' "hide completed tasks after N
// days" (the API keeps them).
export function TaskDashboardPage() {
  const { actor, can } = usePermissions();
  const dashboard = useResource(["tasks", "dashboard"], () => tasksApi.dashboard());
  const staff = useActiveStaff();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  if (dashboard.error) return <ErrorText message={dashboard.error} />;
  if (!dashboard.data || !actor) return <LoadingSkeleton />;
  const data = dashboard.data;
  const reload = () => dashboard.reload();
  const card = { staff, onChanged: reload, onError: setError };
  return (
    <>
      <PageHeader pageKey="tasks.dashboard" title={<T id="task-lists.task-dashboard-page.tasks">Tasks</T>} subtitle={<T id="task-lists.task-dashboard-page.your-tasks-and-the-ones">Your tasks and the ones you manage.</T>}>
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
      <ErrorText message={error} />
      <PageGrid pageKey="tasks.dashboard">
        <Block id="all-tasks" name="All tasks" h={16}>
          <DashboardCard {...card} section={data.all} filter={{ includeDone: "true" }}
            label="All Tasks" title={<T id="task-lists.task-dashboard-page.all-tasks-card">All tasks</T>}
            empty={<T id="task-lists.task-dashboard-page.no-tasks-yet">No tasks yet.</T>} />
        </Block>
        <Block id="my-tasks" name="My tasks" h={16}>
          <DashboardCard {...card} section={data.mine} filter={{ assigneeId: actor.userId, includeDone: "true" }}
            label="My Tasks" title={<T id="task-lists.task-dashboard-page.my-tasks">My tasks</T>}
            empty={<T id="task-lists.task-dashboard-page.nothing-assigned-to-you">Nothing assigned to you.</T>} />
        </Block>
        <Block id="overseeing" name="Managing" h={12}>
          <DashboardCard {...card} section={data.managing} filter={{ overseerId: actor.userId, includeDone: "true" }}
            label="Managing" title={<T id="task-lists.task-dashboard-page.overseeing">Managing</T>}
            empty={<T id="task-lists.task-dashboard-page.you-don-t-oversee-any">{"You don't manage any open tasks."}</T>} />
        </Block>
        {data.needsDelegation && (
          <Block id="needs-delegation" name="Needs delegation" h={12}>
            <DashboardCard {...card} section={data.needsDelegation} filter={{ unassigned: "true" }}
              label="Needs Delegation" title={<T id="task-lists.task-dashboard-page.needs-delegation">Needs delegation</T>}
              empty={<T id="task-lists.task-dashboard-page.every-task-coming-up-has">Every task coming up has someone on it.</T>}
              actions={(task) => <QuickAssign task={task} staff={staff} onChanged={reload} onError={setError} />} />
          </Block>
        )}
      </PageGrid>
      {adding && (
        <NewTaskDrawer open onClose={() => setAdding(false)} onCreated={reload} />
      )}
    </>
  );
}
