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
  if (!allowed) return <p role="alert">You do not have access to operational reports.</p>;
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
    <PageHeader title="Operational reports" subtitle="Time, leads, rental use and purchasing" />
    <div className="sales-actions">
      <label>From <input aria-label="Report from" type="date" max={to} value={from} onChange={(e) => { if (e.target.value) setFrom(e.target.value); }} /></label>
      <label>To <input aria-label="Report to" type="date" min={from} value={to} onChange={(e) => { if (e.target.value) setTo(e.target.value); }} /></label>
      <Button onClick={() => exportCsv(rows)} disabled={!data || !timeData || !leadData}>Export CSV</Button>
    </div>
    {!data || !timeData || !leadData ? <LoadingSkeleton /> : <>
      <Section title="Time per event and proposal"><p>{timeData.effort.length} events · {timeData.proposals.length} proposals</p>
        <ul>{timeData.effort.map((r) => <li key={r.eventId}><Link to={`/events/${r.eventId}`}>{r.title}</Link>: {Math.round(r.seconds / 60)} min</li>)}</ul>
        <ul>{timeData.proposals.map((r) => <li key={r.proposalId}><Link to={`/events/${r.eventId}?proposal=${r.proposalId}`}>{r.title}</Link>: {Math.round(r.seconds / 60)} min</li>)}</ul>
      </Section>
      <Section title="Workload by person and activity"><ul>{timeData.workload.map((r) => <li key={`${r.userId}:${r.activity}`}>{r.userName ?? r.userId} · {r.activity}: {Math.round(r.seconds / 60)} min</li>)}</ul></Section>
      <Section title="Lead source and channel"><p><Link to="/leads/dashboard">Explore lead dashboard</Link></p>
        <ul>{leadData.bySource.map((r) => <li key={r.source}>{r.source}: {r.leads} leads, {r.converted} converted, ${(r.estimatedClosedCents / 100).toFixed(2)} estimated closed value</li>)}</ul>
        <ul>{leadData.byChannel.map((r) => <li key={r.channel}>{r.channel}: {r.leads} leads, {r.converted} converted, ${(r.estimatedClosedCents / 100).toFixed(2)} estimated closed value</li>)}</ul>
      </Section>
      <Section title="Rental utilization"><ul>{data.rentals.map((r) => <li key={r.itemId}><Link to={`/inventory/${r.itemId}`}>{r.name}</Link>: {r.reservations} reservations, {r.quantity} units</li>)}</ul></Section>
      <Section title="Order spend by vendor and month"><ul>{data.orders.map((r) => <li key={`${r.vendor}:${r.month}`}>{r.vendor} · {r.month}: {r.orders} orders, ${(r.spendCents / 100).toFixed(2)}</li>)}</ul></Section>
    </>}
  </>;
}
