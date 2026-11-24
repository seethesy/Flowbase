import { useDeletable } from "../../app/live-edit/deletable";
import { Dropdown } from "../../components/ui/Dropdown";
import { Allowed } from "../../app/permissions";
import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { utcToBusinessTime } from "../../../shared/time";
import { useAuth } from "../../app/auth";
import { useResource } from "../../app/useResource";
import { StatusSelect } from "../../components/ui/status-pill";
import { Link, useNavigate } from "react-router-dom";
import {
  leadStatusLabels,
  leadStatusSchema,
  type Lead,
  type LeadSummary,
} from "../../../shared/leads";
import { fieldDef } from "../../../shared/fields";
import { leadsApi } from "../../services/leads";
import { loadEveryPage, useDebounced } from "../../app/paging";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  LoadingSkeleton,
  Select,
  useTableSelection,
  ColumnResizeHandle,
  DateTimeCell,
  fromRowControl,
} from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { useListLabels } from "../common/list-fields";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
import { NewLeadForm } from "./lead-entry";
import {
  AssignForm,
  businessDate,
  leadTitle,
  valueOf,
} from "./lead-shared";
import { T, useCopy, LabelT } from "../../app/copy";
import { copySlug } from "../../../shared/copy";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { TableLayout } from "../../app/live-edit/table-layout";
import { FieldLabel, FieldValue } from "../../components/layout-fields";
import type { JSONContent } from "@tiptap/core";

// A lead's one-line summary, with its labels editable (FLOW-257).
export function SummaryLine({ lead }: { lead: LeadSummary }) {
  return (
    <>
      {[
        lead.source,
        businessDate(lead.receivedAt),
        <LabelT id="labels.pipeline-status" value={lead.status}>{leadStatusLabels[lead.status]}</LabelT>,
        lead.assignedSalespersonId ?? <T id="lead-inbox.summary-line.unassigned">Unassigned</T>,
      ].map((part, index) => <Fragment key={index}>{index > 0 && " · "}{part}</Fragment>)}
    </>
  );
}

// Notes are edited on the lead page; the table shows the start of the text.
function notesText(node: JSONContent | null | undefined): string {
  if (!node) return "";
  return [node.text ?? "", ...(node.content ?? []).map(notesText)].join(node.type === "paragraph" ? " " : "").trim();
}

// The shared pipeline table. A lead can have several events; the detail lists all
// of them while this table shows the lead's latest event name and date.
export function LeadInbox() {
  const searchPlaceholder = useCopy("leads.inbox.search-placeholder", "Search leads");
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");
  const userId = useAuth()?.user.id ?? "anonymous";
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem(`flowbase.leads.page-size.${userId}`)) || 25);
  const [pageNumber, setPageNumber] = useState(1);
  useEffect(() => { setPageSize(Number(localStorage.getItem(`flowbase.leads.page-size.${userId}`)) || 25); }, [userId]);
  useEffect(() => { setPageNumber(1); }, [status, source, owner, search]);
  const [closing, setClosing] = useState<Lead | null>(null);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState("");
  const term = useDebounced(search.trim());
  const owners = useResource(["lead-owners"], leadsApi.owners);
  const leads = useResource(["leads", "table", status, source, owner, term],
    () => loadEveryPage((cursor) =>
      leadsApi.list({
        status: status || undefined, source: source || undefined, assigned: owner || undefined,
        search: term || undefined }, cursor)));
  const data = leads.data ?? [];
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));
  const shown = data.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const listedSources = useListLabels("lead_source");
  const sources = [...new Set([...listedSources, ...data.map((lead) => lead.source)])];
  const changeStatus = async (lead: Lead, next: Lead["status"]) => {
    if (next === "closing") { setClosing(lead); return; }
    if (next === "lost") {
      const reason = window.prompt("Why was this lead lost?");
      if (!reason?.trim()) return;
      try { await leadsApi.setStatus(lead.id, { status: next, reason }); leads.reload(); }
      catch (cause) { setError((cause as Error).message); }
      return;
    }
    try { await leadsApi.setStatus(lead.id, { status: next }); leads.reload(); }
    catch (cause) { setError((cause as Error).message); }
  };
  // FLOW-260 selection: drag, Shift+click and Ctrl/Cmd+click select rows instead
  // of opening them. Closing and Closed aren't offered in bulk (they need a client).
  const deletable = useDeletable("lead", () => leads.reload());
  const selection = useTableSelection({
    ...deletable,
    actions: (ids, clear) => <>
      <Allowed action="leads.assign"><AssignForm label={<T id="leads.inbox.assign-selected-to">Assign selected to</T>} button={<T id="leads.inbox.assign-selected">Assign selected</T>}
        onAssign={async (owner) => { await leadsApi.bulkAssign(ids, owner); clear(); leads.reload(); }} /></Allowed>
      <Dropdown variant="dark" aria-label="Change selected status" value="" onChange={async (event) => {
        const next = event.target.value as Lead["status"];
        if (!next) return;
        const reason = next === "lost" ? window.prompt("Why were these leads lost?") : "";
        if (next === "lost" && !reason?.trim()) return;
        try { await Promise.all(ids.map((id) => leadsApi.setStatus(id, { status: next, reason: reason ?? "" }))); clear(); leads.reload(); }
        catch (cause) { setError((cause as Error).message); }
      }}><option value="">Change status</option>{leadStatusSchema.options.filter((value) => value !== "closing" && value !== "closed")
        .map((value) => <option key={value} value={value}>{leadStatusLabels[value]}</option>)}</Dropdown>
    </>,
  }, shown.map((lead) => lead.id));
  // A click anywhere on a row opens the lead, except on the Status cell and the
  // row's controls, including a dropdown menu they opened (FLOW-296).
  const openRow = (lead: Lead, event: MouseEvent<HTMLTableRowElement>) => {
    if (fromRowControl(event) || (event.target as HTMLElement).closest(".lead-status-cell")) return;
    navigate(`/leads/${lead.id}`);
  };
  // The table's code columns (FLOW-254) remain configurable while row
  // selection and navigation use the same behavior for every visible column.
  const leadColumns: { key: string; heading: string; cell: (lead: Lead) => ReactNode }[] = [
    { key: "status", heading: "Status", cell: (lead) => <StatusSelect label={`Status for ${leadTitle(lead)}`} value={lead.status} onChange={(value) => void changeStatus(lead, value as Lead["status"])} /> },
    { key: "updatedAt", heading: "Last updated", cell: (lead) => businessDate(lead.updatedAt) },
    { key: "name", heading: "Client", cell: (lead) => <><Link className="lead-client-link" draggable={false} to={`/leads/${lead.id}`}>{leadTitle(lead)}</Link>{(lead.needsReview || lead.possibleDuplicate) &&
      <span className="badge warning" title={lead.possibleDuplicate ? "Possible duplicate" : "Needs review"}><T id="leads.inbox.needs-review">Needs review</T></span>}</> },
    { key: "eventName", heading: "Event", cell: (lead) => lead.latestEvent?.title ?? lead.eventName ?? "—" },
    { key: "phone", heading: "Phone", cell: (lead) => lead.phone || "—" },
    { key: "email", heading: "Email", cell: (lead) => lead.email || "—" },
    { key: "eventDate", heading: "Time & Date", cell: (lead) => {
      const startsAt = lead.latestEvent ? utcToBusinessTime(new Date(lead.latestEvent.startsAt)) : null;
      // FLOW-296: the date with the time beneath it.
      return startsAt ? <DateTimeCell date={startsAt.date} time={startsAt.time} /> : lead.eventDate ?? "—";
    } },
    { key: "notes", heading: "Notes", cell: (lead) => notesText(lead.notes) || "—" },
    { key: "source", heading: "Source", cell: (lead) => lead.source },
    { key: "latestProposal", heading: "Proposal", cell: (lead) => lead.latestProposal ? <Link draggable={false} to={`/events/${lead.latestProposal.eventId}?proposal=${lead.latestProposal.id}`}>{lead.latestProposal.title}</Link> : "—" },
    { key: "latestBeo", heading: "BEO", cell: (lead) => lead.latestBeo ? <Link draggable={false} to={`/events/${lead.latestBeo.eventId}/beo/${lead.latestBeo.id}`}><T id="leads.inbox.beo-version" values={{ version: lead.latestBeo.version }}>{"BEO v{version}"}</T></Link> : "—" },
  ];
  return <>
    <PageHeader pageKey="leads.inbox" title={<T id="leads.inbox.title">Leads</T>} subtitle={<T id="leads.inbox.subtitle">Every inquiry from every source, in one place.</T>} eyebrow={<T id="leads.inbox.eyebrow">Leads</T>}>
      <Allowed action="leads.create"><Button onClick={() => setEntering(true)}><T id="leads.inbox.new-lead">New lead</T></Button></Allowed>
      <Button variant="outline" asChild><Link to="/leads/dashboard"><T id="leads.inbox.lead-dashboard">Lead dashboard</T></Link></Button>
    </PageHeader>
    <PageGrid pageKey="leads.inbox">
    <Block id="lead-table" name="Leads table" h={24}>
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} copyId="leads.inbox.search-placeholder" />
        <label><T id="leads.inbox.owners">Owners </T><Dropdown aria-label="Owners" value={owner} onChange={(event) => setOwner(event.target.value)}>
          <option value="">All owners</option><option value="unassigned">Unassigned</option>{owners.data?.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </Dropdown></label>
        <Select label="Statuses" value={status ? leadStatusLabels[status as Lead["status"]] : ""} onChange={(label) => setStatus(valueOf(leadStatusLabels, label) ?? "")}
          options={leadStatusSchema.options.map((value) => leadStatusLabels[value])} />
        <Select label="Sources" value={source} onChange={setSource} options={sources} />
        <span className="result-count"><T id="leads.inbox.lead-count" values={{ count: data.length }}>{"{count} leads"}</T></span>
      </FilterBar>
      {error && <p role="alert" className="error-message">{error}</p>}
      {selection.bar}
      {leads.error ? <LoadError message={leads.error} /> : leads.loading && !leads.data ? <LoadingSkeleton /> :
        <TableLayout tableKey="leads.inbox.table" codeColumns={leadColumns.map((column) => ({ key: column.key, header: column.heading }))}>
          {(layout) => {
            const visible: { key: string; width?: number }[] = layout.custom ? layout.columns : leadColumns.map((column) => ({ key: column.key }));
            const code = (key: string) => leadColumns.find((column) => column.key === key);
            return <>
              {layout.editor && <div className="table-toolbar">{layout.editor}</div>}
              <div className={["table-card", selection.dragging ? "is-selecting" : ""].filter(Boolean).join(" ")} tabIndex={0} onKeyDown={selection.onKeyDown}><div className="table-scroll"><table className="lead-pipeline-table">
                <thead><tr>{visible.map((column) => {
                  const heading = code(column.key)?.heading;
                  return <th key={column.key} style={column.width ? { width: column.width } : undefined} className={layout.resize ? "column-resizable" : undefined}>
                    {heading ? <T id={`leads.inbox.column.${copySlug(heading)}`}>{heading}</T> : <FieldLabel source="leads" field={column.key} />}
                    {layout.resize && <ColumnResizeHandle label={heading ?? fieldDef("leads", column.key)?.label ?? column.key} onResize={(width) => layout.resize?.(column.key, width)} />}</th>;
                })}</tr></thead>
                <tbody {...selection.bodyProps}>{shown.map((lead, index) => {
                  const row = selection.rowProps(index);
                  return <tr key={lead.id} {...row}
                    className={[row.className, "lead-row", lead.needsReview || lead.possibleDuplicate ? "lead-needs-review" : ""].filter(Boolean).join(" ")}
                    onClick={(event) => openRow(lead, event)}
                    onAuxClick={(event) => { if (event.button === 1 && !fromRowControl(event)) window.open(`#/leads/${lead.id}`, "_blank", "noopener"); }}>
                    {visible.map((column) => <td key={column.key} className={column.key === "status" ? "lead-status-cell" : column.key === "notes" ? "lead-notes-cell" : undefined}>
                      {code(column.key)?.cell(lead) ?? <FieldValue source="leads" field={column.key} row={lead as unknown as Record<string, unknown>} />}
                    </td>)}
                  </tr>;
                })}</tbody>
              </table></div></div>
            </>;
          }}
        </TableLayout>}
      <div className="lead-pager"><label><T id="leads.inbox.rows-per-page">Rows per page </T><Dropdown value={pageSize} onChange={(event) => {

        const size = Number(event.target.value); setPageSize(size); setPageNumber(1);
        localStorage.setItem(`flowbase.leads.page-size.${userId}`, String(size));
      }}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</Dropdown></label>
        <span><T id="leads.inbox.page-range" values={{ start: data.length ? (pageNumber - 1) * pageSize + 1 : 0, end: Math.min(pageNumber * pageSize, data.length), total: data.length }}>{"{start}–{end} of {total}"}</T></span>
        <button type="button" disabled={pageNumber === 1} onClick={() => setPageNumber(pageNumber - 1)}><T id="leads.inbox.previous">Previous</T></button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) =>
          <button type="button" key={number} aria-current={number === pageNumber ? "page" : undefined}
            onClick={() => setPageNumber(number)}>{number}</button>)}
        <button type="button" disabled={pageNumber === pageCount} onClick={() => setPageNumber(pageNumber + 1)}><T id="leads.inbox.next">Next</T></button>
      </div>
    </Block>
    </PageGrid>
    {entering && <NewLeadForm onClose={() => setEntering(false)} onCreated={() => leads.reload()} />}
    {closing && <ConvertLeadForm lead={closing} onClose={() => setClosing(null)} onConverted={(result) => navigate(`/events/${result.event.id}`)} />}
    {selection.toast}
  </>;
}

