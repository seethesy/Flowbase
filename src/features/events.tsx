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
import { clientsApi, eventsApi, venuesApi } from "../services/core";
import { useResource } from "../app/useResource";
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
import { ListSelect, ListSuggestions } from "./list-fields";
import type { ListKey } from "../../shared/settings";

const statusLabels = eventStatusLabels;
const date = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const time = (value: string | null) => {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
};
const when = (event: FlowEvent) =>
  `${date(event.date)} · ${time(event.startTime)}${event.endTime ? `–${time(event.endTime)}` : ""}`;

export function EventTable({
  events,
  error,
  exportName,
}: {
  events: FlowEvent[];
  error?: string;
  exportName?: string;
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
    />
  );
}

// Events (FLOW-55), created by hand so the calendar and tasks work before leads
// and proposals exist.
export function EventList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  const events = useResource(() => eventsApi.list({ archived }), [archived]);
  const term = search.toLowerCase();
  const data = (events.data ?? []).filter(
    (event) =>
      `${event.title} ${event.client.name} ${event.venue?.name ?? ""}`
        .toLowerCase()
        .includes(term) &&
      (!status || statusLabels[event.status] === status),
  );
  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Every proposal, BEO and task hangs off an event."
        eyebrow="Events"
      >
        <Allowed action="events.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Event
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search events, clients or venues…"
        />
        <Select
          label="Statuses"
          options={[...new Set(Object.values(statusLabels))]}
          value={status}
          onChange={setStatus}
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="result-count">{data.length} events</span>
      </FilterBar>
      {events.loading && !events.data && !events.error ? (
        <LoadingSkeleton />
      ) : (
        <EventTable events={data} error={events.error} exportName="events" />
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
  productionLeadId: event?.productionLeadId ?? null,
  assistantLeadIds: event?.assistantLeadIds ?? [],
  dressCode: event?.dressCode ?? "",
  transportationNotes: event?.transportationNotes ?? "",
  internalNotes: event?.internalNotes ?? "",
  status: event?.status ?? "inquiry",
});
const countOf = (value: string) =>
  value.trim() === "" ? null : Math.max(0, Math.round(Number(value)));

export function EventForm({
  event,
  clientId,
  onClose,
  onSaved,
}: {
  event?: FlowEvent;
  clientId?: string;
  onClose: () => void;
  onSaved: (event: FlowEvent) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(event, clientId));
  // Left untouched, areas follow the venue: the API copies a newly picked venue's.
  const [areas, setAreas] = useState<string | undefined>(
    event ? event.areas.map((area) => area.name).join("\n") : undefined,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const clients = useResource(() => clientsApi.list(), []);
  const venues = useResource(() => venuesApi.list(), []);
  const contacts =
    clients.data?.find((client) => client.id === draft.clientId)?.contacts ??
    [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const text = (key: keyof Draft, label: string, type = "text") => (
    <FormField label={label}>
      <input
        type={type}
        value={String(draft[key] ?? "")}
        onChange={(e) =>
          set(key, (e.target.value || (key === "endTime" ? null : "")) as never)
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
          ? await eventsApi.update(event.id, input)
          : await eventsApi.create(input),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      description="Only title, date, start time and client are required."
      wide
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {(clients.error || venues.error) && (
          <LoadError message={clients.error ?? venues.error ?? ""} />
        )}
        <FormField label="Title *">
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            autoFocus
          />
        </FormField>
        <div className="form-grid">
          {text("date", "Date *", "date")}
          <FormField label="Client *">
            <select
              value={draft.clientId}
              onChange={(e) => {
                set("clientId", e.target.value);
                set("pocContactId", null);
              }}
            >
              <option value="">Choose a client</option>
              {clients.data?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </FormField>
          {text("startTime", "Start time *", "time")}
          {text("endTime", "End time", "time")}
          <FormField label="Point of contact">
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
            <FormField label="Status">
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
          <FormField label="Venue">
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
          <FormField label="Address" hint="Leave empty to use the venue's.">
            <input
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </FormField>
          {list("eventType", "Event type", "event_type")}
          {list("serviceType", "Service type", "service_type")}
          {list("foodServiceStyle", "Food service style", "food_service_style")}
          <FormField label="Dress code" hint="Pick a preset or type your own.">
            <input
              list="dress-code-presets"
              value={draft.dressCode ?? ""}
              onChange={(e) => set("dressCode", e.target.value)}
            />
            <ListSuggestions id="dress-code-presets" list="dress_code" />
          </FormField>
          {text("guestCount", "Guest count", "number")}
          {text("servingsCount", "Servings count", "number")}
        </div>
        <FormField
          label="Areas"
          hint="One per line. Left unchanged, a newly picked venue's areas are used."
        >
          <textarea
            rows={3}
            value={areas ?? ""}
            onChange={(e) => setAreas(e.target.value)}
          />
        </FormField>
        <FormField label="Transportation notes">
          <textarea
            rows={2}
            value={draft.transportationNotes}
            onChange={(e) => set("transportationNotes", e.target.value)}
          />
        </FormField>
        <FormField label="Internal notes">
          <textarea
            rows={3}
            value={draft.internalNotes}
            onChange={(e) => set("internalNotes", e.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save event
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
  const history = useResource(
    () => eventsApi.statusHistory(event.id),
    [event.id, event.status],
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
    <Section title="Status">
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
          <FormField label="New status">
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
          <FormField label="Why (optional)">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={saving}>
            Change status
          </Button>
        </form>
      )}
      <h3>Status history</h3>
      {history.error ? (
        <LoadError message={history.error} />
      ) : (
        <ul aria-label="Status history">
          {history.data?.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.from
                  ? `${eventStatusDetailLabels[entry.from]} → ${eventStatusDetailLabels[entry.to]}`
                  : `Created as ${eventStatusDetailLabels[entry.to]}`}
              </strong>{" "}
              <small>
                {new Date(entry.at).toLocaleString("en-US")}
                {entry.manual ? "" : " · automatic"}
              </small>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// The event hub (FLOW-57): one page per event with a section for each part of it.
// The API decides which sections the user may see; a section whose module doesn't
// exist yet is never listed.
export function EventDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hub = useResource(() => eventsApi.hub(id), [id]);
  const [edit, setEdit] = useState(false);
  const [archive, setArchive] = useState(false);
  const back = (
    <Link to="/events" className="back-link">
      ← All events
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
    ["Status", statusLabels[e.status]],
  ];
  const render: Partial<Record<HubSection, () => ReactNode>> = {
    details: () => (
      <Fragment key="details">
        <div className="detail-grid">
          <Section title="Event details">
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
                <Link to={`/venues/${e.venue.id}`}>Open venue</Link>
              </p>
            )}
          </Section>
          <Section title="Notes">
            <small>Transportation</small>
            <p>{e.transportationNotes || "—"}</p>
            <small>Internal</small>
            <p>{e.internalNotes || "—"}</p>
          </Section>
        </div>
        <EventStatusPanel
          event={e}
          canChange={canChangeStatus}
          onChanged={setEvent}
        />
      </Fragment>
    ),
    client: () =>
      client && (
        <Section
          key="client"
          title="Client"
          action={<Link to={`/clients/${client.id}`}>Open client</Link>}
        >
          <div className="contact-profile">
            <span className="avatar">{initials(client.name)}</span>
            <div>
              <strong>{client.name}</strong>
              <small>
                {client.kind === "organization" ? "Organization" : "Person"}
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
                  {contact.id === e.pocContactId && " (point of contact)"}
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
    files: () => (
      <Attachments
        key="files"
        recordType="event"
        recordId={e.id}
        title="Event files"
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
            {e.archivedAt && <span className="badge error">Archived</span>}
            <span>{when(e)}</span>
          </p>
        </div>
        {canEdit && (
          <div className="page-actions">
            <Allowed action="events.write">
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil size={14} />
                Edit
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
                  Restore
                </Button>
              </Allowed>
            ) : (
              <Allowed action="events.write">
                <Button variant="outline" onClick={() => setArchive(true)}>
                  <Archive size={14} />
                  Archive
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
        title="Archive this event?"
        onConfirm={async () => {
          await eventsApi.setArchived(e.id, true);
          setArchive(false);
          navigate("/events");
        }}
      >
        {e.title} will be hidden from the event list.
      </ConfirmationDialog>
    </>
  );
}
