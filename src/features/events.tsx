import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  eventStatusSchema,
  type EventInput,
  type EventStatus,
  type FlowEvent,
} from "../../shared/core-records";
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
import { LoadError } from "./clients";
import { Attachments } from "./attachments";

export const statusLabels: Record<EventStatus, string> = {
  tentative: "Tentative",
  booked: "Booked",
  completed: "Completed",
  cancelled: "Cancelled",
};
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
}: {
  events: FlowEvent[];
  error?: string;
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
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          New Event
        </Button>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search events, clients or venues…"
        />
        <Select
          label="Statuses"
          options={Object.values(statusLabels)}
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
        <EventTable events={data} error={events.error} />
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
  status: event?.status ?? "tentative",
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
          <FormField label="Status">
            <select
              value={draft.status}
              onChange={(e) =>
                set("status", eventStatusSchema.parse(e.target.value))
              }
            >
              {eventStatusSchema.options.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </FormField>
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
          {text("eventType", "Event type")}
          {text("serviceType", "Service type")}
          {text("foodServiceStyle", "Food service style")}
          {text("dressCode", "Dress code")}
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

export function EventDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const event = useResource(() => eventsApi.get(id), [id]);
  const [edit, setEdit] = useState(false);
  const [archive, setArchive] = useState(false);
  const back = (
    <Link to="/events" className="back-link">
      ← All events
    </Link>
  );
  if (event.error)
    return (
      <>
        {back}
        <LoadError message={event.error} />
      </>
    );
  const e = event.data;
  if (!e) return <LoadingSkeleton />;
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
        <div className="page-actions">
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          {e.archivedAt ? (
            <Button
              variant="outline"
              onClick={async () =>
                event.replace(await eventsApi.setArchived(e.id, false))
              }
            >
              <RotateCcw size={14} />
              Restore
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setArchive(true)}>
              <Archive size={14} />
              Archive
            </Button>
          )}
        </div>
      </div>
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
          <p>
            <Link to={`/clients/${e.client.id}`}>Open client</Link>
            {e.venue && (
              <>
                {" · "}
                <Link to={`/venues/${e.venue.id}`}>Open venue</Link>
              </>
            )}
          </p>
        </Section>
        <Section title="Notes">
          <small>Transportation</small>
          <p>{e.transportationNotes || "—"}</p>
          <small>Internal</small>
          <p>{e.internalNotes || "—"}</p>
        </Section>
      </div>
      <Attachments recordType="event" recordId={e.id} title="Event files" />
      {edit && (
        <EventForm
          event={e}
          onClose={() => setEdit(false)}
          onSaved={event.replace}
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
