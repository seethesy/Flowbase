import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRightLeft, TriangleAlert } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  assignedElsewhereMessage,
  defaultLeadSources,
  leadChannelLabels,
  leadDuplicateReasonLabels,
  leadChannelSchema,
  leadStatusLabels,
  leadStatusSchema,
  leadStatusTransitions,
  type Lead,
  type LeadConversion,
  type LeadDuplicate,
  type LeadStatus,
  type LeadSummary,
} from "../../shared/leads";
import { ApiRequestError, clientsApi } from "../services/core";
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
  DetailDrawer,
  FormField,
  LoadingSkeleton,
  Select,
} from "../components/shared";
import { LoadError } from "./clients";

const statusTone: Record<LeadStatus, string> = {
  new: "info",
  contacted: "warning",
  qualified: "info",
  converted: "success",
  lost: "error",
};
export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`badge ${statusTone[status]}`}>{leadStatusLabels[status]}</span>;
}

const businessDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const eventDay = (value: string | null) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const money = (cents: number | null) =>
  cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US")}`;
const duration = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};
const leadTitle = (lead: Lead) => lead.name || "Unnamed lead";
// The select boxes show labels; the API takes the values.
const valueOf = <T extends string>(labels: Record<T, string>, label: string) =>
  (Object.keys(labels) as T[]).find((key) => labels[key] === label);

// Takes a salesperson's user id. There is no user directory until FLOW-37, so the
// id is typed in; the API answers 403 for anyone but Admin.
function AssignForm({
  label,
  button,
  onAssign,
}: {
  label: string;
  button: string;
  onAssign: (salespersonId: string) => Promise<void>;
}) {
  const [salespersonId, setSalespersonId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!salespersonId.trim()) return setError("Enter the salesperson's user ID.");
    setSaving(true);
    setError("");
    try {
      await onAssign(salespersonId.trim());
      setSalespersonId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="filter-bar">
        <FormField label={label}>
          <input
            value={salespersonId}
            onChange={(e) => setSalespersonId(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="outline" disabled={saving}>
          {button}
        </Button>
      </div>
    </form>
  );
}

const views = ["All leads", "Triage", "Needs review", "Duplicates"];

const summaryLine = (lead: LeadSummary) =>
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
              <Link to={`/leads/${other.id}`}>{other.name || "Unnamed lead"}</Link>{" "}
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
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(() => leadsApi.merge(duplicate.id, duplicate.lead.id))
                }
              >
                Keep {duplicate.lead.name || "first"}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => leadsApi.merge(duplicate.id, other.id))}
              >
                Keep {other.name || "second"}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => leadsApi.dismiss(duplicate.id))}
          >
            Not a duplicate
          </Button>
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
    ...new Set([...defaultLeadSources, ...(leads.data ?? []).map((l) => l.source)]),
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
        <input
          type="checkbox"
          aria-label={`Select ${leadTitle(c.row.original)}`}
          checked={selected.includes(c.row.original.id)}
          onChange={() => toggle(c.row.original.id)}
        />
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
          <Button
            variant="outline"
            aria-label={`Convert ${leadTitle(c.row.original)}`}
            onClick={() => setConverting(c.row.original)}
          >
            <ArrowRightLeft size={14} />
            Convert
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every inquiry from every source, in one place."
        eyebrow="Leads"
      />
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
                options={leadStatusSchema.options.map((s) => leadStatusLabels[s])}
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
                options={leadChannelSchema.options.map((c) => leadChannelLabels[c])}
              />
              <span className="result-count">{data.length} leads</span>
            </FilterBar>
            {selected.length > 0 && (
              <Section title={`${selected.length} selected`}>
                <AssignForm
                  label="Assign selected to (user ID)"
                  button="Assign selected"
                  onAssign={async (salespersonId) => {
                    await leadsApi.bulkAssign(selected, salespersonId);
                    setSelected([]);
                    leads.reload();
                  }}
                />
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

function ClientPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const clients = useResource(() => clientsApi.list(), []);
  if (clients.error) return <LoadError message={clients.error} />;
  return (
    <FormField label="Existing client">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a client…</option>
        {(clients.data ?? []).map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}

// Convert (FLOW-112): a new or linked client, a contact and an inquiry event, all
// pre-filled from the lead. A possible duplicate offers linking instead.
export function ConvertLeadForm({
  lead,
  linkClientId = "",
  onClose,
  onConverted,
}: {
  lead: Lead;
  // Preselects linking to this client (a possible duplicate, FLOW-110).
  linkClientId?: string;
  onClose: () => void;
  onConverted: (result: LeadConversion) => void;
}) {
  const [mode, setMode] = useState<"create" | "link">(linkClientId ? "link" : "create");
  const [name, setName] = useState(lead.name);
  const [kind, setKind] = useState<"person" | "organization">("person");
  const [clientId, setClientId] = useState(linkClientId);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(lead.eventDate ?? "");
  const [startTime, setStartTime] = useState("");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const submit = async (allowDuplicate: boolean) => {
    if (mode === "create" && !name.trim()) return setError("Enter a client name.");
    if (mode === "link" && !clientId) return setError("Choose a client.");
    if (!date) return setError("Enter the event date.");
    if (!startTime) return setError("Enter a start time.");
    setSaving(true);
    setError("");
    setDuplicates([]);
    try {
      onConverted(
        await leadsApi.convert(lead.id, {
          client:
            mode === "create"
              ? { mode, name, kind, allowDuplicate }
              : { mode, clientId },
          event: { title, date, startTime },
        }),
      );
      onClose();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "POSSIBLE_DUPLICATE")
        setDuplicates(e.duplicates);
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Convert lead"
      description={`Creates a client, contact and inquiry event from ${leadTitle(lead)}.`}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {duplicates.length > 0 && (
          <div role="alert" className="error-message">
            <p>
              <TriangleAlert size={14} /> A client with this email or phone
              already exists:
            </p>
            <ul>
              {duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  {duplicate.name}{" "}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMode("link");
                      setClientId(duplicate.id);
                      setDuplicates([]);
                    }}
                  >
                    Link to {duplicate.name}
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => void submit(true)}
            >
              Create anyway
            </Button>
          </div>
        )}
        <h3 className="form-subheading">Client</h3>
        <div className="form-group">
          <label>
            <input
              type="radio"
              name="client-mode"
              checked={mode === "create"}
              onChange={() => setMode("create")}
            />{" "}
            Create a new client
          </label>
          <label>
            <input
              type="radio"
              name="client-mode"
              checked={mode === "link"}
              onChange={() => setMode("link")}
            />{" "}
            Link to an existing client
          </label>
        </div>
        {mode === "create" ? (
          <div className="form-grid">
            <FormField label="Client name *">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Client type">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="person">Person</option>
                <option value="organization">Organization</option>
              </select>
            </FormField>
          </div>
        ) : (
          <ClientPicker value={clientId} onChange={setClientId} />
        )}
        <h3 className="form-subheading">Event</h3>
        <FormField
          label="Event title"
          hint={`Blank uses "client — ${lead.eventType || "Event"}".`}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <div className="form-grid">
          <FormField label="Event date *">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Start time *">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </FormField>
        </div>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Convert lead
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

const nextStep: Partial<Record<LeadStatus, { status: "contacted" | "qualified"; label: string }>> = {
  new: { status: "contacted", label: "Mark contacted" },
  contacted: { status: "qualified", label: "Mark qualified" },
};

export function LeadDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const lead = useResource(() => leadsApi.get(id), [id]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const [convert, setConvert] = useState(false);
  const [linkClientId, setLinkClientId] = useState("");
  if (lead.error)
    return (
      <>
        <Link to="/leads" className="back-link">
          ← All leads
        </Link>
        <LoadError message={lead.error} />
      </>
    );
  const l = lead.data;
  if (!l) return <LoadingSkeleton />;
  const moves = leadStatusTransitions[l.status];
  const move = async (status: "contacted" | "qualified" | "lost", why = "") => {
    setBusy(true);
    setError("");
    try {
      lead.replace(await leadsApi.setStatus(l.id, { status, reason: why }));
      setLosing(false);
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const step = nextStep[l.status];
  const resolve = async (run: () => Promise<Lead | null>) => {
    setBusy(true);
    setError("");
    try {
      const kept = await run();
      if (kept && kept.id !== l.id) navigate(`/leads/${kept.id}`);
      else if (kept) lead.replace(kept);
      else lead.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const duplicates = l.duplicates ?? [];
  return (
    <>
      <Link to="/leads" className="back-link">
        ← All leads
      </Link>
      <div className="record-heading">
        <div>
          <h1>{leadTitle(l)}</h1>
          <p>
            <LeadStatusBadge status={l.status} />
            {l.needsReview && <span className="badge warning">Needs review</span>}
            {l.purchased && <span className="badge neutral">Purchased</span>}
          </p>
        </div>
        <div className="page-actions">
          {step && moves.includes(step.status) && (
            <Button disabled={busy} onClick={() => void move(step.status)}>
              {step.label}
            </Button>
          )}
          {moves.includes("lost") && (
            <Button variant="outline" disabled={busy} onClick={() => setLosing(true)}>
              Mark lost
            </Button>
          )}
          {l.status === "qualified" && (
            <Button onClick={() => setConvert(true)}>
              <ArrowRightLeft size={14} />
              Convert
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {losing && (
        <Section title="Mark lost">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim())
                return setError("A reason is required when marking a lead lost.");
              void move("lost", reason.trim());
            }}
          >
            <FormField label="Lost reason *">
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <div className="form-actions">
              <Button type="button" variant="outline" onClick={() => setLosing(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Confirm lost
              </Button>
            </div>
          </form>
        </Section>
      )}
      {l.assignedElsewhere && (
        <p role="note" className="demo-callout">
          <TriangleAlert size={14} /> {assignedElsewhereMessage}
        </p>
      )}
      {duplicates.length > 0 && (
        <Section title="Possible duplicates">
          <ul className="duplicate-list">
            {duplicates.map((match) => (
              <li key={match.duplicateId} className="duplicate-pair">
                <p>
                  <strong>{leadDuplicateReasonLabels[match.reason]}</strong>
                </p>
                {match.lead ? (
                  <p>
                    <Link to={`/leads/${match.lead.id}`}>
                      {match.lead.name || "Unnamed lead"}
                    </Link>{" "}
                    <small>{summaryLine(match.lead)}</small>
                  </p>
                ) : (
                  match.client && (
                    <p>
                      Client{" "}
                      <Link to={`/clients/${match.client.id}`}>{match.client.name}</Link>
                    </p>
                  )
                )}
                <div className="page-actions">
                  {match.lead && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void resolve(() => leadsApi.merge(match.duplicateId, l.id))
                      }
                    >
                      Merge into this lead
                    </Button>
                  )}
                  {match.client && l.status === "qualified" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setLinkClientId(match.client!.id);
                        setConvert(true);
                      }}
                    >
                      Convert and link to {match.client.name}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void resolve(() => leadsApi.dismiss(match.duplicateId))}
                  >
                    Not a duplicate
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {l.status === "converted" && (
        <p role="note" className="demo-callout">
          Converted.{" "}
          {l.convertedClientId && (
            <Link to={`/clients/${l.convertedClientId}`}>View client</Link>
          )}{" "}
          {l.convertedEventId && (
            <Link to={`/events/${l.convertedEventId}`}>View event</Link>
          )}
        </p>
      )}
      <div className="detail-grid">
        <Section title="Contact">
          <div className="info-grid">
            <div>
              <small>Name</small>
              <strong>{l.name || "—"}</strong>
            </div>
            <div>
              <small>Email</small>
              <strong>{l.email || "—"}</strong>
            </div>
            <div>
              <small>Phone</small>
              <strong>{l.phone || "—"}</strong>
            </div>
          </div>
        </Section>
        <Section title="Event">
          <div className="info-grid">
            <div>
              <small>Event date</small>
              <strong>{eventDay(l.eventDate)}</strong>
            </div>
            <div>
              <small>Guests</small>
              <strong>{l.guestCount ?? "—"}</strong>
            </div>
            <div>
              <small>Event type</small>
              <strong>{l.eventType || "—"}</strong>
            </div>
            <div>
              <small>Location</small>
              <strong>{l.location || "—"}</strong>
            </div>
            <div>
              <small>Budget</small>
              <strong>{money(l.budgetCents)}</strong>
            </div>
          </div>
          <h3 className="form-subheading">Message</h3>
          <p>{l.message || "No message."}</p>
        </Section>
        <Section title="Source">
          <div className="info-grid">
            <div>
              <small>Source</small>
              <strong>{l.source}</strong>
            </div>
            <div>
              <small>Channel</small>
              <strong>{leadChannelLabels[l.channel]}</strong>
            </div>
            <div>
              <small>Received</small>
              <strong>{businessDate(l.receivedAt)}</strong>
            </div>
            <div>
              <small>First response</small>
              <strong>
                {l.firstResponseSeconds === null
                  ? "Not yet"
                  : duration(l.firstResponseSeconds)}
              </strong>
            </div>
            <div>
              <small>Source lead</small>
              <strong>
                {l.sourceLeadUrl ? (
                  <a href={l.sourceLeadUrl} target="_blank" rel="noreferrer">
                    {l.sourceLeadId || "Open on source"}
                  </a>
                ) : (
                  l.sourceLeadId || "—"
                )}
              </strong>
            </div>
          </div>
          {l.status === "lost" && (
            <>
              <h3 className="form-subheading">Lost reason</h3>
              <p>{l.lostReason}</p>
            </>
          )}
        </Section>
        {(l.sourceLinks?.length ?? 0) > 1 && (
          <Section title="Source links">
            <ul aria-label="Source links">
              {l.sourceLinks!.map((link) => (
                <li key={link.leadId}>
                  {link.source} · {leadChannelLabels[link.channel]} ·{" "}
                  {link.sourceLeadUrl ? (
                    <a href={link.sourceLeadUrl} target="_blank" rel="noreferrer">
                      {link.sourceLeadId || "Open on source"}
                    </a>
                  ) : (
                    link.sourceLeadId || "—"
                  )}{" "}
                  <small>
                    {link.mergedAt
                      ? `merged ${businessDate(link.mergedAt)} by ${link.mergedBy ?? "—"}`
                      : `received ${businessDate(link.receivedAt)}`}
                  </small>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Assignment">
          <p>
            Salesperson:{" "}
            <strong>{l.assignedSalespersonId ?? "Unassigned"}</strong>
          </p>
          <AssignForm
            label="Assign to (user ID)"
            button={l.assignedSalespersonId ? "Reassign" : "Assign"}
            onAssign={async (salespersonId) =>
              lead.replace(await leadsApi.assign(l.id, salespersonId))
            }
          />
        </Section>
      </div>
      {l.rawPayload !== null && l.rawPayload !== undefined && (
        <Section title="Raw payload">
          <pre className="muted">{JSON.stringify(l.rawPayload, null, 2)}</pre>
        </Section>
      )}
      {convert && (
        <ConvertLeadForm
          lead={l}
          linkClientId={linkClientId}
          onClose={() => {
            setConvert(false);
            setLinkClientId("");
          }}
          onConverted={(result) => navigate(`/events/${result.event.id}`)}
        />
      )}
    </>
  );
}
