import { useState } from "react";
import { Link } from "react-router-dom";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { PageHeader, Section, Button, LoadingSkeleton } from "../components/shared";
import { LoadError } from "../components/record-display";
import { leadsApi } from "../services/leads";
import { timeApi } from "../services/time-tracking";
import { operationalReportsApi } from "../services/operational-reports";
import { T } from "../app/copy";

const csvCell = (value: string | number) => {
  const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
  return `"${safe.replaceAll('"', '""')}"`;
};
const exportCsv = (rows: (string | number)[][]) => {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "operational-reports.csv";
  link.click();
  URL.revokeObjectURL(url);
};

export function OperationalReports() {
  const user = useAuth()?.user;
  const allowed = user?.role === "admin" || user?.role === "sales_manager";
  const [from, setFrom] = useState(() => addLocalDays(utcToBusinessTime(new Date()).date, -29));
  const [to, setTo] = useState(() => utcToBusinessTime(new Date()).date);
  const range = { from, to };
  const report = useResource(["operational-report", from, to], () => operationalReportsApi.get(range));
  const time = useResource(["operational-time", from, to], () => timeApi.report(range));
  const leads = useResource(["operational-leads", from, to], () => leadsApi.dashboard(range));
  if (!allowed) return <p role="alert"><T id="operational-reports.operational-reports.you-do-not-have-access">You do not have access to operational reports.</T></p>;
  if (report.error || time.error || leads.error)
    return <LoadError message={report.error ?? time.error ?? leads.error ?? "Unable to load reports."} />;
  const data = report.data;
  const timeData = time.data;
  const leadData = leads.data;
  const rows: (string | number)[][] = [["Section", "Name", "Detail", "Count", "Value"],
    ...(timeData?.effort.map((r) => ["Event time", r.title, r.date, r.people, r.seconds]) ?? []),
    ...(timeData?.proposals.map((r) => ["Proposal time", r.title, r.eventTitle, r.people, r.seconds]) ?? []),
    ...(timeData?.workload.map((r) => ["Workload", r.userName ?? r.userId, r.activity, 0, r.seconds]) ?? []),
    ...(leadData?.bySource.map((r) => ["Lead source", r.source, `${r.converted} converted`, r.leads, r.estimatedClosedCents]) ?? []),
    ...(leadData?.byChannel.map((r) => ["Lead channel", r.channel, `${r.converted} converted`, r.leads, r.estimatedClosedCents]) ?? []),
    ...(data?.rentals.map((r) => ["Rental", r.name, r.itemId, r.reservations, r.quantity]) ?? []),
    ...(data?.orders.map((r) => ["Vendor spend", r.vendor, r.month, r.orders, r.spendCents]) ?? []),
  ];
  return <>
    <PageHeader title={<T id="operational-reports.operational-reports.operational-reports">Operational reports</T>} subtitle={<T id="operational-reports.operational-reports.time-leads-rental-use-and">Time, leads, rental use and purchasing</T>} />
    <div className="sales-actions">
      <label><T id="operational-reports.operational-reports.from">{"From "}</T><input aria-label="Report from" type="date" max={to} value={from} onChange={(e) => { if (e.target.value) setFrom(e.target.value); }} /></label>
      <label><T id="operational-reports.operational-reports.to">{"To "}</T><input aria-label="Report to" type="date" min={from} value={to} onChange={(e) => { if (e.target.value) setTo(e.target.value); }} /></label>
      <Button onClick={() => exportCsv(rows)} disabled={!data || !timeData || !leadData}><T id="operational-reports.operational-reports.export-csv">Export CSV</T></Button>
    </div>
    {!data || !timeData || !leadData ? <LoadingSkeleton /> : <>
      <Section title={<T id="operational-reports.operational-reports.time-per-event-and-proposal">Time per event and proposal</T>}><p><T id="operational-reports.operational-reports.events-proposals" values={{ count: timeData.effort.length, count2: timeData.proposals.length }}>{"{count} events · {count2} proposals"}</T></p>
        <ul>{timeData.effort.map((r) => <li key={r.eventId}><Link to={`/events/${r.eventId}`}>{r.title}</Link><T id="operational-reports.operational-reports.min" values={{ round: Math.round(r.seconds / 60) }}>{": {round} min"}</T></li>)}</ul>
        <ul>{timeData.proposals.map((r) => <li key={r.proposalId}><Link to={`/events/${r.eventId}?proposal=${r.proposalId}`}>{r.title}</Link><T id="operational-reports.operational-reports.min" values={{ round: Math.round(r.seconds / 60) }}>{": {round} min"}</T></li>)}</ul>
      </Section>
      <Section title={<T id="operational-reports.operational-reports.workload-by-person-and-activity">Workload by person and activity</T>}><ul>{timeData.workload.map((r) => <li key={`${r.userId}:${r.activity}`}><T id="operational-reports.operational-reports.min-2" values={{ value: r.userName ?? r.userId, activity: r.activity, round: Math.round(r.seconds / 60) }}>{"{value} · {activity}: {round} min"}</T></li>)}</ul></Section>
      <Section title={<T id="operational-reports.operational-reports.lead-source-and-channel">Lead source and channel</T>}><p><Link to="/leads/dashboard"><T id="operational-reports.operational-reports.explore-lead-dashboard">Explore lead dashboard</T></Link></p>
        <ul>{leadData.bySource.map((r) => <li key={r.source}><T id="operational-reports.operational-reports.leads-converted-estimated-closed-value" values={{ source: r.source, leads: r.leads, converted: r.converted, toFixed: (r.estimatedClosedCents / 100).toFixed(2) }}>{"{source}: {leads} leads, {converted} converted, ${toFixed} estimated closed value"}</T></li>)}</ul>
        <ul>{leadData.byChannel.map((r) => <li key={r.channel}><T id="operational-reports.operational-reports.leads-converted-estimated-closed-value-2" values={{ channel: r.channel, leads: r.leads, converted: r.converted, toFixed: (r.estimatedClosedCents / 100).toFixed(2) }}>{"{channel}: {leads} leads, {converted} converted, ${toFixed} estimated closed value"}</T></li>)}</ul>
      </Section>
      <Section title={<T id="operational-reports.operational-reports.rental-utilization">Rental utilization</T>}><ul>{data.rentals.map((r) => <li key={r.itemId}><Link to={`/inventory/${r.itemId}`}>{r.name}</Link><T id="operational-reports.operational-reports.reservations-units" values={{ reservations: r.reservations, quantity: r.quantity }}>{": {reservations} reservations, {quantity} units"}</T></li>)}</ul></Section>
      <Section title={<T id="operational-reports.operational-reports.order-spend-by-vendor-and">Order spend by vendor and month</T>}><ul>{data.orders.map((r) => <li key={`${r.vendor}:${r.month}`}><T id="operational-reports.operational-reports.orders" values={{ vendor: r.vendor, month: r.month, orders: r.orders, toFixed: (r.spendCents / 100).toFixed(2) }}>{"{vendor} · {month}: {orders} orders, ${toFixed}"}</T></li>)}</ul></Section>
    </>}
  </>;
}
