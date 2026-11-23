import { useDeletable } from "../app/deletable";
import { Dropdown } from "../components/ui/Dropdown";
import { Allowed, usePermissions } from "../app/permissions";
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
  DateTimeCell,
  dateTimeSortKey,
  type TableSelection,
} from "../components/shared";
import { hidden, initials, LoadError } from "../components/record-display";
import { Attachments } from "./attachments";
import { CommunicationLog } from "./communications";
import { date, time } from "./event-format";
import { calendarWhen, calendarWhenParts } from "./calendar-entries";
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
import { RoundCheck } from "../components/ui/round-check";
import { Block, PageGrid } from "../app/page-grid";
import { FieldCard, useShownFields } from "../app/field-card";
import { T, useCopy, LabelT } from "../app/copy";
import { copySlug } from "../../shared/copy";
import { StatusPill, StatusSelect } from "../components/ui/status-pill";
import { mayOverrideStatus } from "../../shared/policy";

const statusLabels = eventStatusLabels;

// Today in New York as YYYY-MM-DD.
const businessToday = () => utcToBusinessTime(new Date()).date;
const defaultEventWindow = () => {
  const today = businessToday();
  return { from: addLocalDays(today, -7), to: addLocalDays(today, 30) };
};
const when = (event: FlowEvent) =>
  `${date(event.date)} · ${time(event.startTime)}${event.endTime ? `–${time(event.endTime)}` : ""}`;

// One or more of an event's fields saved from a table cell or a bulk action:
// the rest is read back first, so the save never undoes someone else's change.
type EventFieldChange = Partial<Pick<EventInput, "title" | "date" | "startTime" | "endTime" | "guestCount" | "clientId" | "venueId" | "assignedSalespersonId">>;
export async function saveEventFields(eventId: string, change: EventFieldChange) {
  const current = await eventsApi.get(eventId);
  if (!current.client) throw new Error("The event needs a client before editing its fields.");
  await eventsApi.update(eventId, {
    title: current.title, date: current.date, startTime: current.startTime,
    endTime: current.endTime, clientId: current.client.id, pocContactId: current.pocContactId,
    venueId: current.venue?.id ?? null, address: current.address,
    eventType: current.eventType, serviceType: current.serviceType,
    foodServiceStyle: current.foodServiceStyle, guestCount: current.guestCount,
    servingsCount: current.servingsCount, assignedSalespersonId: current.assignedSalespersonId,
    dressCode: current.dressCode, arrivalTime: current.arrivalTime,
    transportationNotes: current.transportationNotes, internalNotes: current.internalNotes,
    status: current.status, updatedAt: current.updatedAt,
    ...(change.clientId && change.clientId !== current.client.id && { pocContactId: null }),
    ...(change.venueId && change.venueId !== current.venue?.id && { address: "" }),
    ...change,
  });
}

export function EventTable({
  events,
  error,
  exportName,
  exportAll,
  selection,
  onSaved,
  variant = "list",
  owners = [],
}: {
  events: FlowEvent[];
  error?: string;
  // The Calendar tab's List view (FLOW-265): Status first, the date and time in
  // one column, and the owner.
  variant?: "list" | "calendar";
  // The people an event can be assigned to, for the Owner column.
  owners?: { id: string; name: string }[];
  // FLOW-260: selection and bulk delete, on the events list.
  selection?: TableSelection<FlowEvent>;
  exportName?: string;
  // Every matching event when the list is paged (FLOW-216).
  exportAll?: (onProgress: (rows: number) => void) => Promise<FlowEvent[]>;
  onSaved?: () => void;
}) {
  const navigate = useNavigate();
  const { actor, can } = usePermissions();
  const [statusError, setStatusError] = useState("");
  const clientOptions = useResource(["clients", "event-table-options"], () => allPages((cursor) => clientsApi.list({}, cursor)), { reference: true });
  const venueOptions = useResource(["venues", "event-table-options"], () => allPages((cursor) => venuesApi.list({}, cursor)), { reference: true });
  const edit = async (event: FlowEvent, change: EventFieldChange) => {
    await saveEventFields(event.id, change);
    onSaved?.();
  };
  if (error) return <LoadError message={error} />;
  const listColumns: ColumnDef<FlowEvent, unknown>[] = [
    { accessorKey: "title", header: "Event", meta: { edit: "text", canEdit: () => can("events.write"), onEdit: (row, value) => edit(row, { title: value }) } },
    // FLOW-296: the date with the start time beneath it, sorted by both and
    // edited together.
    { id: "date", header: "Date", accessorFn: (row) => dateTimeSortKey(row.date, row.startTime),
      cell: ({ row }) => <DateTimeCell date={row.original.date} time={row.original.startTime} />,
      meta: { edit: "datetime", canEdit: () => can("events.write"), editValue: (row) => dateTimeSortKey(row.date, row.startTime),
        csv: (row) => `${row.date} ${row.startTime}`,
        onEdit: (row, value) => {
          const [date, startTime] = value.split("T");
          if (!date || !startTime) return Promise.reject(new Error("An event needs a date and a start time."));
          return edit(row, { date, startTime });
        } } },
    { accessorKey: "endTime", header: "End", meta: { edit: "time", canEdit: () => can("events.write"), onEdit: (row, value) => edit(row, { endTime: value || null }) } },
    {
      id: "client",
      header: "Client",
      accessorFn: (event) => event.client?.name ?? "—",
      meta: { edit: "select", canEdit: () => can("events.write"), editValue: (row) => row.client?.id ?? "",
        editOptions: (clientOptions.data ?? []).map((row) => ({ value: row.id, label: row.name })),
        onEdit: (row, value) => edit(row, { clientId: value }) },
    },
    {
      id: "venue",
      header: "Venue",
      accessorFn: (event) => event.venue?.name ?? event.address,
      meta: { edit: "select", canEdit: () => can("events.write"), editValue: (row) => row.venue?.id ?? "",
        editOptions: [{ value: "", label: "None" }, ...(venueOptions.data ?? []).map((row) => ({ value: row.id, label: row.name }))],
        onEdit: (row, value) => edit(row, { venueId: value || null }) },
    },
    {
      id: "guests",
      header: "Guests",
      accessorFn: (event) => event.guestCount ?? "",
      meta: { edit: "number", canEdit: () => can("events.write"), onEdit: (row, value) => edit(row, { guestCount: value ? Number(value) : null }) },
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (event) => statusLabels[event.status],
      // FLOW-275: the status pill dropdown, for whoever may change it by hand
      // (Admin or the event's salesperson, as on the event page).
      cell: ({ row }) => actor && mayOverrideStatus(actor, row.original)
        ? <StatusSelect label={`Status for ${row.original.title}`} value={row.original.status} includeEventStages
          options={eventStatusSchema.options}
          onChange={async (value) => {
            try { await eventsApi.setStatus(row.original.id, { status: eventStatusSchema.parse(value), reason: "" }); onSaved?.(); }
            catch (cause) { setStatusError((cause as Error).message); }
          }} />
        : <StatusPill status={row.original.status} />,
    },
  ];
  const column = (id: string) => listColumns.find((entry) => {
    const named = entry as { id?: string; accessorKey?: string };
    return (named.id ?? named.accessorKey) === id;
  })!;
  const ownerName = (event: FlowEvent) =>
    owners.find((owner) => owner.id === event.assignedSalespersonId)?.name ?? "—";
  const columns: ColumnDef<FlowEvent, unknown>[] = variant === "list" ? listColumns : [
    column("status"),
    {
      id: "when",
      header: "Date & Time",
      accessorFn: (event) => event.startsAt,
      // FLOW-296: the date with the time beneath it, both edited in place.
      cell: ({ row }) => {
        const parts = calendarWhenParts({ start: `${row.original.date}T${row.original.startTime}` });
        return <DateTimeCell date={parts.date} time={parts.time} />;
      },
      meta: { edit: "datetime", canEdit: () => can("events.write"), editValue: (row) => dateTimeSortKey(row.date, row.startTime),
        editDisplay: (row) => {
          const parts = calendarWhenParts({ start: `${row.date}T${row.startTime}` });
          return <DateTimeCell date={parts.date} time={parts.time} />;
        },
        csv: (row) => calendarWhen({ start: `${row.date}T${row.startTime}` }),
        onEdit: (row, value) => {
          const [date, startTime] = value.split("T");
          if (!date || !startTime) return Promise.reject(new Error("An event needs a date and a start time."));
          return edit(row, { date, startTime });
        } },
    },
    column("title"),
    column("client"),
    column("venue"),
    column("guests"),
    {
      id: "owner",
      header: "Owner",
      accessorFn: ownerName,
      meta: { edit: "select", canEdit: () => can("events.write") && owners.length > 0,
        editValue: (row) => row.assignedSalespersonId ?? "",
        editOptions: [{ value: "", label: "No owner" }, ...owners.map((owner) => ({ value: owner.id, label: owner.name }))],
        onEdit: (row, value) => edit(row, { assignedSalespersonId: value || null }) },
    },
  ];
  return (
    <>
    {statusError && <p role="alert" className="table-edit-error">{statusError}</p>}
    <DataTable copyKey="events.event-table" openColumn
      data={events}
      columns={columns}
      onRow={(event) => navigate(`/events/${event.id}`)}
      label={<T id="events.event-table.events">events</T>}
      exportName={exportName}
      exportAll={exportAll}
      selection={selection}
    />
    </>
  );
}

// Events (FLOW-55), created by hand so the calendar and tasks work before leads
// and proposals exist.
export function EventList() {
  const searchEventsClientsOrVenuesPlaceholder = useCopy("events.event-list.search-events-clients-or-venues.placeholder", "Search events, clients or venues…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  // Opens on the past 7 days through the next 30, soonest first (FLOW-179 A1);
  // the date range reaches anything else, and clearing it shows every event.
  const [range, setRange] = useState(defaultEventWindow);
  const term = useDebounced(search.trim());
  // Filter by the displayed status label.
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
  const deletable = useDeletable("event", () => events.reload());
  const data = events.data ?? [];
  return (
    <>
      <PageHeader
        title={<T id="events.event-list.events">Events</T>}
        subtitle={<T id="events.event-list.every-proposal-beo-and-task">Every proposal, BEO and task hangs off an event.</T>}
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
          placeholder={searchEventsClientsOrVenuesPlaceholder} copyId="events.event-list.search-events-clients-or-venues.placeholder"
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
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="events.event-list.show-archived">Show archived</T>
        </label>
        <span className="result-count">
          {events.hasMore ? <T id="events.event-list.events-2" values={{ dataCount: data.length }}>{"{dataCount}+ events"}</T> : <T id="events.event-list.events-3" values={{ dataCount: data.length }}>{"{dataCount} events"}</T>}
        </span>
      </FilterBar>
      {events.loading && !events.data && !events.error ? (
        <LoadingSkeleton />
      ) : (
        <PageGrid pageKey="events.list">
          <Block id="list" name="List" h={24}>
          <EventTable
            events={data}
            error={events.error}
            selection={{ rowId: (row) => row.id, ...deletable }}
            exportName="events"
            exportAll={events.loadAll}
            onSaved={() => events.reload()}
          />
          <LoadMore list={events} label={<T id="events.event-list.load-more-events">Load more events</T>} />
        </Block>
          </PageGrid>
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
  clientId: event?.client?.id ?? clientId,
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
  // Which optional fields to show: the event page's visible field boxes (FLOW-255).
  shows?: (field: string) => boolean;
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
  shows = () => true,
  onClose,
  onSaved,
  conflict,
  onStale,
}: EventFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const typeAClientOrContactPlaceholder = useCopy("events.event-form-fields.type-a-client-or-contact.placeholder", "Type a client or contact name");
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
      description={<T id="events.event-form-fields.only-title-date-start-time">Only title, date, start time and client are required.</T>}
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
              placeholder={typeAClientOrContactPlaceholder} data-copy-id="events.event-form-fields.type-a-client-or-contact.placeholder"
            />
          </FormField>
          <FormField label={<T id="events.event-form-fields.client">Client *</T>}>
            <Dropdown
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
            </Dropdown>
          </FormField>
          {text("startTime", "Start time *", "time")}
          {text("endTime", "End time", "time")}
          <FormField label={<T id="events.event-form-fields.point-of-contact">Point of contact</T>}>
            <Dropdown
              value={draft.pocContactId ?? ""}
              onChange={(e) => set("pocContactId", e.target.value || null)}
            >
              <option value="">None</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </Dropdown>
          </FormField>
          {/* Any status on create; afterwards it changes on the event page. */}
          {!event && (
            <FormField label={<T id="events.event-form-fields.status">Status</T>}>
              <StatusSelect value={draft.status ?? "inquiry"} includeEventStages onChange={(value) => set("status", eventStatusSchema.parse(value))} />
            </FormField>
          )}
          <FormField label={<T id="events.event-form-fields.venue">Venue</T>}>
            <Dropdown
              value={draft.venueId ?? ""}
              onChange={(e) => set("venueId", e.target.value || null)}
            >
              <option value="">No venue (use an address)</option>
              {venues.data?.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </Dropdown>
          </FormField>
          {shows("address") && <FormField label={<T id="events.event-form-fields.address">Address</T>} hint={<T id="events.event-form-fields.leave-empty-to-use-the">{"Leave empty to use the venue's."}</T>}>
            <input
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </FormField>}
          {shows("eventType") && list("eventType", "Event type", "event_type")}
          {shows("serviceType") && list("serviceType", "Service type", "service_type")}
          {shows("foodServiceStyle") && list("foodServiceStyle", "Food service style", "food_service_style")}
          {shows("dressCode") && <FormField label={<T id="events.event-form-fields.dress-code">Dress code</T>} hint={<T id="events.event-form-fields.pick-a-preset-or-type">Pick a preset or type your own.</T>}>
            <input
              list="dress-code-presets"
              value={draft.dressCode ?? ""}
              onChange={(e) => set("dressCode", e.target.value)}
            />
            <ListSuggestions id="dress-code-presets" list="dress_code" />
          </FormField>}
          {shows("arrivalTime") && text("arrivalTime", "Arrival time at venue", "time")}
          {shows("guestCount") && text("guestCount", "Guest count", "number")}
          {shows("servingsCount") && text("servingsCount", "Servings count", "number")}
        </div>
        <FormField
          label={<T id="events.event-form-fields.areas">Areas</T>}
          hint={<T id="events.event-form-fields.one-per-line-left-unchanged">{"One per line. Left unchanged, a newly picked venue's areas are used."}</T>}
        >
          <textarea
            rows={3}
            value={areas ?? ""}
            onChange={(e) => setAreas(e.target.value)}
          />
        </FormField>
        {shows("transportationNotes") && <FormField label={<T id="events.event-form-fields.transportation-notes">Transportation notes</T>}>
          <textarea
            rows={2}
            value={draft.transportationNotes}
            onChange={(e) => set("transportationNotes", e.target.value)}
          />
        </FormField>}
        {shows("internalNotes") && <FormField label={<T id="events.event-form-fields.internal-notes">Internal notes</T>}>
          <textarea
            rows={3}
            value={draft.internalNotes}
            onChange={(e) => set("internalNotes", e.target.value)}
          />
        </FormField>}
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
            <StatusSelect value={target} includeEventStages options={others} onChange={(value) => setTo(eventStatusSchema.parse(value))} />
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
                  ? <><LabelT id="labels.pipeline-status" value={entry.from}>{eventStatusDetailLabels[entry.from]}</LabelT> → <LabelT id="labels.pipeline-status" value={entry.to}>{eventStatusDetailLabels[entry.to]}</LabelT></>
                  : <T id="events.event-status-panel.created-as" values={{ eventStatusDetailLabels: <LabelT id="labels.pipeline-status" value={entry.to}>{eventStatusDetailLabels[entry.to]}</LabelT> }}>{"Created as {eventStatusDetailLabels}"}</T>}
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
      <LoadMore list={history} label={<T id="events.event-status-panel.show-older-changes">Show older changes</T>} />
    </Section>
  );
}

// The event hub (FLOW-57): one page per event with a section for each part of it.
// Hub sections as page blocks (FLOW-253), named for the edit chrome.
const hubSectionNames: Record<HubSection, string> = {
  details: "Details",
  client: "Client",
  proposal: "Proposals",
  booking: "Booking",
  payments: "Payments",
  beo: "BEO",
  planning: "Planning progress",
  pull_list: "Pull list",
  kitchen_menu: "Kitchen menu",
  inventory: "Inventory",
  tasks: "Tasks",
  production: "Production",
  timeline: "Timeline",
  staff: "Staff",
  trucks: "Trucks",
  day_of: "Day of",
  closeout: "Closeout",
  files: "Files",
  history: "History",
};

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
  // Edit shows the fields the page shows (FLOW-255). Notes live in their own
  // block, so they stay in Edit.
  const shownFacts = useShownFields("events.detail", "event-facts");
  const shows = (field: string) => field === "transportationNotes" || field === "internalNotes" || shownFacts(field);
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
  const facts: [string, ReactNode][] = [
    ["When", when(e)],
    ["Client", e.client?.name ?? "—"],
    ["Venue", e.venue?.name ?? <T id="events.event-detail.no-venue">No venue</T>],
    ["Address", e.address || "—"],
    ["Areas", e.areas.map((area) => area.name).join(", ") || "—"],
    ["Event type", e.eventType || "—"],
    ["Service type", e.serviceType || "—"],
    ["Food service style", e.foodServiceStyle || "—"],
    ["Guests", e.guestCount?.toString() ?? "—"],
    ["Servings", e.servingsCount?.toString() ?? "—"],
    ["Dress code", e.dressCode || "—"],
    ["Arrival at venue", e.arrivalTime ? time(e.arrivalTime) : "—"],
    ["Status", <LabelT id="labels.pipeline-status" value={e.status}>{statusLabels[e.status]}</LabelT>],
    ...(e.planningStaleAt ? [["Planning outputs", <T id="events.event-detail.needs-refresh-since" values={{ date: new Date(e.planningStaleAt).toLocaleDateString() }}>{"Needs refresh since {date}"}</T>] as [string, ReactNode]] : []),
  ];
  const render: Partial<Record<HubSection, () => ReactNode>> = {
    details: () => (
      <Fragment key="details">
        <div className="detail-grid">
          <FieldCard cardKey="event-facts" source="events" row={e as unknown as Record<string, unknown>}
            title={<T id="events.event-detail.event-details">Event details</T>}
            fields={["title", "date", "client", "venue", "address", "eventType", "serviceType", "foodServiceStyle", "guestCount", "servingsCount", "dressCode", "arrivalTime", "status"]}>
          <Section title={<T id="events.event-detail.event-details">Event details</T>}>
            <div className="info-grid">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <small><T id={`events.event-detail.${copySlug(label)}`}>{label}</T></small>
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
          </FieldCard>
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
                {client.kind === "organization" ? <T id="events.event-detail.organization" values={{ value: client.tags.length ? ` · ${client.tags.join(", ")}` : "" }}>{"Organization{value}"}</T> : <T id="events.event-detail.person" values={{ value: client.tags.length ? ` · ${client.tags.join(", ")}` : "" }}>{"Person{value}"}</T>}
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
                  <LabelT id="labels.contact-role" value={contact.role}>{contactRoleLabels[contact.role]}</LabelT> · {hidden(contact.email)} ·{" "}
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
            <StatusPill status={e.status} />
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
      <PageGrid
        pageKey="events.detail"
        record={{ source: "events", id: e.id, row: e as unknown as Record<string, unknown> }}
        // The hub's sections, as block ids (FLOW-277 key manifest).
        blockIds={["details", "client", "proposal", "booking", "payments", "beo", "planning", "pull-list", "kitchen-menu", "inventory", "tasks", "production", "timeline", "staff", "trucks", "day-of", "closeout", "files", "history"]}
      >
        {sections.filter((section) => render[section]).map((section) => (
          <Block key={section} id={section.replace(/_/g, "-")} name={hubSectionNames[section]} h={section === "details" ? 18 : 12}>
            {render[section]!()}
          </Block>
        ))}
      </PageGrid>
      {edit && (
        <EventForm
          event={e}
          shows={shows}
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
        <T id="events.event-detail.will-be-hidden-from-the" values={{ title: e.title }}>{"{title} will be hidden from the event list."}</T>
      </ConfirmationDialog>
    </>
  );
}
