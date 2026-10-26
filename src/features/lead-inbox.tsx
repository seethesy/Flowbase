import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRightLeft } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  defaultLeadSources,
  leadChannelLabels,
  leadDuplicateReasonLabels,
  leadChannelSchema,
  leadStatusLabels,
  leadStatusSchema,
  type Lead,
  type LeadDuplicate,
  type LeadSummary,
} from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
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
import { LoadError } from "./clients";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
import {
  AssignForm,
  businessDate,
  eventDay,
  LeadStatusBadge,
  leadTitle,
  valueOf,
} from "./lead-shared";

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
  const duplicates = useResource(() => leadsApi.duplicates(), []);
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
    return <p className="muted">No possible duplicates to resolve.</p>;
  const pair = (duplicate: LeadDuplicate) => {
    const other = duplicate.matchedLead;
    return (
      <li key={duplicate.id} className="duplicate-pair">
        <p>
          <strong>{leadDuplicateReasonLabels[duplicate.reason]}</strong>
          {duplicate.crossOwner && (
            <span className="badge warning">Different salespeople</span>
          )}
        </p>
        <p>
          <Link to={`/leads/${duplicate.lead.id}`}>
            {duplicate.lead.name || "Unnamed lead"}
          </Link>{" "}
          <small>{summaryLine(duplicate.lead)}</small>
        </p>
        <p>
          {other ? (
            <>
              <Link to={`/leads/${other.id}`}>
                {other.name || "Unnamed lead"}
              </Link>{" "}
              <small>{summaryLine(other)}</small>
            </>
          ) : (
            duplicate.matchedClient && (
              <>
                Client{" "}
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
                  Keep {duplicate.lead.name || "first"}
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
                  Keep {other.name || "second"}
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
              Not a duplicate
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
    </>
  );
}

// The unified inbox (FLOW-100) with the triage queue (FLOW-111): every source in one
// list, filters, a "needs review" view, and bulk assignment.
export function LeadInbox() {
  const navigate = useNavigate();
  const [view, setView] = useState(views[0]);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [converting, setConverting] = useState<Lead | null>(null);
  const leads = useResource(
    async (): Promise<Lead[]> =>
      view === "Duplicates"
        ? []
        : leadsApi.list({
            triage: view === "Triage",
            needsReview: view === "Needs review",
            status: valueOf(leadStatusLabels, status),
            source: source || undefined,
            channel: valueOf(leadChannelLabels, channel),
          }),
    [view, status, source, channel],
  );
  const term = search.toLowerCase();
  const data = (leads.data ?? []).filter((lead) =>
    [lead.name, lead.email, lead.phone].join(" ").toLowerCase().includes(term),
  );
  const sources = [
    ...new Set([
      ...defaultLeadSources,
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
            <span className="badge warning">Needs review</span>
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
              Convert
            </Button>
          </Allowed>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every inquiry from every source, in one place."
        eyebrow="Leads"
      >
        <Button variant="outline" asChild>
          <Link to="/leads/dashboard">Lead dashboard</Link>
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
                placeholder="Search name, email or phone…"
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
              <span className="result-count">{data.length} leads</span>
            </FilterBar>
            {selected.length > 0 && (
              <Section title={`${selected.length} selected`}>
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
              <DataTable data={data} columns={columns} label="leads" />
            )}
          </>
        )}
      </div>
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
