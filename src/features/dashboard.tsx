import { Link } from "react-router-dom";
import { z } from "zod";
import type { Role } from "../../shared/access";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { LoadingSkeleton, PageHeader } from "../components/shared";
import { LoadError } from "../components/record-display";
import { roleLabel } from "../services/users";
import { request, calendarApi, inventoryApi } from "../services/core";
import { approvalsApi } from "../services/approvals";
import { leadsApi } from "../services/leads";
import { productionApi } from "../services/production";
import { salesApi } from "../services/sales";
import { tasksApi } from "../services/tasks";
import "./dashboard.css";

type Widget = { label: string; value: number | string; to: string };
const widget = (label: string, value: number | string, to: string): Widget => ({ label, value, to });
const countSchema = z.object({ count: z.number().int() });
const healthSchema = z.array(z.object({ status: z.string() }));
const usageSchema = z.array(z.object({ percent: z.number().nullable() }));
const rowsSchema = z.array(z.unknown());

// Each source enforces its own role and record scope in the Worker. Only the
// sources for this role are requested, including financial and admin data.
export async function homeWidgets(role: Role): Promise<Widget[]> {
  const today = utcToBusinessTime(new Date()).date;
  const tasks = await tasksApi.dashboard();
  const myTasks = widget("My tasks", tasks.overdue.count + tasks.today.count + tasks.upcoming.count, "/tasks");
  if (role === "salesperson") {
    const [leads, sales] = await Promise.all([leadsApi.dashboard(), salesApi.list()]);
    const rows = sales.rows;
    return [
      widget("New leads", leads.byStatus.find((r) => r.status === "new")?.leads ?? 0, "/leads?status=new"),
      widget("Follow-ups due", rows.filter((r) => r.nextFollowUp && r.nextFollowUp.slice(0, 10) <= today).length, "/proposals"),
      widget("Proposals awaiting approval", rows.filter((r) => r.kind === "proposal" && r.proposalStage === "finalized").length, "/proposals?stage=finalized"),
      widget("Awaiting client response", rows.filter((r) => r.kind === "proposal" && r.proposalStage === "sent").length, "/proposals?stage=sent"),
      widget("Unpaid balances", rows.filter((r) => r.kind === "event" && (r.balanceCents ?? 0) > 0).length, "/proposals"),
    ];
  }
  if (role === "sales_manager") {
    const [approvals, production, leads, calendar] = await Promise.all([
      approvalsApi.list(), productionApi.overview(14), leadsApi.dashboard(), calendarApi.get(today, addLocalDays(today, 13)),
    ]);
    const items = production.days.flatMap((day) => day.items);
    return [
      widget("BEO approvals", approvals.rows.filter((r) => r.subjectType === "beo").length, "/approvals"),
      widget("Inventory conflicts", items.filter((r) => r.type === "shortage" && !r.complete).length, "/production"),
      widget("Production alerts", items.filter((r) => (r.type === "readiness" || r.type === "shortage") && !r.complete).length, "/production"),
      widget("Upcoming events", calendar.events.length, "/calendar"),
      widget("Leads in triage", leads.totals.awaitingAction, "/leads?triage=true"),
    ];
  }
  if (role === "admin") {
    const [approvals, health, usage, leads] = await Promise.all([
      approvalsApi.list(), request(healthSchema, "/api/admin/collector-health"),
      request(usageSchema, "/api/admin/usage"), leadsApi.list({ triage: true }),
    ]);
    return [
      widget("Pending approvals", approvals.rows.length, "/approvals"),
      widget("Collector health", health.filter((r) => r.status !== "ok").length, "/settings/collector"),
      widget("Free-tier usage", usage.filter((r) => (r.percent ?? 0) >= 80).length, "/settings/usage"),
      widget("Leads awaiting assignment", leads.rows.filter((r) => !r.assignedSalespersonId).length, "/leads?triage=true"),
    ];
  }
  if (role === "technical") {
    const [health, usage, jobs, receipts] = await Promise.all([
      request(healthSchema, "/api/admin/collector-health"), request(usageSchema, "/api/admin/usage"),
      request(rowsSchema, "/api/admin/jobs?status=failed"), request(rowsSchema, "/api/admin/ingest-receipts?status=failed"),
    ]);
    return [
      widget("Free-tier usage", usage.filter((r) => (r.percent ?? 0) >= 80).length, "/settings/usage"),
      widget("Collector health", health.filter((r) => r.status !== "ok").length, "/settings/collector"),
      widget("Failed jobs", jobs.length, "/settings/operations#jobs"),
      widget("Failed ingest receipts", receipts.length, "/settings/operations#receipts"),
    ];
  }
  if (role === "kitchen_lead" || role === "kitchen_staff") {
    const [kitchenState, lowStock] = await Promise.all([
      request(z.object({ menus: z.number().int(), openOrderLists: z.number().int() }), "/api/home/kitchen"),
      inventoryApi.list({ kind: "consumable", subtype: "ingredient", belowPar: true }),
    ]);
    const kitchen = tasks.overdue.tasks.concat(tasks.today.tasks, tasks.upcoming.tasks).filter((r) => r.type === "kitchen");
    const base = [
      widget("Kitchen tasks", kitchen.length, "/tasks"),
      widget("Upcoming menus", kitchenState.menus, "/calendar"),
      widget("Low stock", lowStock.rows.length, "/inventory/low-stock"),
      widget("Order list status", kitchenState.openOrderLists, "/kitchen/orders"),
    ];
    return base;
  }
  const shifts = await request(countSchema, "/api/home/my-shifts");
  return [myTasks, widget("My shifts", shifts.count, "/calendar")];
}

export function Dashboard() {
  const role = useAuth()?.user.role;
  const dashboard = useResource(["home", role], () => role ? homeWidgets(role) : Promise.resolve([]));
  return <>
    <PageHeader title="Home" subtitle={role ? `${roleLabel(role)} · what needs your attention` : "What needs your attention"} />
    {dashboard.error ? <LoadError message={dashboard.error} /> : !dashboard.data ? <LoadingSkeleton /> :
      <div className="home-widget-grid">{dashboard.data.map((item) =>
        <Link className="home-widget" key={item.label} to={item.to}>
          <span>{item.label}</span><strong>{item.value}</strong><small>View list →</small>
        </Link>)}</div>}
  </>;
}
