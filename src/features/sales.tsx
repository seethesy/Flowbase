import { Dropdown } from "../components/ui/Dropdown";
import { useState } from "react";
import { Link } from "react-router-dom";
import { StatusPill } from "../components/ui/status-pill";
import { pipelineLabels, pipelineStatusSchema } from "../../shared/pipeline";
import { filterSalesRows, salesCsv, salesFilterSchema, type SalesFilter, type SalesRow } from "../../shared/sales";
import { useResource } from "../app/useResource";
import { Button, EditableCell, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { salesApi } from "../services/sales";
import { proposalsApi } from "../services/proposals";
import { staffApi } from "../services/staff";
import { usePermissions } from "../app/permissions";
import { eventScope } from "../../shared/policy";
import "./sales.css";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy } from "../app/copy";

const dollars = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const day = (value: string | null) => value ? value.slice(0, 10) : "—";
const download = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
const path = (row: SalesRow) => row.kind === "lead" ? `/leads/${row.id}` : row.kind === "client" ? `/clients/${row.id}` : `/events/${row.eventId}${row.kind === "proposal" ? `?proposal=${row.id}` : ""}`;
const stageLabel = (stage: string) => {
  const parsed = pipelineStatusSchema.safeParse(stage);
  return parsed.success ? pipelineLabels[parsed.data] : stage;
};

// A proposal row's title and salesperson are edited in place (FLOW-261/275) and
// saved to the proposal itself, keeping its notes. Only managers whose scope is
// every event pick another salesperson; the API enforces both rules.
function useProposalEdits(reload: () => unknown) {
  const { actor, can } = usePermissions();
  const staff = useResource(["staff"], () => staffApi.list(), { reference: true });
  const canEdit = can("proposals.write");
  const canAssign = canEdit && actor !== null && eventScope(actor) === "all";
  const save = async (id: string, change: { title?: string; assignedSalespersonId?: string | null }) => {
    const current = await proposalsApi.get(id);
    await proposalsApi.update(id, {
      title: change.title ?? current.title,
      notes: current.notes,
      assignedSalespersonId: change.assignedSalespersonId !== undefined
        ? change.assignedSalespersonId : current.assignedSalesperson?.id ?? null,
    });
    reload();
  };
  const people = (staff.data ?? []).filter((member) => member.active)
    .map((member) => ({ value: member.id, label: member.name }));
  return { canEdit, canAssign, save, people };
}

export function SalesTracker() {
  const viewNamePlaceholder = useCopy("sales.sales-tracker.view-name.placeholder", "View name");
  const data = useResource(["sales", "rows"], salesApi.list);
  const edits = useProposalEdits(() => data.reload());
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
    <PageHeader title={<T id="sales.sales-tracker.sales-tracker">Sales tracker</T>} subtitle={<T id="sales.sales-tracker.open-leads-clients-events-and">Open leads, clients, events and proposals</T>} />
    <div className="sales-actions"><Link to="/sales/reports"><T id="sales.sales-tracker.sales-reports">Sales reports</T></Link><Button onClick={() => download("sales-tracker.csv", salesCsv(rows))}><T id="sales.sales-tracker.export-csv">Export CSV</T></Button></div>
    <div className="sales-filters" aria-label="Sales tracker filters">
      <label><T id="sales.sales-tracker.search">{"Search "}</T><input value={filter.search} onChange={(event) => patch({ search: event.target.value })} /></label>
      <label><T id="sales.sales-tracker.type">{"Type "}</T><Dropdown value={filter.kind} onChange={(event) => patch({ kind: event.target.value as SalesFilter["kind"] })}>
        {["all", "lead", "client", "event", "proposal"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </Dropdown></label>
      <label><T id="sales.sales-tracker.stage">{"Stage "}</T><Dropdown value={filter.stage} onChange={(event) => patch({ stage: event.target.value })}>
        <option value="">All stages</option>{[...new Set(data.data.rows.map((row) => row.stage))].sort().map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
      </Dropdown></label>
      <label><T id="sales.sales-tracker.salesperson">{"Salesperson "}</T><Dropdown value={filter.owner ?? ""} onChange={(event) => patch({ owner: event.target.value || undefined })}>
        <option value="">All salespeople</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Dropdown></label>
      <label><T id="sales.sales-tracker.sort">{"Sort "}</T><Dropdown value={filter.sort} onChange={(event) => patch({ sort: event.target.value as SalesFilter["sort"] })}>
        <option value="activity">Recent activity</option><option value="eventDate">Event date</option><option value="client">Client</option><option value="total">Total</option>
      </Dropdown></label>
      <label><RoundCheck checked={filter.history} onChange={(event) => patch({ history: event.target.checked })} /><T id="sales.sales-tracker.include-finished-and-lost-events">{" Include finished and lost events"}</T></label>
    </div>
    <div className="sales-actions">
      <label><T id="sales.sales-tracker.saved-views">{"Saved views "}</T><Dropdown aria-label="Saved views" value="" onChange={(event) => { const view = views.data?.find((item) => item.id === event.target.value); if (view) setFilter(view.filter); }}>
        <option value="">Choose a view</option>{views.data?.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
      </Dropdown></label>
      <input aria-label="New view name" placeholder={viewNamePlaceholder} data-copy-id="sales.sales-tracker.view-name.placeholder" maxLength={80} value={viewName} onChange={(event) => setViewName(event.target.value)} />
      <Button disabled={!viewName.trim()} onClick={async () => { try { await salesApi.saveView(viewName.trim(), filter); setViewName(""); views.reload(); } catch (cause) { setError((cause as Error).message); } }}><T id="sales.sales-tracker.save-view">Save view</T></Button>
      {views.data?.map((view) => <Button key={view.id} variant="outline" onClick={async () => { try { await salesApi.deleteView(view.id); views.reload(); } catch (cause) { setError((cause as Error).message); } }}><T id="sales.sales-tracker.delete" values={{ name: view.name }}>{"Delete {name}"}</T></Button>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <Section title={<T id="sales.sales-tracker.rows" values={{ rowsCount: rows.length }}>{"{rowsCount} rows"}</T>}><div className="sales-table-wrap"><table className="sales-table"><thead><tr><th><T id="sales.sales-tracker.type-2">Type</T></th><th><T id="sales.sales-tracker.client-record">Client / record</T></th><th><T id="sales.sales-tracker.event-date">Event date</T></th><th><T id="sales.sales-tracker.event-type">Event type</T></th><th><T id="sales.sales-tracker.stage-2">Stage</T></th><th><T id="sales.sales-tracker.salesperson-2">Salesperson</T></th><th><T id="sales.sales-tracker.source">Source</T></th><th><T id="sales.sales-tracker.total">Total</T></th><th><T id="sales.sales-tracker.balance-due">Balance due</T></th><th><T id="sales.sales-tracker.last-activity">Last activity</T></th><th><T id="sales.sales-tracker.next-follow-up">Next follow-up</T></th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.kind}:${row.id}`}><td>{row.kind}</td><td>{row.kind === "proposal" && edits.canEdit
        ? <><Link to={path(row)}>{row.client}</Link>{" · "}<EditableCell label="Proposal title" row={row} edit="text" value={row.title}
          save={(_row, value) => edits.save(row.id, { title: value })} /></>
        : <Link to={path(row)}>{row.client} · {row.title}</Link>}</td><td>{day(row.eventDate)}</td><td>{row.eventType || "—"}</td><td>{row.proposalStage ? <StatusPill status={row.proposalStage} /> : row.eventStatus ? <StatusPill status={row.eventStatus} /> : row.leadStatus ? <StatusPill status={row.leadStatus} /> : row.stage}{row.approvalStatus && <span className={`badge ${row.approvalStatus === "approved" ? "success" : "neutral"}`}>{row.approvalStatus}</span>}</td><td>{row.kind === "proposal" && edits.canAssign
        ? <EditableCell label="Salesperson" row={row} edit="select" value={row.ownerId ?? ""}
          options={[{ value: "", label: "Unassigned" }, ...edits.people,
            ...(row.ownerId && !edits.people.some((person) => person.value === row.ownerId) ? [{ value: row.ownerId, label: row.owner ?? "" }] : [])]}
          save={(_row, value) => edits.save(row.id, { assignedSalespersonId: value || null })} />
        : row.owner ?? "—"}</td><td>{row.source ?? "—"}</td><td>{dollars(row.totalCents)}</td><td>{dollars(row.balanceCents)}</td><td>{day(row.lastActivity)}</td><td>{day(row.nextFollowUp)}</td></tr>)}</tbody>
    </table></div></Section>
  </>;
}

export function ClientSalesTracker({ clientId }: { clientId: string }) {
  const data = useResource(["sales", "client", clientId], () => salesApi.client(clientId));
  if (data.error) return <LoadError message={data.error} />;
  if (!data.data) return <LoadingSkeleton />;
  return <Section title={<T id="sales.client-sales-tracker.client-proposal-tracker">Client proposal tracker</T>}>
    <p><T id="sales.client-sales-tracker.events-lifetime-booked-total" values={{ eventCount: data.data.eventCount, dollars: dollars(data.data.lifetimeBookedCents) }}>{"{eventCount} events · Lifetime booked total: {dollars}"}</T></p>
    {data.data.events.map((event) => <article className="sales-client-event" key={event.eventId}>
      <h3><Link to={`/events/${event.eventId}`}>{event.title}</Link></h3>
      <p>{day(event.eventDate)} · <StatusPill status={event.status} /> · <T id="sales.client-sales-tracker.booked" values={{ day: day(event.bookedAt) }}>{"Booked {day}"}</T></p>
      <p><T id="sales.client-sales-tracker.total-received-balance-due" values={{ dollars: dollars(event.totalCents), dollars2: dollars(event.receivedCents), dollars3: dollars(event.balanceCents) }}>{"Total {dollars} · Received {dollars2} · Balance due {dollars3}"}</T></p>
      {event.proposals.map((proposal) => <div key={proposal.id}>
        <Link to={`/events/${event.eventId}?proposal=${proposal.id}`}>{proposal.title}</Link> · <StatusPill status={proposal.stage} />
        <span><T id="sales.client-sales-tracker.versions">{" · Versions: "}</T>{proposal.versions.map((version) => `v${version.number} ${dollars(version.totalCents)}`).join(", ") || <T id="sales.client-sales-tracker.none">None</T>}</span>
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
  return <><PageHeader title={<T id="sales.sales-reports.sales-reports">Sales reports</T>} subtitle={<T id="sales.sales-reports.pipeline-booked-events-and-win">Pipeline, booked events and win rates</T>} />
    <p><Link to="/sales"><T id="sales.sales-reports.sales-tracker">← Sales tracker</T></Link></p>
    <div className="sales-actions"><label><T id="sales.sales-reports.from">{"From "}</T><input aria-label="Report from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); if (to && event.target.value > to) setTo(""); }} /></label><label><T id="sales.sales-reports.to">{"To "}</T><input aria-label="Report to" type="date" value={to} onChange={(event) => { setTo(event.target.value); if (from && event.target.value < from) setFrom(""); }} /></label><Button onClick={() => download("sales-reports.csv", csv)}><T id="sales.sales-reports.export-csv">Export CSV</T></Button></div>
    <Section title={<T id="sales.sales-reports.pipeline-by-proposal-stage">Pipeline by proposal stage</T>}><table className="sales-table"><thead><tr><th><T id="sales.sales-reports.stage">Stage</T></th><th><T id="sales.sales-reports.count">Count</T></th><th><T id="sales.sales-reports.total">Total</T></th></tr></thead><tbody>{report.pipeline.map((row) => <tr key={row.stage}><td><StatusPill status={row.stage} /></td><td>{row.count}</td><td>{dollars(row.totalCents)}</td></tr>)}</tbody></table></Section>
    <Section title={<T id="sales.sales-reports.booked-total-by-event-month">Booked total by event month</T>}><table className="sales-table"><thead><tr><th><T id="sales.sales-reports.month">Month</T></th><th><T id="sales.sales-reports.events">Events</T></th><th><T id="sales.sales-reports.total">Total</T></th></tr></thead><tbody>{report.bookedByMonth.map((row) => <tr key={row.month}><td>{row.month}</td><td>{row.count}</td><td>{dollars(row.totalCents)}</td></tr>)}</tbody></table></Section>
    {(["winBySalesperson", "winBySource"] as const).map((key) => <Section key={key} title={key === "winBySource" ? <T id="sales.sales-reports.win-rate-by-lead-source">Win rate by lead source</T> : <T id="sales.sales-reports.win-rate-by-salesperson">Win rate by salesperson</T>}><table className="sales-table"><thead><tr><th>{key === "winBySource" ? <T id="sales.sales-reports.source">Source</T> : <T id="sales.sales-reports.salesperson">Salesperson</T>}</th><th><T id="sales.sales-reports.wins">Wins</T></th><th><T id="sales.sales-reports.decided">Decided</T></th><th><T id="sales.sales-reports.win-rate">Win rate</T></th></tr></thead><tbody>{report[key].map((row) => <tr key={"source" in row ? row.source : row.owner}><td>{"source" in row ? row.source : row.owner}</td><td>{row.wins}</td><td>{row.decided}</td><td>{row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}</td></tr>)}</tbody></table></Section>)}
  </>;
}
