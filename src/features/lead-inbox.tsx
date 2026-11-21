import { Dropdown } from "../components/ui/Dropdown";
import { Allowed } from "../app/permissions";
import { Fragment, useEffect, useRef, useState } from "react";
import { utcToBusinessTime } from "../../shared/time";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { StatusSelect } from "../components/ui/status-pill";
import { Link, useNavigate } from "react-router-dom";
import {
  leadStatusLabels,
  leadStatusSchema,
  type Lead,
  type LeadSummary,
} from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { loadEveryPage, useDebounced } from "../app/paging";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  Section,
  LoadingSkeleton,
  Select,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { useListLabels } from "./list-fields";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
import { NewLeadForm } from "./lead-entry";
import {
  AssignForm,
  businessDate,
  leadTitle,
  valueOf,
} from "./lead-shared";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy, LabelT, Plural } from "../app/copy";
import { copySlug } from "../../shared/copy";
import type { JSONContent } from "@tiptap/core";
import { RichTextEditor } from "../components/rich-text/RichTextEditor";
import { emptyRichText } from "../components/rich-text/extensions";

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

function InlineCell({ value, type = "text", label, onSave }: {
  value: string; type?: "text" | "email" | "datetime-local";
  label: string; onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const finish = () => {
    setEditing(false);
    if (!cancelled.current && draft !== value) onSave(draft);
    cancelled.current = false;
  };
  return editing ? <input className="lead-inline-input" aria-label={label} autoFocus type={type}
    value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={finish}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { cancelled.current = true; setDraft(value); event.currentTarget.blur(); } }} /> :
    <button type="button" className="lead-inline-display" onClick={() => { setDraft(value); setEditing(true); }}>{value || "—"}</button>;
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
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [anchor, setAnchor] = useState(-1);
  const userId = useAuth()?.user.id ?? "anonymous";
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem(`flowbase.leads.page-size.${userId}`)) || 25);
  const [pageNumber, setPageNumber] = useState(1);
  useEffect(() => { setPageSize(Number(localStorage.getItem(`flowbase.leads.page-size.${userId}`)) || 25); }, [userId]);
  useEffect(() => { setPageNumber(1); }, [status, source, owner, search]);
  useEffect(() => { const end = () => setSelecting(false); window.addEventListener("pointerup", end); return () => window.removeEventListener("pointerup", end); }, []);
  const [closing, setClosing] = useState<Lead | null>(null);
  const [editingNotes, setEditingNotes] = useState<Lead | null>(null);
  const [notesDraft, setNotesDraft] = useState<JSONContent>(emptyRichText);
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
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const save = async (lead: Lead, input: Parameters<typeof leadsApi.update>[1]) => {
    try { setError(""); await leadsApi.update(lead.id, input); leads.reload(); return true; }
    catch (cause) { setError((cause as Error).message); return false; }
  };
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
  const editable = (lead: Lead, key: "name" | "eventName" | "phone" | "email", value: string) =>
    <InlineCell key={`${lead.id}-${key}`} value={value} label={`${key} for ${lead.name}`}
      type={key === "email" ? "email" : "text"} onSave={(next) => void save(lead, { [key]: next })} />;
  return <>
    <PageHeader title={<T id="leads.inbox.title">Leads</T>} subtitle={<T id="leads.inbox.subtitle">Every inquiry from every source, in one place.</T>} eyebrow={<T id="leads.inbox.eyebrow">Leads</T>}>
      <Allowed action="leads.create"><Button onClick={() => setEntering(true)}><T id="leads.inbox.new-lead">New lead</T></Button></Allowed>
      <Button variant="outline" asChild><Link to="/leads/dashboard"><T id="leads.inbox.lead-dashboard">Lead dashboard</T></Link></Button>
    </PageHeader>
    <>
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
      {selected.length > 0 && <Section title={<Plural id="leads.inbox.selected-count" count={selected.length} one="{count} selected" other="{count} selected" />}>
        <Allowed action="leads.assign"><AssignForm label={<T id="leads.inbox.assign-selected-to">Assign selected to</T>} button={<T id="leads.inbox.assign-selected">Assign selected</T>}
          onAssign={async (id) => { await leadsApi.bulkAssign(selected, id); setSelected([]); leads.reload(); }} /></Allowed>
        <Dropdown aria-label="Change selected status" defaultValue="" onChange={async (event) => {
          const next = event.target.value as Lead["status"];
          if (!next) return;
          const reason = next === "lost" ? window.prompt("Why were these leads lost?") : "";
          if (next === "lost" && !reason?.trim()) return;
          try { await Promise.all(selected.map((id) => leadsApi.setStatus(id, { status: next, reason: reason ?? "" }))); setSelected([]); leads.reload(); }
          catch (cause) { setError((cause as Error).message); }
        }}><option value="">Change status</option>{leadStatusSchema.options.filter((value) => value !== "closing" && value !== "closed")
          .map((value) => <option key={value} value={value}>{leadStatusLabels[value]}</option>)}</Dropdown>
      </Section>}
      {leads.error ? <LoadError message={leads.error} /> : leads.loading && !leads.data ? <LoadingSkeleton /> :
        <div className="table-card"><div className="table-scroll"><table className="lead-pipeline-table">
          <thead><tr>{["Open", "Status", "Last updated", "Client", "Event", "Phone", "Email", "Time & Date", "Notes", "Source", "Proposal"].map((heading) => <th key={heading}><T id={`leads.inbox.column.${copySlug(heading)}`}>{heading}</T></th>)}</tr></thead>
          <tbody>{shown.map((lead, index) => <tr key={lead.id}
            className={lead.needsReview || lead.possibleDuplicate ? "lead-needs-review" : ""}
            onPointerDown={(event) => { if ((event.target as HTMLElement).closest("input,button,a,select")) return;
              setAnchor(index); setSelecting(true); }}
            onPointerEnter={() => { if (selecting && anchor >= 0 && anchor !== index)
              setSelected(shown.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((row) => row.id)); }}
            onClick={(event) => { if ((event.target as HTMLElement).closest("input,button,a,select")) return;
              if (event.shiftKey && anchor >= 0) setSelected(shown.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((row) => row.id));
              else if (event.ctrlKey || event.metaKey) { toggle(lead.id); setAnchor(index); } }}>
            <td><span className="lead-open-cell"><RoundCheck aria-label={`Select ${leadTitle(lead)}`} checked={selected.includes(lead.id)}
              onPointerDown={() => setSelecting(true)} onChange={() => toggle(lead.id)} />
              <Link to={`/leads/${lead.id}`} aria-label={`Open ${leadTitle(lead)}`}><T id="leads.inbox.open">Open</T></Link></span></td>
            <td><StatusSelect label={`Status for ${leadTitle(lead)}`} value={lead.status} onChange={(value) => void changeStatus(lead, value as Lead["status"])} /></td>
            <td>{businessDate(lead.updatedAt)}</td>
            <td>{editable(lead, "name", lead.name)}{(lead.needsReview || lead.possibleDuplicate) &&
              <span className="badge warning" title={lead.possibleDuplicate ? "Possible duplicate" : "Needs review"}><T id="leads.inbox.needs-review">Needs review</T></span>}</td>
            <td>{editable(lead, "eventName", lead.latestEvent?.title ?? lead.eventName ?? "")}</td>
            <td>{editable(lead, "phone", lead.phone)}</td>
            <td>{editable(lead, "email", lead.email)}</td>
            <td>{lead.latestEvent ? <InlineCell key={`${lead.id}-date`} label={`Time and date for ${lead.name}`}
              type="datetime-local" value={`${utcToBusinessTime(new Date(lead.latestEvent.startsAt)).date}T${utcToBusinessTime(new Date(lead.latestEvent.startsAt)).time}`}
              onSave={(next) => { if (next) void save(lead, { eventDate: next.slice(0, 10), eventTime: next.slice(11, 16) }); }} /> :
              <InlineCell key={`${lead.id}-date`} label={`Date for ${lead.name}`} type="datetime-local"
                value={lead.eventDate ? `${lead.eventDate}T00:00` : ""}
                onSave={(next) => void save(lead, { eventDate: next ? next.slice(0, 10) : null })} />}</td>
            <td><button type="button" onClick={() => { setEditingNotes(lead); setNotesDraft(lead.notes ?? emptyRichText); }}>{lead.notes ? <T id="leads.inbox.view-notes">View notes</T> : <T id="leads.inbox.add-notes">Add notes</T>}</button></td>
            <td>{lead.source}</td>
            <td>{lead.latestProposal ? <Link to={`/events/${lead.latestProposal.eventId}?proposal=${lead.latestProposal.id}`}>{lead.latestProposal.title}</Link> : "—"}</td>
          </tr>)}</tbody>
        </table></div></div>}
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
    </>
    {entering && <NewLeadForm onClose={() => setEntering(false)} onCreated={() => leads.reload()} />}
    {editingNotes && <div className="lead-notes-overlay" role="dialog" aria-modal="true" aria-label={`Notes for ${editingNotes.name}`}>
      <form className="lead-notes-dialog" onSubmit={async (event) => {
        event.preventDefault(); if (await save(editingNotes, { notes: notesDraft })) setEditingNotes(null);
      }}><h2><T id="leads.inbox.edit-notes">Edit notes</T></h2>
        <RichTextEditor label="Lead notes" value={notesDraft} onChange={setNotesDraft} />
        <Button type="submit"><T id="leads.inbox.save-notes">Save notes</T></Button>
        <Button type="button" variant="outline" onClick={() => setEditingNotes(null)}><T id="leads.inbox.cancel-notes">Cancel</T></Button>
      </form></div>}
    {closing && <ConvertLeadForm lead={closing} onClose={() => setClosing(null)} onConverted={(result) => navigate(`/events/${result.event.id}`)} />}
  </>;
}

