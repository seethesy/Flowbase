import { Allowed } from "../app/permissions";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  eventStatusDetailLabels,
  eventStatusLabels,
  contactRoleLabels,
  eventStatusSchema,
  type EventInput,
  type EventStatus,
  type FlowEvent,
} from "../../shared/core-records";
import type { HubSection } from "../../shared/event-hub";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { allPages, clientsApi, eventsApi, venuesApi } from "../services/core";
import { StaleReload, isStale } from "../components/stale-reload";
import { useResource } from "../app/useResource";
import { useOpenFor } from "../app/useOpenFor";
import { LoadMore, useDebounced, usePagedList } from "../app/paging";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  Section,
  ConfirmationDialog,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
  Select,
} from "../components/shared";
import { hidden, initials, LoadError } from "../components/record-display";
import { Attachments } from "./attachments";
import { CommunicationLog } from "./communications";
import { date, time } from "./event-format";
import { EventPlanningSection } from "./event-planning";
import { EventTruckSection } from "./event-trucks";
import { EventDayOfSection } from "./day-of";
import { EventProductionSection } from "./production";
import { EventCloseoutSection } from "./event-closeout";
import { EventBeoSection } from "./event-beo";
import { EventPaymentsSection } from "./event-payments";
import { EventStaffSection } from "./event-staff";
import { EventTimelineSection } from "./event-timeline";
import {
  EventKitchenMenuSection,
  EventPlanningProgressSection,
  EventPullListSection,
} from "./event-preparation";
import { EventProposalsSection } from "./event-proposals";
import { EventTasksSection } from "./task-lists";
import { EventHistorySection } from "./event-activity";
import { ListSelect, ListSuggestions } from "./list-fields";
import type { ListKey } from "../../shared/settings";
import { T, useCopy } from "../app/live-copy";

const statusLabels = eventStatusLabels;

// Today in New York as YYYY-MM-DD.
const businessToday = () => utcToBusinessTime(new Date()).date;
const defaultEventWindow = () => {
  const today = businessToday();
  return { from: addLocalDays(today, -7), to: addLocalDays(today, 30) };
};
const when = (event: FlowEvent) =>
  `${date(event.date)} · ${time(event.startTime)}${event.endTime ? `–${time(event.endTime)}` : ""}`;

export function EventTable({
  events,
  error,
  exportName,
  exportAll,
}: {
  events: FlowEvent[];
  error?: string;
  exportName?: string;
  // Every matching event when the list is paged (FLOW-216).
  exportAll?: (onProgress: (rows: number) => void) => Promise<FlowEvent[]>;
}) {
  const navigate = useNavigate();
  if (error) return <LoadError message={error} />;
  const columns: ColumnDef<FlowEvent, unknown>[] = [
    { accessorKey: "title", header: "Event" },
    { id: "when", header: "When", accessorFn: when },
    {
      id: "client",
      header: "Client",
      accessorFn: (event) => event.client.name,
    },
    {
      id: "venue",
      header: "Venue",
      accessorFn: (event) => event.venue?.name ?? event.address,
    },
    {
      id: "guests",
      header: "Guests",
      accessorFn: (event) => event.guestCount ?? "—",
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (event) => statusLabels[event.status],
    },
  ];
  return (
    <DataTable
      data={events}
      columns={columns}
      onRow={(event) => navigate(`/events/${event.id}`)}
      label="events"
      exportName={exportName}
      exportAll={exportAll}
    />
  );
}

// Events (FLOW-55), created by hand so the calendar and tasks work before leads
// and proposals exist.
export function EventList() {
  const copyPlaceholder = useCopy("events.event-list.placeholder-search-events-clients-or-venues", "Search events, clients or venues…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  // Opens on the past 7 days through the next 30, soonest first (FLOW-179 A1);
  // the date range reaches anything else, and clearing it shows every event.
  const [range, setRange] = useState(defaultEventWindow);
  const term = useDebounced(search.trim());
  // A label can stand for several statuses ("Pending"); ask for all of them.
  const statuses = status
    ? eventStatusSchema.options.filter((value) => statusLabels[value] === status)
    : [];
  const events = usePagedList(
    ["events", "list", archived, term, statuses.join(","), range.from, range.to],
    (cursor) =>
      eventsApi.list(
        {
          archived,
          search: term || undefined,
          statuses,
          from: range.from || undefined,
          to: range.to || undefined,
        },
        cursor,
      ),
  );
  const data = events.data ?? [];
  return (
    <>
      <PageHeader
        title={<T id="events.event-list.events">Events</T>}
        subtitle={<T id="events.event-list.every-proposal-beo-and-task-hangs">Every proposal, BEO and task hangs off an event.</T>}
        eyebrow={<T id="events.event-list.events">Events</T>}
      >
        <Allowed action="events.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="events.event-list.new-event">New Event</T>
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={copyPlaceholder}
        />
        <Select
          label="Statuses"
          options={[...new Set(Object.values(statusLabels))]}
          value={status}
          onChange={setStatus}
        />
        <label className="date-filter">
          <T id="events.event-list.from">From</T>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
        </label>
        <label className="date-filter">
          <T id="events.event-list.to">To</T>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </label>
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="events.event-list.show-archived">Show archived</T>
        </label>
        <span className="result-count">
          <T id="events.event-list.events-2" values={{ count: data.length, value: events.hasMore ? "+" : "" }}>{"{count}{value} events"}</T>
        </span>
      </FilterBar>
      {events.loading && !events.data && !events.error ? (
        <LoadingSkeleton />
      ) : (
        <>
          <EventTable
            events={data}
            error={events.error}
            exportName="events"
            exportAll={events.loadAll}
          />
          <LoadMore list={events} label="Load more events" />
        </>
      )}
      {create && (
        <EventForm
          onClose={() => setCreate(false)}
          onSaved={(event) => navigate(`/events/${event.id}`)}
        />
      )}
    </>
  );
}

type Draft = Omit<EventInput, "guestCount" | "servingsCount"> & {
  guestCount: string;
  servingsCount: string;
};
const draftOf = (event?: FlowEvent, clientId = ""): Draft => ({
  title: event?.title ?? "",
  date: event?.date ?? "",
  startTime: event?.startTime ?? "",
  endTime: event?.endTime ?? null,
  clientId: event?.client.id ?? clientId,
  pocContactId: event?.pocContactId ?? null,
  venueId: event?.venue?.id ?? null,
  address: event?.address ?? "",
  eventType: event?.eventType ?? "",
  serviceType: event?.serviceType ?? "",
  foodServiceStyle: event?.foodServiceStyle ?? "",
  guestCount: event?.guestCount?.toString() ?? "",
  servingsCount: event?.servingsCount?.toString() ?? "",
  dressCode: event?.dressCode ?? "",
  arrivalTime: event?.arrivalTime ?? null,
  transportationNotes: event?.transportationNotes ?? "",
  internalNotes: event?.internalNotes ?? "",
  status: event?.status ?? "inquiry",
});
const countOf = (value: string) =>
  value.trim() === "" ? null : Math.max(0, Math.round(Number(value)));

type EventFormProps = {
  event?: FlowEvent;
  clientId?: string;
  onClose: () => void;
  onSaved: (event: FlowEvent) => void;
};

// Edits reload the current version when the save was made from a stale copy
// (FLOW-186).
export function EventForm(props: EventFormProps) {
  return (
    <StaleReload
      record={props.event}
      load={(id) => eventsApi.get(id)}
      what="event"
    >
      {({ record, conflict, onStale }) => (
        <EventFormFields
          key={record?.updatedAt ?? "new"}
          {...props}
          event={record}
          conflict={conflict}
          onStale={onStale}
        />
      )}
    </StaleReload>
  );
}

function EventFormFields({
  event,
  clientId,
  onClose,
  onSaved,
  conflict,
  onStale,
}: EventFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const copyPlaceholder = useCopy("events.event-form-fields.placeholder-type-a-client-or-contact-name", "Type a client or contact name");
  const [draft, setDraft] = useState<Draft>(() => draftOf(event, clientId));
  // Left untouched, areas follow the venue: the API copies a newly picked venue's.
  const [areas, setAreas] = useState<string | undefined>(
    event ? event.areas.map((area) => area.name).join("\n") : undefined,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The client picker searches the server as you type (FLOW-179); the chosen
  // client stays selectable even when it isn't in the current matches.
  const [clientSearch, setClientSearch] = useState("");
  const clientTerm = useDebounced(clientSearch.trim());
  const clients = useResource(
    ["clients", "search", clientTerm],
    async () =>
      (await clientsApi.list({ search: clientTerm || undefined })).rows,
    { reference: true, keepPrevious: true },
  );
  const listed = clients.data?.find((client) => client.id === draft.clientId);
  const fetched = useResource(
    ["clients", draft.clientId],
    () => clientsApi.get(draft.clientId),
    { enabled: Boolean(draft.clientId && !listed) },
  );
  const chosen =
    listed ?? (fetched.data?.id === draft.clientId ? fetched.data : undefined);
  const clientOptions = [
    ...(chosen && !listed ? [chosen] : []),
    ...(clients.data ?? []),
  ];
  const venues = useResource(
    ["venues", "all"],
    () => allPages((cursor) => venuesApi.list({}, cursor)),
    { reference: true },
  );
  const contacts = chosen?.contacts ?? [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const text = (key: keyof Draft, label: string, type = "text") => (
    <FormField label={label}>
      <input
        type={type}
        value={String(draft[key] ?? "")}
        onChange={(e) =>
          set(
            key,
            (e.target.value ||
              (key === "endTime" || key === "arrivalTime" ? null : "")) as never,
          )
        }
      />
    </FormField>
  );
  // Choices come from business settings (FLOW-45).
  const list = (
    key: "eventType" | "serviceType" | "foodServiceStyle",
    label: string,
    listKey: ListKey,
  ) => (
    <FormField label={label}>
      <ListSelect
        list={listKey}
        value={draft[key] ?? ""}
        onChange={(value) => set(key, value)}
      />
    </FormField>
  );
  const save = async () => {
    if (!draft.title.trim() || !draft.date || !draft.startTime || !draft.clientId)
      return setError("Title, date, start time and client are required.");
    const input: EventInput = {
      ...draft,
      guestCount: countOf(draft.guestCount),
      servingsCount: countOf(draft.servingsCount),
      areas:
        areas === undefined
          ? undefined
          : areas
              .split("\n")
              .map((area) => area.trim())
              .filter(Boolean),
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        event
          ? await eventsApi.update(event.id, {
              ...input,
              updatedAt: event.updatedAt,
            })
          : await eventsApi.create(input),
      );
      onClose();
    } catch (e) {
      if (event && isStale(e)) {
        await onStale();
        return;
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={event ? <T id="events.event-form-fields.edit-event">Edit event</T> : <T id="events.event-form-fields.new-event">New event</T>}
      description={<T id="events.event-form-fields.only-title-date-start-time-and">Only title, date, start time and client are required.</T>}
      wide
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {conflict && (
          <p role="alert" className="error-message">
            {conflict}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {(clients.error || venues.error) && (
          <LoadError message={clients.error ?? venues.error ?? ""} />
        )}
        <FormField label={<T id="events.event-form-fields.title">Title *</T>}>
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            autoFocus
          />
        </FormField>
        <div className="form-grid">
          {text("date", "Date *", "date")}
          <FormField label={<T id="events.event-form-fields.find-client">Find client</T>}>
            <input
              type="search"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder={copyPlaceholder}
            />
          </FormField>
          <FormField label={<T id="events.event-form-fields.client">Client *</T>}>
            <select
              value={draft.clientId}
              onChange={(e) => {
                set("clientId", e.target.value);
                set("pocContactId", null);
              }}
            >
              <option value="">Choose a client</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </FormField>
          {text("startTime", "Start time *", "time")}
          {text("endTime", "End time", "time")}
          <FormField label={<T id="events.event-form-fields.point-of-contact">Point of contact</T>}>
            <select
              value={draft.pocContactId ?? ""}
              onChange={(e) => set("pocContactId", e.target.value || null)}
            >
              <option value="">None</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          </FormField>
          {/* Any status on create; afterwards it changes on the event page. */}
          {!event && (
            <FormField label={<T id="events.event-form-fields.status">Status</T>}>
              <select
                value={draft.status}
                onChange={(e) =>
                  set("status", eventStatusSchema.parse(e.target.value))
                }
              >
                {eventStatusSchema.options.map((status) => (
                  <option key={status} value={status}>
                    {eventStatusDetailLabels[status]}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label={<T id="events.event-form-fields.venue">Venue</T>}>
            <select
              value={draft.venueId ?? ""}
              onChange={(e) => set("venueId", e.target.value || null)}
            >
              <option value="">No venue (use an address)</option>
              {venues.data?.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={<T id="events.event-form-fields.address">Address</T>} hint={<T id="events.event-form-fields.leave-empty-to-use-the-venue">{"Leave empty to use the venue's."}</T>}>
            <input
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </FormField>
          {list("eventType", "Event type", "event_type")}
          {list("serviceType", "Service type", "service_type")}
          {list("foodServiceStyle", "Food service style", "food_service_style")}
          <FormField label={<T id="events.event-form-fields.dress-code">Dress code</T>} hint={<T id="events.event-form-fields.pick-a-preset-or-type-your">Pick a preset or type your own.</T>}>
            <input
              list="dress-code-presets"
              value={draft.dressCode ?? ""}
              onChange={(e) => set("dressCode", e.target.value)}
            />
            <ListSuggestions id="dress-code-presets" list="dress_code" />
          </FormField>
          {text("arrivalTime", "Arrival time at venue", "time")}
          {text("guestCount", "Guest count", "number")}
          {text("servingsCount", "Servings count", "number")}
        </div>
        <FormField
          label={<T id="events.event-form-fields.areas">Areas</T>}
          hint={<T id="events.event-form-fields.one-per-line-left-unchanged-a">{"One per line. Left unchanged, a newly picked venue's areas are used."}</T>}
        >
          <textarea
            rows={3}
            value={areas ?? ""}
            onChange={(e) => setAreas(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="events.event-form-fields.transportation-notes">Transportation notes</T>}>
          <textarea
            rows={2}
            value={draft.transportationNotes}
            onChange={(e) => set("transportationNotes", e.target.value)}
          />
        </FormField>
        <FormField label={<T id="events.event-form-fields.internal-notes">Internal notes</T>}>
          <textarea
            rows={3}
            value={draft.internalNotes}
            onChange={(e) => set("internalNotes", e.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="events.event-form-fields.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="events.event-form-fields.save-event">Save event</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

// Manual status changes (FLOW-56): Admin or the event's salesperson may pick any
// status; the reason is optional. Everyone who can open the event sees the history.
function EventStatusPanel({
  event,
  canChange,
  onChanged,
}: {
  event: FlowEvent;
  canChange: boolean;
  onChanged: (event: FlowEvent) => void;
}) {
  const history = usePagedList(
    ["event-status-history", event.id, event.status],
    (cursor) => eventsApi.statusHistory(event.id, cursor),
  );
  const others = eventStatusSchema.options.filter(
    (status) => status !== event.status,
  );
  const [to, setTo] = useState<EventStatus>(others[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const target = others.includes(to) ? to : others[0];
  const change = async () => {
    setSaving(true);
    setError("");
    try {
      onChanged(
        await eventsApi.setStatus(event.id, { status: target, reason }),
      );
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title={<T id="events.event-status-panel.status">Status</T>}>
      {canChange && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void change();
          }}
        >
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <FormField label={<T id="events.event-status-panel.new-status">New status</T>}>
            <select
              value={target}
              onChange={(e) => setTo(eventStatusSchema.parse(e.target.value))}
            >
              {others.map((status) => (
                <option key={status} value={status}>
                  {eventStatusDetailLabels[status]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={<T id="events.event-status-panel.why-optional">Why (optional)</T>}>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={saving}>
            <T id="events.event-status-panel.change-status">Change status</T>
          </Button>
        </form>
      )}
      <h3><T id="events.event-status-panel.status-history">Status history</T></h3>
      {history.error ? (
        <LoadError message={history.error} />
      ) : (
        <ul aria-label="Status history">
          {history.data?.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.from
                  ? `${eventStatusDetailLabels[entry.from]} → ${eventStatusDetailLabels[entry.to]}`
                  : <T id="events.event-status-panel.created-as" values={{ eventStatusDetailLabels: eventStatusDetailLabels[entry.to] }}>{"Created as {eventStatusDetailLabels}"}</T>}
              </strong>{" "}
              <small>
                {new Date(entry.at).toLocaleString("en-US")}
                {entry.manual ? "" : <T id="events.event-status-panel.automatic">{" · automatic"}</T>}
              </small>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
        </ul>
      )}
      <LoadMore list={history} label="Show older changes" />
    </Section>
  );
}

// The event hub (FLOW-57): one page per event with a section for each part of it.
// The API decides which sections the user may see; a section whose module doesn't
// exist yet is never listed.
export function EventDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hub = useResource(
    ["event-hub", id],
    () => eventsApi.hub(id),
  );
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  const back = (
    <Link to="/events" className="back-link">
      <T id="events.event-detail.all-events">← All events</T>
    </Link>
  );
  if (hub.error)
    return (
      <>
        {back}
        <LoadError message={hub.error} />
      </>
    );
  if (!hub.data) return <LoadingSkeleton />;
  const { event: e, client, sections, canEdit, canChangeStatus } = hub.data;
  const setEvent = (event: FlowEvent) => hub.replace({ ...hub.data!, event });
  const facts: [string, string][] = [
    ["When", when(e)],
    ["Client", e.client.name],
    ["Venue", e.venue?.name ?? "No venue"],
    ["Address", e.address || "—"],
    ["Areas", e.areas.map((area) => area.name).join(", ") || "—"],
    ["Event type", e.eventType || "—"],
    ["Service type", e.serviceType || "—"],
    ["Food service style", e.foodServiceStyle || "—"],
    ["Guests", e.guestCount?.toString() ?? "—"],
    ["Servings", e.servingsCount?.toString() ?? "—"],
    ["Dress code", e.dressCode || "—"],
    ["Arrival at venue", e.arrivalTime ? time(e.arrivalTime) : "—"],
    ["Status", statusLabels[e.status]],
    ...(e.planningStaleAt ? [["Planning outputs", `Needs refresh since ${new Date(e.planningStaleAt).toLocaleDateString()}`] as [string, string]] : []),
  ];
  const render: Partial<Record<HubSection, () => ReactNode>> = {
    details: () => (
      <Fragment key="details">
        <div className="detail-grid">
          <Section title={<T id="events.event-detail.event-details">Event details</T>}>
            <div className="info-grid">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {e.venue && (
              <p>
                <Link to={`/venues/${e.venue.id}`}><T id="events.event-detail.open-venue">Open venue</T></Link>
              </p>
            )}
          </Section>
          <Section title={<T id="events.event-detail.notes">Notes</T>}>
            <small><T id="events.event-detail.transportation">Transportation</T></small>
            <p>{e.transportationNotes || "—"}</p>
            <small><T id="events.event-detail.internal">Internal</T></small>
            <p>{e.internalNotes || "—"}</p>
          </Section>
        </div>
        <EventStatusPanel
          event={e}
          canChange={canChangeStatus}
          onChanged={setEvent}
        />
        <Allowed action="clients.read">
          <CommunicationLog target={{ eventId: e.id }} />
        </Allowed>
      </Fragment>
    ),
    client: () =>
      client && (
        <Section
          key="client"
          title={<T id="events.event-detail.client">Client</T>}
          action={<Link to={`/clients/${client.id}`}><T id="events.event-detail.open-client">Open client</T></Link>}
        >
          <div className="contact-profile">
            <span className="avatar">{initials(client.name)}</span>
            <div>
              <strong>{client.name}</strong>
              <small>
                {client.kind === "organization" ? <T id="events.event-detail.organization">Organization</T> : <T id="events.event-detail.person">Person</T>}
                {client.tags.length ? ` · ${client.tags.join(", ")}` : ""}
              </small>
            </div>
          </div>
          {client.contacts.map((contact) => (
            <div className="contact-profile" key={contact.id}>
              <span className="avatar">{initials(contact.name)}</span>
              <div>
                <strong>
                  {contact.name}
                  {contact.id === e.pocContactId && <T id="events.event-detail.point-of-contact">{" (point of contact)"}</T>}
                </strong>
                <small>
                  {contactRoleLabels[contact.role]} · {hidden(contact.email)} ·{" "}
                  {hidden(contact.phone)}
                </small>
              </div>
            </div>
          ))}
        </Section>
      ),
    proposal: () => (
      <EventProposalsSection
        key={`proposal:${e.id}`}
        event={e}
        onEventChanged={() => hub.reload()}
      />
    ),
    inventory: () => (
      <EventPlanningSection key={`planning:${e.id}`} event={e} canEdit={canEdit} />
    ),
    tasks: () => <EventTasksSection key={`tasks:${e.id}`} event={e} />,
    production: () => <EventProductionSection key={`production:${e.id}`} eventId={e.id} />,
    staff: () => (
      <EventStaffSection
        key={`staff:${e.id}`}
        event={e}
        onEventChanged={() => hub.reload()}
      />
    ),
    timeline: () => <EventTimelineSection key={`timeline:${e.id}`} event={e} />,
    planning: () => (
      <EventPlanningProgressSection
        key={`planning-progress:${e.id}`}
        event={e}
        onStarted={() => hub.reload()}
      />
    ),
    pull_list: () => <EventPullListSection key={`pull-list:${e.id}`} event={e} />,
    trucks: () => <EventTruckSection key={`trucks:${e.id}`} event={e} />,
    day_of: () => <EventDayOfSection key={`day-of:${e.id}`} event={e} />,
    closeout: () => <EventCloseoutSection key={`closeout:${e.id}`} event={e} />,
    kitchen_menu: () => (
      <EventKitchenMenuSection key={`kitchen-menu:${e.id}`} event={e} />
    ),
    beo: () => <EventBeoSection key={`beo:${e.id}`} event={e} />,
    payments: () => <EventPaymentsSection key={`payments:${e.id}`} event={e} />,
    files: () => (
      <Attachments
        key="files"
        recordType="event"
        recordId={e.id}
        title="Event files"
      />
    ),
    history: () => (
      <EventHistorySection
        key={`history:${e.id}`}
        eventId={e.id}
        version={e.updatedAt}
      />
    ),
  };
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{e.title}</h1>
          <p>
            <span className="badge neutral">{statusLabels[e.status]}</span>
            {e.archivedAt && <span className="badge error"><T id="events.event-detail.archived">Archived</T></span>}
            <span>{when(e)}</span>
          </p>
        </div>
        {canEdit && (
          <div className="page-actions">
            <Allowed action="events.write">
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil size={14} />
                <T id="events.event-detail.edit">Edit</T>
              </Button>
            </Allowed>
            {e.archivedAt ? (
              <Allowed action="events.write">
                <Button
                  variant="outline"
                  onClick={async () =>
                    setEvent(await eventsApi.setArchived(e.id, false))
                  }
                >
                  <RotateCcw size={14} />
                  <T id="events.event-detail.restore">Restore</T>
                </Button>
              </Allowed>
            ) : (
              <Allowed action="events.write">
                <Button variant="outline" onClick={() => setArchive(true)}>
                  <Archive size={14} />
                  <T id="events.event-detail.archive">Archive</T>
                </Button>
              </Allowed>
            )}
          </div>
        )}
      </div>
      {sections.map((section) => render[section]?.())}
      {edit && (
        <EventForm
          event={e}
          onClose={() => setEdit(false)}
          // The client may have changed, so reload the whole hub.
          onSaved={() => hub.reload()}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="events.event-detail.archive-this-event">Archive this event?</T>}
        onConfirm={async () => {
          await eventsApi.setArchived(e.id, true);
          setArchive(false);
          navigate("/events");
        }}
      >
        <T id="events.event-detail.will-be-hidden-from-the-event" values={{ title: e.title }}>{"{title} will be hidden from the event list."}</T>
      </ConfirmationDialog>
    </>
  );
}
