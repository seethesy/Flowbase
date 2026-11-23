import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Block, PageGrid } from "../app/page-grid";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import type { EventClickArg, EventContentArg } from "@fullcalendar/core";
import {
  calendarEventStatuses,
  calendarLayerLabels,
  calendarLayers,
  type CalendarEventStatus,
  type CalendarLayer,
} from "../../shared/calendar";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { calendarApi, eventsApi } from "../services/core";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
import { LoadMore, usePagedList } from "../app/paging";
import { useDeletable } from "../app/deletable";
import { usePermissions } from "../app/permissions";
import { LoadError } from "../components/record-display";
import { Button, FilterBar } from "../components/shared";
import { Dropdown } from "../components/ui/Dropdown";
import { RoundCheck } from "../components/ui/round-check";
import { StatusPill, statusLabel } from "../components/ui/status-pill";
import { T, LabelT } from "../app/copy";
import { CalendarEventPanel } from "./calendar-detail";
import { toCalendarEntries } from "./calendar-entries";
import { EventTable, saveEventFields } from "./events";
import { EventsHeading } from "./events-heading";
import "./calendar.css";

// The Events screen's Calendar tab (FLOW-265; FLOW-63, ADR-19). Only events at
// Negotiation or later (the API leaves out the rest), drawn as status-colored
// chips with their time and name. Month view on FullCalendar's free day grid;
// List view is the events table for the same month, with inline edits (FLOW-261)
// and selection (FLOW-260). The API sends New York wall-clock times and the
// calendar runs in UTC, so they draw unchanged in any browser time zone.
//
// Filters (owner, status), layers (FLOW-67; all off until checked), the view and
// the month are kept in the address, so a reload or a shared link keeps them.
// Clicking an event opens its side panel.

type View = "month" | "list";
// Older links used FullCalendar's view names.
const viewOf = (value: string | null): View =>
  value === "list" || value === "listMonth" ? "list" : "month";
const isStatus = (value: string | null): value is CalendarEventStatus =>
  calendarEventStatuses.includes(value as CalendarEventStatus);
const parseLayers = (value: string | null) =>
  new Set(
    (value ?? "")
      .split(",")
      .filter((layer): layer is CalendarLayer => calendarLayers.includes(layer as CalendarLayer)),
  );

const plugins = [dayGridPlugin];
const eventTimeFormat = { hour: "numeric", minute: "2-digit", meridiem: "short" } as const;
const nowInNewYork = () => {
  const { date, time } = utcToBusinessTime(new Date());
  return `${date}T${time}:00`;
};
const monthTitle = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const lastOfMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
};
const shiftMonth = (month: string, by: number) => {
  const [year, number] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, number - 1 + by, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
};
// The six weeks the month grid shows, Sunday first.
const gridOf = (month: string) => {
  const first = `${month}-01`;
  const from = addLocalDays(first, -new Date(`${first}T12:00:00Z`).getUTCDay());
  return { from, to: addLocalDays(from, 41) };
};

// An event chip: time and name, in the status color (FLOW-251). Layer entries
// draw as FullCalendar does.
function renderEntry(arg: EventContentArg) {
  if (!arg.event.extendedProps.eventId) return true;
  return (
    <div className="calendar-chip">
      {arg.timeText && <span className="fc-event-time">{arg.timeText}</span>}
      <span className="fc-event-title">{arg.event.title}</span>
    </div>
  );
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = utcToBusinessTime(new Date()).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const month = date.slice(0, 7);
  const view = viewOf(params.get("view"));
  const owner = params.get("owner") ?? "";
  const status = isStatus(params.get("status")) ? (params.get("status") as CalendarEventStatus) : "";
  // Layers live in state, so a check shows at once; the address follows (a URL
  // update lands a moment later and would let the box flip back first).
  const [layers, setLayers] = useState(() => parseLayers(params.get("layers")));
  const set = (changes: Record<string, string>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const toggle = (layer: CalendarLayer, on: boolean) => {
    const next = new Set(layers);
    if (on) next.add(layer);
    else next.delete(layer);
    setLayers(next);
    set({ layers: calendarLayers.filter((entry) => next.has(entry)).join(",") });
  };

  const { can } = usePermissions();
  const grid = gridOf(month);
  const calendar = useResource(["calendar", grid.from, grid.to], () => calendarApi.get(grid.from, grid.to), {
    keepPrevious: true,
  });
  // Owners: whoever may hold an event (when the viewer may list them), and the
  // owners of the events in view.
  const people = useResource(["lead-owners"], leadsApi.owners, { enabled: can("leads.read"), reference: true });
  const owners = useMemo(() => {
    const byId = new Map((people.data ?? []).map((person) => [person.id, person.name]));
    for (const event of calendar.data?.events ?? [])
      if (event.salespersonId && event.salespersonName && !byId.has(event.salespersonId))
        byId.set(event.salespersonId, event.salespersonName);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data, calendar.data]);
  const shown = (calendar.data?.events ?? []).filter(
    (event) => (!owner || event.salespersonId === owner) && (!status || event.status === status),
  );
  const entries = calendar.data ? toCalendarEntries({ ...calendar.data, events: shown }, layers) : [];
  const [selected, setSelected] = useState<string | null>(null);
  const panelEvent = shown.find((event) => event.id === selected);

  // The month grid follows the address.
  const calendarRef = useRef<FullCalendar>(null);
  useEffect(() => {
    calendarRef.current?.getApi().gotoDate(`${month}-01`);
  }, [month, view]);
  const open = (click: EventClickArg) => {
    click.jsEvent.preventDefault();
    const eventId = click.event.extendedProps.eventId as string | undefined;
    if (eventId) setSelected(eventId);
    else navigate(String(click.event.extendedProps.path));
  };

  return (
    <>
      <EventsHeading tab="calendar" />
      <PageGrid pageKey="calendar.page">
      <Block id="layers" name="Filters and layers" h={3}>
      <FilterBar>
        <Dropdown
          variant="filter"
          aria-label="Owner"
          value={owner}
          options={[
            { value: "", label: <T id="calendar.calendar-page.all-owners">All owners</T>, text: "All owners" },
            ...owners.map((person) => ({ value: person.id, label: person.name })),
          ]}
          onValueChange={(next) => set({ owner: next })}
        />
        <Dropdown
          variant="filter"
          aria-label="Status"
          value={status}
          options={[
            { value: "", label: <T id="calendar.calendar-page.all-statuses">All statuses</T>, text: "All statuses" },
            ...calendarEventStatuses.map((value) => ({
              value,
              label: <LabelT id="labels.pipeline-status" value={value}>{statusLabel(value)}</LabelT>,
              text: statusLabel(value),
            })),
          ]}
          onValueChange={(next) => set({ status: next })}
        />
        <fieldset className="calendar-layers">
          <legend className="sr-only"><T id="calendar.calendar-page.layers">Layers</T></legend>
          {calendarLayers.map((layer) => (
            <label key={layer} className={`calendar-layer-toggle calendar-layer-${layer}`}>
              <RoundCheck checked={layers.has(layer)} onChange={(e) => toggle(layer, e.target.checked)} />
              <LabelT id="labels.calendar-layer" value={layer}>{calendarLayerLabels[layer]}</LabelT>
            </label>
          ))}
        </fieldset>
      </FilterBar>
      </Block>
      <Block id="calendar" name="Calendar" h={30}>
      <div className="calendar-toolbar">
        <div className="calendar-toolbar-nav">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => set({ date: `${shiftMonth(month, -1)}-01` })}>‹</Button>
          <Button variant="outline" onClick={() => set({ date: "" })}><T id="calendar.calendar-page.today">Today</T></Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => set({ date: `${shiftMonth(month, 1)}-01` })}>›</Button>
          <h2>{monthTitle(month)}</h2>
        </div>
        <div className="calendar-view-switch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "month"} onClick={() => set({ view: "" })}>
            <T id="calendar.calendar-page.month">Month</T>
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => set({ view: "list" })}>
            <T id="calendar.calendar-page.list">List</T>
          </button>
        </div>
      </div>
      {view === "month" && (
        <>
          <p className="calendar-legend">
            <T id="calendar.calendar-page.status">Status:</T>
            {calendarEventStatuses.map((value) => <StatusPill key={value} status={value} />)}
          </p>
          {calendar.error && <LoadError message={calendar.error} />}
          <div className="calendar-panel">
            <FullCalendar
              ref={calendarRef}
              plugins={plugins}
              initialView="dayGridMonth"
              initialDate={`${month}-01`}
              timeZone="UTC"
              now={nowInNewYork}
              headerToolbar={false}
              eventTimeFormat={eventTimeFormat}
              height="auto"
              dayMaxEvents={false}
              events={entries}
              eventContent={renderEntry}
              eventClick={open}
            />
          </div>
        </>
      )}
      {view === "list" && (
        <CalendarList
          from={`${month}-01`}
          to={lastOfMonth(month)}
          owner={owner}
          status={status}
          owners={owners}
        />
      )}
      </Block>
      </PageGrid>
      {panelEvent && <CalendarEventPanel event={panelEvent} onClose={() => setSelected(null)} />}
    </>
  );
}

// List view: the month's events as the events table (FLOW-265). Deleting skips
// events with a signed contract or an approved BEO (the API says why). Bulk:
// change owner, change status.
function CalendarList({
  from,
  to,
  owner,
  status,
  owners,
}: {
  from: string;
  to: string;
  owner: string;
  status: CalendarEventStatus | "";
  owners: { id: string; name: string }[];
}) {
  const { can } = usePermissions();
  const statuses = status ? [status] : [...calendarEventStatuses];
  const list = usePagedList(["events", "calendar-list", from, to, statuses.join(",")], (cursor) =>
    eventsApi.list({ from, to, statuses }, cursor),
  );
  const rows = (list.data ?? []).filter((event) => !owner || event.assignedSalespersonId === owner);
  const deletable = useDeletable("event", () => list.reload());
  const [error, setError] = useState("");
  const bulk = async (ids: string[], clear: () => void, change: (id: string) => Promise<unknown>) => {
    setError("");
    const failed: string[] = [];
    for (const id of ids) {
      try { await change(id); }
      catch (cause) { failed.push(`${rows.find((row) => row.id === id)?.title ?? id}: ${(cause as Error).message}`); }
    }
    if (failed.length) setError(failed.join(" "));
    clear();
    list.reload();
  };
  return (
    <>
      {error && <p role="alert" className="error-message">{error}</p>}
      <EventTable
        variant="calendar"
        events={rows}
        error={list.error}
        owners={owners}
        onSaved={() => list.reload()}
        exportName="events"
        selection={{
          rowId: (row) => row.id,
          ...deletable,
          actions: can("events.write")
            ? (ids, clear) => (
                <>
                  {owners.length > 0 && (
                    <Dropdown
                      variant="dark"
                      aria-label="Change owner"
                      value=""
                      options={[
                        { value: "", label: <T id="calendar.calendar-list.change-owner">Change owner</T>, text: "Change owner" },
                        ...owners.map((person) => ({ value: person.id, label: person.name })),
                      ]}
                      onValueChange={(next) => next && void bulk(ids, clear, (id) => saveEventFields(id, { assignedSalespersonId: next }))}
                    />
                  )}
                  <Dropdown
                    variant="dark"
                    aria-label="Change status"
                    value=""
                    options={[
                      { value: "", label: <T id="calendar.calendar-list.change-status">Change status</T>, text: "Change status" },
                      ...calendarEventStatuses.map((value) => ({
                        value,
                        label: <LabelT id="labels.pipeline-status" value={value}>{statusLabel(value)}</LabelT>,
                        text: statusLabel(value),
                      })),
                    ]}
                    onValueChange={(next) =>
                      next && void bulk(ids, clear, (id) => eventsApi.setStatus(id, { status: next as CalendarEventStatus, reason: "" }))
                    }
                  />
                </>
              )
            : undefined,
        }}
      />
      <LoadMore list={list} label={<T id="calendar.calendar-list.load-more-events">Load more events</T>} />
      <p className="muted calendar-list-hint">
        <T id="calendar.calendar-list.click-a-cell-to-edit">Click a cell to edit it. Drag across rows to select, Shift+click to extend, Ctrl/Cmd+click or drag to add more rows. Delete key or the Delete button removes them; Ctrl+Z undoes.</T>
      </p>
    </>
  );
}
