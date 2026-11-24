import { useDeletable } from "../../app/live-edit/deletable";
import { Allowed, usePermissions } from "../../app/permissions";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { eventStatusLabels, eventStatusSchema, type EventInput, type FlowEvent } from "../../../shared/core-records";
import { addLocalDays, utcToBusinessTime } from "../../../shared/time";
import { allPages, clientsApi, eventsApi, venuesApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { LoadMore, useDebounced, usePagedList } from "../../app/paging";
import { PageHeader, Button, SearchInput, FilterBar, DataTable, LoadingSkeleton, Select, DateTimeCell, dateTimeSortKey, type TableSelection } from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { date, time } from "./event-format";
import { calendarWhen, calendarWhenParts } from "./calendar-entries";
import { RoundCheck } from "../../components/ui/round-check";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { T, useCopy } from "../../app/copy";
import { StatusPill, StatusSelect } from "../../components/ui/status-pill";
import { mayOverrideStatus } from "../../../shared/policy";
import { EventForm } from "./event-form";

// The events list and the shared events table (FLOW-25/265), with inline field saves.

export const statusLabels = eventStatusLabels;

// Today in New York as YYYY-MM-DD.
const businessToday = () => utcToBusinessTime(new Date()).date;

const defaultEventWindow = () => {
  const today = businessToday();
  return { from: addLocalDays(today, -7), to: addLocalDays(today, 30) };
};

export const when = (event: FlowEvent) =>
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
      <PageHeader pageKey="events.list"
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
