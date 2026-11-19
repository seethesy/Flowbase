import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRightLeft } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  leadChannelLabels,
  leadDuplicateReasonLabels,
  leadChannelSchema,
  leadStatusLabels,
  leadStatusSchema,
  type Lead,
  type LeadDuplicate,
  type LeadSummary,
} from "../../shared/leads";
import type { Page } from "../services/core";
import { leadsApi } from "../services/leads";
import { LoadMore, useDebounced, usePagedList } from "../app/paging";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  Tabs,
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
  eventDay,
  LeadStatusBadge,
  leadTitle,
  valueOf,
} from "./lead-shared";
import { T, useCopy } from "../app/live-copy";

const views = ["All leads", "Triage", "Needs review", "Duplicates"];

export const summaryLine = (lead: LeadSummary) =>
  [
    lead.source,
    businessDate(lead.receivedAt),
    leadStatusLabels[lead.status],
    lead.assignedSalespersonId ?? "Unassigned",
  ].join(" · ");

// The duplicates queue (FLOW-110): open possible duplicates the user can resolve.
// Cross-owner ones (two different salespeople) only reach Admin and the Sales
// Manager.
function DuplicateQueue() {
  const duplicates = usePagedList(
    ["lead-duplicates"],
    (cursor) => leadsApi.duplicates(cursor),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      duplicates.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (duplicates.error) return <LoadError message={duplicates.error} />;
  if (!duplicates.data) return <LoadingSkeleton />;
  if (!duplicates.data.length)
    return <p className="muted"><T id="lead-inbox.duplicate-queue.no-possible-duplicates-to-resolve">No possible duplicates to resolve.</T></p>;
  const pair = (duplicate: LeadDuplicate) => {
    const other = duplicate.matchedLead;
    return (
      <li key={duplicate.id} className="duplicate-pair">
        <p>
          <strong>{leadDuplicateReasonLabels[duplicate.reason]}</strong>
          {duplicate.crossOwner && (
            <span className="badge warning"><T id="lead-inbox.duplicate-queue.different-salespeople">Different salespeople</T></span>
          )}
        </p>
        <p>
          <Link to={`/leads/${duplicate.lead.id}`}>
            {duplicate.lead.name || <T id="lead-inbox.duplicate-queue.unnamed-lead">Unnamed lead</T>}
          </Link>{" "}
          <small>{summaryLine(duplicate.lead)}</small>
        </p>
        <p>
          {other ? (
            <>
              <Link to={`/leads/${other.id}`}>
                {other.name || <T id="lead-inbox.duplicate-queue.unnamed-lead">Unnamed lead</T>}
              </Link>{" "}
              <small>{summaryLine(other)}</small>
            </>
          ) : (
            duplicate.matchedClient && (
              <>
                <T id="lead-inbox.duplicate-queue.client">{"Client "}</T>
                <Link to={`/clients/${duplicate.matchedClient.id}`}>
                  {duplicate.matchedClient.name}
                </Link>
              </>
            )
          )}
        </p>
        <div className="page-actions">
          {other && (
            <>
              <Allowed action="leads.merge">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      leadsApi.merge(duplicate.id, duplicate.lead.id),
                    )
                  }
                >
                  <T id="lead-inbox.duplicate-queue.keep" values={{ name: duplicate.lead.name || <T id="lead-inbox.duplicate-queue.first">first</T> }}>{"Keep {name}"}</T>
                </Button>
              </Allowed>
              <Allowed action="leads.merge">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(() => leadsApi.merge(duplicate.id, other.id))
                  }
                >
                  <T id="lead-inbox.duplicate-queue.keep" values={{ name: other.name || <T id="lead-inbox.duplicate-queue.second">second</T> }}>{"Keep {name}"}</T>
                </Button>
              </Allowed>
            </>
          )}
          <Allowed action="leads.merge">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void act(() => leadsApi.dismiss(duplicate.id))}
            >
              <T id="lead-inbox.duplicate-queue.not-a-duplicate">Not a duplicate</T>
            </Button>
          </Allowed>
        </div>
      </li>
    );
  };
  return (
    <>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <ul className="duplicate-list" aria-label="Possible duplicates">
        {duplicates.data.map(pair)}
      </ul>
      <LoadMore list={duplicates} label="Load more duplicates" />
    </>
  );
}

// The unified inbox (FLOW-100) with the triage queue (FLOW-111): every source in one
// list, filters, a "needs review" view, and bulk assignment.
export function LeadInbox() {
  const copyPlaceholder = useCopy("lead-inbox.lead-inbox.placeholder-search-name-email-or-phone", "Search name, email or phone…");
  const navigate = useNavigate();
  const [view, setView] = useState(views[0]);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [converting, setConverting] = useState<Lead | null>(null);
  const [entering, setEntering] = useState(false);
  // The API searches name, email and phone across every lead (FLOW-179).
  const term = useDebounced(search.trim());
  const leads = usePagedList(
    ["leads", "list", view, status, source, channel, term],
    async (cursor): Promise<Page<Lead>> =>
      view === "Duplicates"
        ? { rows: [], next: null }
        : leadsApi.list(
            {
              triage: view === "Triage",
              needsReview: view === "Needs review",
              status: valueOf(leadStatusLabels, status),
              source: source || undefined,
              channel: valueOf(leadChannelLabels, channel),
              search: term || undefined,
            },
            cursor,
          ),
  );
  const data = leads.data ?? [];
  // Lead sources from business settings (FLOW-45) plus any a lead arrived with.
  const listedSources = useListLabels("lead_source");
  const sources = [
    ...new Set([
      ...listedSources,
      ...(leads.data ?? []).map((l) => l.source),
    ]),
  ];
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : [...current, id],
    );
  const columns: ColumnDef<Lead, unknown>[] = [
    {
      id: "select",
      header: "Select",
      enableSorting: false,
      cell: (c) => (
        <Allowed action="leads.assign">
          <input
            type="checkbox"
            aria-label={`Select ${leadTitle(c.row.original)}`}
            checked={selected.includes(c.row.original.id)}
            onChange={() => toggle(c.row.original.id)}
          />
        </Allowed>
      ),
    },
    {
      id: "received",
      header: "Received",
      accessorFn: (lead) => lead.receivedAt,
      cell: (c) => businessDate(c.row.original.receivedAt),
      meta: { csv: (lead) => businessDate(lead.receivedAt) },
    },
    {
      id: "lead",
      header: "Lead",
      accessorFn: leadTitle,
      cell: (c) => (
        <span>
          <Link to={`/leads/${c.row.original.id}`}>
            <strong>{leadTitle(c.row.original)}</strong>
          </Link>
          {c.row.original.needsReview && (
            <span className="badge warning"><T id="lead-inbox.lead-inbox.needs-review">Needs review</T></span>
          )}
        </span>
      ),
    },
    { id: "source", header: "Source", accessorFn: (lead) => lead.source },
    {
      id: "channel",
      header: "Channel",
      accessorFn: (lead) => leadChannelLabels[lead.channel],
    },
    {
      id: "eventDate",
      header: "Event date",
      accessorFn: (lead) => eventDay(lead.eventDate),
    },
    {
      id: "guests",
      header: "Guests",
      accessorFn: (lead) => lead.guestCount ?? "—",
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (lead) => leadStatusLabels[lead.status],
      cell: (c) => <LeadStatusBadge status={c.row.original.status} />,
    },
    {
      id: "assigned",
      header: "Salesperson",
      accessorFn: (lead) => lead.assignedSalespersonId ?? "Unassigned",
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: (c) =>
        c.row.original.status === "qualified" ? (
          <Allowed action="leads.convert">
            <Button
              variant="outline"
              aria-label={`Convert ${leadTitle(c.row.original)}`}
              onClick={() => setConverting(c.row.original)}
            >
              <ArrowRightLeft size={14} />
              <T id="lead-inbox.lead-inbox.convert">Convert</T>
            </Button>
          </Allowed>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title={<T id="lead-inbox.lead-inbox.leads">Leads</T>}
        subtitle={<T id="lead-inbox.lead-inbox.every-inquiry-from-every-source-in">Every inquiry from every source, in one place.</T>}
        eyebrow={<T id="lead-inbox.lead-inbox.leads">Leads</T>}
      >
        <Allowed action="leads.create">
          <Button onClick={() => setEntering(true)}><T id="lead-inbox.lead-inbox.new-lead">New lead</T></Button>
        </Allowed>
        <Button variant="outline" asChild>
          <Link to="/leads/dashboard"><T id="lead-inbox.lead-inbox.lead-dashboard">Lead dashboard</T></Link>
        </Button>
      </PageHeader>
      <Tabs
        tabs={views}
        value={view}
        onChange={(next) => {
          setView(next);
          setSelected([]);
        }}
      />
      <div role="tabpanel" id="record-panel" aria-labelledby={`tab-${view}`}>
        {view === "Duplicates" ? (
          <DuplicateQueue />
        ) : (
          <>
            <FilterBar>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={copyPlaceholder}
              />
              <Select
                label="Statuses"
                value={status}
                onChange={setStatus}
                options={leadStatusSchema.options.map(
                  (s) => leadStatusLabels[s],
                )}
              />
              <Select
                label="Sources"
                value={source}
                onChange={setSource}
                options={sources}
              />
              <Select
                label="Channels"
                value={channel}
                onChange={setChannel}
                options={leadChannelSchema.options.map(
                  (c) => leadChannelLabels[c],
                )}
              />
              <span className="result-count">
                <T id="lead-inbox.lead-inbox.leads-2" values={{ count: data.length, value: leads.hasMore ? "+" : "" }}>{"{count}{value} leads"}</T>
              </span>
            </FilterBar>
            {selected.length > 0 && (
              <Section title={<T id="lead-inbox.lead-inbox.selected" values={{ count: selected.length }}>{"{count} selected"}</T>}>
                <Allowed action="leads.assign">
                  <AssignForm
                    label="Assign selected to (user ID)"
                    button="Assign selected"
                    onAssign={async (salespersonId) => {
                      await leadsApi.bulkAssign(selected, salespersonId);
                      setSelected([]);
                      leads.reload();
                    }}
                  />
                </Allowed>
              </Section>
            )}
            {leads.error ? (
              <LoadError message={leads.error} />
            ) : leads.loading && !leads.data ? (
              <LoadingSkeleton />
            ) : (
              <>
                <DataTable
                  data={data}
                  columns={columns}
                  label="leads"
                  exportName="leads"
                  exportAll={leads.loadAll}
                />
                <LoadMore list={leads} label="Load more leads" />
              </>
            )}
          </>
        )}
      </div>
      {entering && (
        <NewLeadForm
          onClose={() => setEntering(false)}
          onCreated={() => leads.reload()}
        />
      )}
      {converting && (
        <ConvertLeadForm
          lead={converting}
          onClose={() => setConverting(null)}
          onConverted={(result) => navigate(`/events/${result.event.id}`)}
        />
      )}
    </>
  );
}
