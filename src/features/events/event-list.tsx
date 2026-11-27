import { usePermissions } from "../../app/permissions";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";
import { eventStatusLabels, eventStatusSchema, type EventInput, type FlowEvent } from "../../../shared/core-records";
import { allPages, clientsApi, eventsApi, venuesApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { DataTable, DateTimeCell, dateTimeSortKey, type TableSelection, ErrorText } from "../../components/shared";
import { date, time } from "./event-format";
import { calendarWhen, calendarWhenParts } from "./calendar-entries";
import { T } from "../../app/copy";
import { StatusPill, StatusSelect } from "../../components/ui/status-pill";
import { mayOverrideStatus } from "../../../shared/policy";

// The shared events table (FLOW-25/265), with inline field saves. Events ›
// Overview lists it under the calendar; the old events list page is gone
// (FLOW-349).

export const statusLabels = eventStatusLabels;

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
  if (error) return <ErrorText message={error} />;
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
