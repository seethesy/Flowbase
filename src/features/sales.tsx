import { useState } from "react";
import { Link } from "react-router-dom";
import { proposalStageLabels } from "../../shared/proposals";
import { filterSalesRows, salesCsv, salesFilterSchema, type SalesFilter, type SalesRow } from "../../shared/sales";
import { useResource } from "../app/useResource";
import { Button, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { salesApi } from "../services/sales";
import "./sales.css";

const dollars = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const day = (value: string | null) => value ? value.slice(0, 10) : "—";
const download = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
const path = (row: SalesRow) => row.kind === "lead" ? `/leads/${row.id}` : row.kind === "client" ? `/clients/${row.id}` : `/events/${row.eventId}${row.kind === "proposal" ? `?proposal=${row.id}` : ""}`;

export function SalesTracker() {
  const data = useResource(["sales", "rows"], salesApi.list);
  const views = useResource(["sales", "views"], salesApi.views);
  const [filter, setFilter] = useState<SalesFilter>(salesFilterSchema.parse({}));
  const [viewName, setViewName] = useState("");
  const [error, setError] = useState("");
  if (data.error) return <LoadError message={data.error} />;
  if (!data.data) return <LoadingSkeleton />;
  const rows = filterSalesRows(data.data.rows, filter);
  const owners = [...new Map(data.data.rows.filter((row) => row.ownerId).map((row) => [row.ownerId!, row.owner ?? "Unassigned"] as const)).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const patch = (value: Partial<SalesFilter>) => setFilter({ ...filter, ...value });
  return <>
    <PageHeader title="Sales tracker" subtitle="Open leads, clients, events and proposals" />
    <div className="sales-actions"><Link to="/sales/reports">Sales reports</Link><Button onClick={() => download("sales-tracker.csv", salesCsv(rows))}>Export CSV</Button></div>
    <div className="sales-filters" aria-label="Sales tracker filters">
      <label>Search <input value={filter.search} onChange={(event) => patch({ search: event.target.value })} /></label>
      <label>Type <select value={filter.kind} onChange={(event) => patch({ kind: event.target.value as SalesFilter["kind"] })}>
        {["all", "lead", "client", "event", "proposal"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select></label>
      <label>Stage <select value={filter.stage} onChange={(event) => patch({ stage: event.target.value })}>
        <option value="">All stages</option>{[...new Set(data.data.rows.map((row) => row.stage))].sort().map((stage) => <option key={stage} value={stage}>{stage}</option>)}
      </select></label>
      <label>Salesperson <select value={filter.owner ?? ""} onChange={(event) => patch({ owner: event.target.value || undefined })}>
        <option value="">All salespeople</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Sort <select value={filter.sort} onChange={(event) => patch({ sort: event.target.value as SalesFilter["sort"] })}>
        <option value="activity">Recent activity</option><option value="eventDate">Event date</option><option value="client">Client</option><option value="total">Total</option>
      </select></label>
      <label><input type="checkbox" checked={filter.history} onChange={(event) => patch({ history: event.target.checked })} /> Include finished and lost events</label>
    </div>
    <div className="sales-actions">
      <label>Saved views <select aria-label="Saved views" value="" onChange={(event) => { const view = views.data?.find((item) => item.id === event.target.value); if (view) setFilter(view.filter); }}>
        <option value="">Choose a view</option>{views.data?.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select></label>
      <input aria-label="New view name" placeholder="View name" maxLength={80} value={viewName} onChange={(event) => setViewName(event.target.value)} />
      <Button disabled={!viewName.trim()} onClick={async () => { try { await salesApi.saveView(viewName.trim(), filter); setViewName(""); views.reload(); } catch (cause) { setError((cause as Error).message); } }}>Save view</Button>
      {views.data?.map((view) => <Button key={view.id} variant="outline" onClick={async () => { try { await salesApi.deleteView(view.id); views.reload(); } catch (cause) { setError((cause as Error).message); } }}>Delete {view.name}</Button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <Section title={`${rows.length} rows`}><div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Type</th><th>Client / record</th><th>Event date</th><th>Event type</th><th>Stage</th><th>Salesperson</th><th>Source</th><th>Total</th><th>Balance due</th><th>Last activity</th><th>Next follow-up</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.kind}:${row.id}`}><td>{row.kind}</td><td><Link to={path(row)}>{row.client} · {row.title}</Link></td><td>{day(row.eventDate)}</td><td>{row.eventType || "—"}</td><td>{row.proposalStage ? proposalStageLabels[row.proposalStage] : row.stage}</td><td>{row.owner ?? "—"}</td><td>{row.source ?? "—"}</td><td>{dollars(row.totalCents)}</td><td>{dollars(row.balanceCents)}</td><td>{day(row.lastActivity)}</td><td>{day(row.nextFollowUp)}</td></tr>)}</tbody>
    </table></div></Section>
  </>;
}

export function ClientSalesTracker({ clientId }: { clientId: string }) {
  const data = useResource(["sales", "client", clientId], () => salesApi.client(clientId));
  if (data.error) return <LoadError message={data.error} />;
  if (!data.data) return <LoadingSkeleton />;
  return <Section title="Client proposal tracker">
    <p>{data.data.eventCount} events · Lifetime booked total: {dollars(data.data.lifetimeBookedCents)}</p>
    {data.data.events.map((event) => <article className="sales-client-event" key={event.eventId}>
      <h3><Link to={`/events/${event.eventId}`}>{event.title}</Link></h3>
      <p>{day(event.eventDate)} · {event.status} · Booked {day(event.bookedAt)}</p>
      <p>Total {dollars(event.totalCents)} · Received {dollars(event.receivedCents)} · Balance due {dollars(event.balanceCents)}</p>
      {event.proposals.map((proposal) => <div key={proposal.id}>
        <Link to={`/events/${event.eventId}?proposal=${proposal.id}`}>{proposal.title}</Link> · {proposalStageLabels[proposal.stage]}
        <span> · Versions: {proposal.versions.map((version) => `v${version.number} ${dollars(version.totalCents)}`).join(", ") || "None"}</span>
      </div>)}
    </article>)}
  </Section>;
}

export function SalesReports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const data = useResource(["sales", "reports", from, to], () => salesApi.report({ from, to }));
  if (data.error) return <LoadError message={data.error} />;
  if (!data.data) return <LoadingSkeleton />;
  const report = data.data;
  const reportRows: (string | number | null)[][] = [["Section", "Name", "Count", "Total", "Rate"],
    ...report.pipeline.map((row) => ["Pipeline", row.stage, row.count, row.totalCents / 100, null]),
    ...report.bookedByMonth.map((row) => ["Booked", row.month, row.count, row.totalCents / 100, null]),
    ...report.winBySalesperson.map((row) => ["Salesperson", row.owner, row.decided, null, row.rate]),
    ...report.winBySource.map((row) => ["Source", row.source, row.decided, null, row.rate])];
  const csv = reportRows.map((row) => row.map((value) => {
    const content = String(value ?? "");
    const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(content) ? `'${content}` : content;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
  return <><PageHeader title="Sales reports" subtitle="Pipeline, booked events and win rates" />
    <p><Link to="/proposals">← Sales tracker</Link></p>
    <div className="sales-actions"><label>From <input aria-label="Report from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); if (to && event.target.value > to) setTo(""); }} /></label><label>To <input aria-label="Report to" type="date" value={to} onChange={(event) => { setTo(event.target.value); if (from && event.target.value < from) setFrom(""); }} /></label><Button onClick={() => download("sales-reports.csv", csv)}>Export CSV</Button></div>
    <Section title="Pipeline by proposal stage"><table className="sales-table"><thead><tr><th>Stage</th><th>Count</th><th>Total</th></tr></thead><tbody>{report.pipeline.map((row) => <tr key={row.stage}><td>{proposalStageLabels[row.stage]}</td><td>{row.count}</td><td>{dollars(row.totalCents)}</td></tr>)}</tbody></table></Section>
    <Section title="Booked total by event month"><table className="sales-table"><thead><tr><th>Month</th><th>Events</th><th>Total</th></tr></thead><tbody>{report.bookedByMonth.map((row) => <tr key={row.month}><td>{row.month}</td><td>{row.count}</td><td>{dollars(row.totalCents)}</td></tr>)}</tbody></table></Section>
    {(["winBySalesperson", "winBySource"] as const).map((key) => <Section key={key} title={key === "winBySource" ? "Win rate by lead source" : "Win rate by salesperson"}><table className="sales-table"><thead><tr><th>{key === "winBySource" ? "Source" : "Salesperson"}</th><th>Wins</th><th>Decided</th><th>Win rate</th></tr></thead><tbody>{report[key].map((row) => <tr key={"source" in row ? row.source : row.owner}><td>{"source" in row ? row.source : row.owner}</td><td>{row.wins}</td><td>{row.decided}</td><td>{row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}</td></tr>)}</tbody></table></Section>)}
  </>;
}
