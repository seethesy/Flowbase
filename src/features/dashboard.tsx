import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { homeDashboardSchema, type HomeDashboard } from "../../shared/home-dashboard";
import type { Role } from "../../shared/access";
import type { TaskSummary } from "../../shared/tasks";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { PageHeader, LoadingSkeleton, RoleText } from "../components/shared";
import { LoadError } from "../components/record-display";
import { RoundCheck } from "../components/ui/round-check";
import { StatusPill } from "../components/ui/status-pill";
import { roleLabel } from "../services/users";
import { request } from "../services/core";
import { tasksApi } from "../services/tasks";
import { T } from "../app/copy";
import { Block, PageGrid } from "../app/page-grid";
import "./dashboard.css";

const day = (value: string | null) => value ? new Date(value).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }) : "—";
const time = (value: string) => new Date(value).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

function TaskRows({ rows, toggle, href, showAssignee = true }: { rows: TaskSummary[]; toggle: (task: TaskSummary) => void; href: (id: string) => string; showAssignee?: boolean }) {
  return <ul className="dashboard-task-list">{rows.map((task) => <li key={task.id} className={task.status === "done" ? "completed" : ""}>
    <RoundCheck aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`} checked={task.status === "done"} onChange={() => toggle(task)} />
    <span><Link to={href(task.id)}>{task.title}</Link><small>{showAssignee && <>{task.assignees.map((person) => person.name).join(", ") || <T id="dashboard.home.unassigned">Unassigned</T>} · </>}{task.eventTitle ?? <T id="dashboard.home.no-event">No event</T>}</small></span>
    <time>{day(task.dueAt)}</time>
  </li>)}</ul>;
}

export function Dashboard() {
  const role = useAuth()?.user.role;
  const [params, setParams] = useSearchParams();
  const selectedRole = params.get("role") ?? "";
  const dashboard = useResource(["home", "dashboard", role], () => request(homeDashboardSchema, "/api/home/dashboard"));
  const [error, setError] = useState("");
  const to = (path: string) => `${path}${path.includes("?") ? "&" : "?"}fromDashboard=1${selectedRole ? `&dashboardRole=${encodeURIComponent(selectedRole)}` : ""}`;
  const toggle = async (task: TaskSummary) => {
    const current = dashboard.data;
    if (!current) return;
    const status = task.status === "done" ? "todo" : "done";
    const completedAt = status === "done" ? new Date().toISOString() : null;
    const updated = (row: TaskSummary): TaskSummary => row.id === task.id ? { ...row, status, completedAt } : row;
    dashboard.replace({ ...current, myTasks: current.myTasks.map(updated),
      allTasks: current.allTasks?.map((row) => ({ ...row, task: updated(row.task) })) ?? null });
    setError("");
    try { await tasksApi.update(task.id, { status }); }
    catch (cause) { dashboard.replace(current); setError((cause as Error).message); }
  };
  const data: HomeDashboard | undefined = dashboard.data;
  const all = data?.allTasks?.filter((row) => !selectedRole || row.assigneeRoles.includes(selectedRole as Role)) ?? [];
  return <>
    <PageHeader title={<T id="dashboard.home.title">Dashboard</T>} subtitle={role ? <RoleText role={role} /> : ""} />
    {error && <p role="alert">{error}</p>}
    {dashboard.error ? <LoadError message={dashboard.error} /> : !data ? <LoadingSkeleton /> :
      <div className={`dashboard-cards ${data.myLeads === null ? "dashboard-cards--no-leads" : ""} ${data.allTasks === null ? "dashboard-cards--no-all" : ""}`}>
        <PageGrid pageKey="dashboard.home">
        {data.myLeads !== null && <Block id="my-leads" name="My Leads" w={6} h={12}><section className="dashboard-card dashboard-card--leads"><header><h2><T id="dashboard.home.my-leads">My Leads</T> <span>{data.myLeads.length}</span></h2><Link to={to("/leads")}><T id="dashboard.home.view-all-leads">View all</T></Link></header>
          <div className="dashboard-card__scroll"><table><thead><tr><th><T id="dashboard.home.client">Client</T></th><th><T id="dashboard.home.event">Event</T></th><th><T id="dashboard.home.date">Date</T></th><th><T id="dashboard.home.status">Status</T></th></tr></thead><tbody>{data.myLeads.map((lead) => <tr key={lead.id}>
            <td><Link to={to(`/leads/${lead.id}`)}>{lead.client || <T id="dashboard.home.unnamed-lead">Unnamed lead</T>}</Link></td><td>{lead.event || "—"}</td><td>{day(lead.date)}</td><td><StatusPill status={lead.status} /></td>
          </tr>)}</tbody></table></div></section></Block>}
        <Block id="my-tasks" name="My Tasks" w={6} h={12}><section className="dashboard-card dashboard-card--my-tasks"><header><h2><T id="dashboard.home.my-tasks">My Tasks</T> <span>{data.myTasks.filter((task) => task.status !== "done").length}</span></h2><Link to={to("/tasks?mine=true")}><T id="dashboard.home.view-all-tasks">View all</T></Link></header>
          <div className="dashboard-card__scroll"><TaskRows rows={data.myTasks} showAssignee={false} toggle={(task) => void toggle(task)} href={(id) => to(`/tasks/${id}`)} /></div></section></Block>
        {data.allTasks !== null && <Block id="all-tasks" name="All Tasks" w={6} h={12}><section className="dashboard-card dashboard-card--all-tasks"><header><h2><T id="dashboard.home.all-tasks">All Tasks</T> <span>{all.filter((row) => row.task.status !== "done").length}</span></h2><select aria-label="Filter All Tasks by role" value={selectedRole} onChange={(event) => setParams(event.target.value ? { role: event.target.value } : {})}>
          <option value="">All roles</option>{data.roles.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}
        </select></header><div className="dashboard-card__scroll"><TaskRows rows={all.map((row) => row.task)} toggle={(task) => void toggle(task)} href={(id) => to(`/tasks/${id}`)} /></div></section></Block>}
        <Block id="upcoming-events" name="Upcoming Events" w={6} h={12}><section className="dashboard-card dashboard-card--events"><header><h2><T id="dashboard.home.upcoming-events">Upcoming Events</T></h2><Link to={to("/events")}><T id="dashboard.home.view-all-events">View all</T></Link></header>
          <div className="dashboard-card__scroll"><table><thead><tr><th><T id="dashboard.home.event-date">Date</T></th><th><T id="dashboard.home.event-name">Event</T></th><th><T id="dashboard.home.venue">Venue</T></th><th><T id="dashboard.home.guests">Guests</T></th></tr></thead><tbody>{data.upcomingEvents.map((event) => <tr key={event.id}>
            <td>{day(event.date)}</td><td><Link to={to(`/events/${event.id}`)}>{event.event}</Link></td><td>{event.venue ?? "—"}</td><td>{event.guests ?? "—"}</td>
          </tr>)}</tbody></table></div></section></Block>
        <Block id="working-staff" name="Working Staff" w={6} h={12}><section className="dashboard-card dashboard-card--staff"><header><h2><T id="dashboard.home.working-staff">Working Staff</T></h2><Link to={to("/staff")}><T id="dashboard.home.view-all-staff">View all</T></Link></header>
          <div className="dashboard-card__scroll"><table><thead><tr><th><T id="dashboard.home.staff-name">Name</T></th><th><T id="dashboard.home.position">Position</T></th><th><T id="dashboard.home.since">Since</T></th></tr></thead><tbody>{data.workingStaff.map((person, index) => <tr key={`${person.id}:${index}`}>
            <td><Link to={to(`/staff/${person.id}`)}>{person.name}</Link></td><td>{person.position}</td><td>{time(person.since)}</td>
          </tr>)}</tbody></table></div></section></Block>
        </PageGrid>
      </div>}
  </>;
}
