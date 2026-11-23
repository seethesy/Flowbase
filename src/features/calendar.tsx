import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Block, PageGrid } from "../app/page-grid";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
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
import { googleCalendarApi } from "../services/google-calendar";
import type { GoogleEvent } from "../../shared/google-calendar";
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
import { CalendarEventPanel } from "./calendar-panel";
import { toCalendarEntries } from "./calendar-entries";
import { EventTable, saveEventFields } from "./events";
import { EventsHeading } from "./events-heading";
import "./calendar.css";

// The Events screen's Overview tab (FLOW-294; FLOW-265, FLOW-63, ADR-19). Only
// events at Negotiation or later (the API leaves out the rest). Confirmed events
// (Closed, Preparation, Finished) are filled chips in the status color; pending
// ones (Negotiation, Closing) are a colored dot before the time and name. Month,
// Week and Day on FullCalendar's free day and time grids. Below the calendar,
// the events table lists the events in the range it shows, with inline edits
// (FLOW-261) and selection (FLOW-260). The API sends New York wall-clock times
// and the calendar runs in UTC, so they draw unchanged in any browser time zone.
//
// Filters (owner, status), layers (FLOW-67; all off until checked), the view and
// the date are kept in the address, so a reload or a shared link keeps them.
// Clicking an event opens its side panel.

export type CalendarView = "month" | "week" | "day";
const fullCalendarViews: Record<CalendarView, string> = { month: "dayGridMonth", week: "timeGridWeek", day: "timeGridDay" };
// Older links used FullCalendar's view names, or the removed List view.
const viewOf = (value: string | null): CalendarView =>
  value === "week" || value === "timeGridWeek" ? "week" : value === "day" || value === "timeGridDay" ? "day" : "month";
const isStatus = (value: string | null): value is CalendarEventStatus =>
  calendarEventStatuses.includes(value as CalendarEventStatus);
const parseLayers = (value: string | null) =>
  new Set(
    (value ?? "")
      .split(",")
      .filter((layer): layer is CalendarLayer => calendarLayers.includes(layer as CalendarLayer)),
  );

const plugins = [dayGridPlugin, timeGridPlugin];
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
const sundayOf = (date: string) => addLocalDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
// The six weeks the month grid shows, Sunday first.
const gridOf = (month: string) => {
  const from = sundayOf(`${month}-01`);
  return { from, to: addLocalDays(from, 41) };
};
const shortDay = (date: string, withYear = false) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(withYear && { year: "numeric" }), timeZone: "UTC",
  });
// What a view shows (FLOW-294): the days fetched for the calendar, the days the
// events table lists (a month view lists its month), its title, and the dates
// the previous and next buttons go to.
export function calendarRange(view: CalendarView, date: string) {
  if (view === "day")
    return {
      fetch: { from: date, to: date },
      table: { from: date, to: date },
      title: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
      }),
      previous: addLocalDays(date, -1),
      next: addLocalDays(date, 1),
    };
  if (view === "week") {
    const from = sundayOf(date);
    const to = addLocalDays(from, 6);
    return {
      fetch: { from, to },
      table: { from, to },
      title: `${shortDay(from)} – ${shortDay(to, true)}`,
      previous: addLocalDays(date, -7),
      next: addLocalDays(date, 7),
    };
  }
  const month = date.slice(0, 7);
  return {
    fetch: gridOf(month),
    table: { from: `${month}-01`, to: lastOfMonth(month) },
    title: monthTitle(month),
    previous: `${shiftMonth(month, -1)}-01`,
    next: `${shiftMonth(month, 1)}-01`,
  };
}

// The viewer's own Google events (FLOW-268), outlined in blue. Clicking one
// opens it in Google Calendar.
function toGoogleEntries(events: GoogleEvent[]) {
  return events.map((event) => ({
    id: `google:${event.id}`,
    title: event.title,
    start: event.start,
    end: event.end ?? undefined,
    allDay: event.allDay,
    classNames: ["calendar-layer", "calendar-google"],
    extendedProps: { href: event.htmlLink, layer: "google" },
  }));
}

// Connect, show or hide, and disconnect the viewer's own Google Calendar. Hidden
// until Google sign-in is set up for Flowbase.
function GoogleCalendarControls({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
}) {
  const status = useResource(["google-calendar"], googleCalendarApi.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = status.data;
  if (!data?.configured) return null;
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      window.location.assign((await googleCalendarApi.connect()).url);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      await googleCalendarApi.disconnect();
      status.reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="calendar-google-controls">
      {data.connected && !data.needsReconnect && (
        <label className="calendar-layer-toggle calendar-layer-google">
          <RoundCheck checked={on} onChange={(e) => onToggle(e.target.checked)} />
          <T id="calendar.google.my-google-calendar">My Google Calendar</T>
        </label>
      )}
      {!data.connected && (
        <Button variant="outline" disabled={busy} onClick={() => void connect()}>
          <T id="calendar.google.connect">Connect Google Calendar</T>
        </Button>
      )}
      {data.connected && data.needsReconnect && (
        <Button variant="outline" disabled={busy} onClick={() => void connect()}>
          <T id="calendar.google.reconnect">Reconnect Google Calendar</T>
        </Button>
      )}
      {data.connected && (
        <Button variant="ghost" disabled={busy} onClick={() => void disconnect()}>
          <T id="calendar.google.disconnect">Disconnect Google</T>
        </Button>
      )}
      {error && <span role="alert" className="error-message">{error}</span>}
    </span>
  );
}

const googleResults: Record<string, string> = {
  connected: "Google Calendar connected. Your Flowbase events are being copied to the \"Flowbase events\" calendar in Google.",
  cancelled: "Google Calendar wasn't connected.",
  failed: "Google Calendar couldn't be connected. Try again.",
};

// An event chip: time and name, in the status color (FLOW-251). A pending event
// has no fill and a dot in its status color first (FLOW-294). Layer entries draw
// as FullCalendar does.
function renderEntry(arg: EventContentArg) {
  if (!arg.event.extendedProps.eventId) return true;
  return (
    <div className="calendar-chip">
      {arg.event.extendedProps.pending && <span className="calendar-dot" aria-hidden="true" />}
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
  const view = viewOf(params.get("view"));
  const range = calendarRange(view, date);
  const owner = params.get("owner") ?? "";
  const status = isStatus(params.get("status")) ? (params.get("status") as CalendarEventStatus) : "";
  // Layers live in state, so a check shows at once; the address follows (a URL
  // update lands a moment later and would let the box flip back first).
  const [layers, setLayers] = useState(() => parseLayers(params.get("layers")));
  // My Google Calendar (FLOW-268): on by default once connected; "?gcal=0"
  // keeps it off.
  const googleResult = params.get("google") ?? "";
  const [googleOn, setGoogleOn] = useState(() => googleResult === "connected" || params.get("gcal") !== "0");
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
  const toggleGoogle = (on: boolean) => {
    setGoogleOn(on);
    set({ gcal: on ? "" : "0", google: "" });
  };
  const toggle = (layer: CalendarLayer, on: boolean) => {
    const next = new Set(layers);
    if (on) next.add(layer);
    else next.delete(layer);
    setLayers(next);
    set({ layers: calendarLayers.filter((entry) => next.has(entry)).join(",") });
  };

  const { can } = usePermissions();
  const grid = range.fetch;
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
  const google = useResource(["google-calendar"], googleCalendarApi.status);
  const googleShown = googleOn && Boolean(google.data?.connected && !google.data.needsReconnect);
  const googleEvents = useResource(
    ["google-calendar", "events", grid.from, grid.to],
    () => googleCalendarApi.events(grid.from, grid.to),
    { enabled: googleShown, keepPrevious: true },
  );
  const entries = [
    ...(calendar.data ? toCalendarEntries({ ...calendar.data, events: shown }, layers) : []),
    ...(googleShown && googleEvents.data ? toGoogleEntries(googleEvents.data.events) : []),
  ];
  const [selected, setSelected] = useState<string | null>(null);
  const panelEvent = shown.find((event) => event.id === selected);

  // The calendar follows the address.
  const calendarRef = useRef<FullCalendar>(null);
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (api.view.type !== fullCalendarViews[view]) api.changeView(fullCalendarViews[view], date);
    else api.gotoDate(date);
  }, [date, view]);
  const open = (click: EventClickArg) => {
    click.jsEvent.preventDefault();
    const eventId = click.event.extendedProps.eventId as string | undefined;
    const href = click.event.extendedProps.href as string | null | undefined;
    if (eventId) setSelected(eventId);
    else if (click.event.extendedProps.layer === "google") {
      if (href) window.open(href, "_blank", "noopener");
    } else navigate(String(click.event.extendedProps.path));
  };

  return (
    <>
      <EventsHeading tab="overview" />
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
        <GoogleCalendarControls on={googleOn} onToggle={toggleGoogle} />
      </FilterBar>
      {googleResults[googleResult] && (
        <p role="status" className="muted">{googleResults[googleResult]}</p>
      )}
      {googleShown && googleEvents.error && <LoadError message={googleEvents.error} />}
      </Block>
      <Block id="calendar" name="Calendar" h={30}>
      <div className="calendar-toolbar">
        <div className="calendar-toolbar-nav">
          <Button variant="outline" size="icon" aria-label={`Previous ${view}`} onClick={() => set({ date: range.previous })}>‹</Button>
          <Button variant="outline" onClick={() => set({ date: "" })}><T id="calendar.calendar-page.today">Today</T></Button>
          <Button variant="outline" size="icon" aria-label={`Next ${view}`} onClick={() => set({ date: range.next })}>›</Button>
          <h2>{range.title}</h2>
        </div>
        <div className="calendar-view-switch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "month"} onClick={() => set({ view: "" })}>
            <T id="calendar.calendar-page.month">Month</T>
          </button>
          <button type="button" aria-pressed={view === "week"} onClick={() => set({ view: "week" })}>
            <T id="calendar.calendar-page.week">Week</T>
          </button>
          <button type="button" aria-pressed={view === "day"} onClick={() => set({ view: "day" })}>
            <T id="calendar.calendar-page.day">Day</T>
          </button>
        </div>
      </div>
      <p className="calendar-legend">
        <T id="calendar.calendar-page.status">Status:</T>
        {calendarEventStatuses.map((value) => <StatusPill key={value} status={value} />)}
      </p>
      {calendar.error && <LoadError message={calendar.error} />}
      <div className="calendar-panel">
        <FullCalendar
          ref={calendarRef}
          plugins={plugins}
          initialView={fullCalendarViews[view]}
          initialDate={date}
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
      </Block>
      <Block id="events" name="Events" h={20}>
      <CalendarList
        from={range.table.from}
        to={range.table.to}
        owner={owner}
        status={status}
        owners={owners}
      />
      </Block>
      </PageGrid>
      {panelEvent && <CalendarEventPanel event={panelEvent} onClose={() => setSelected(null)} />}
    </>
  );
}

// The events table below the calendar (FLOW-294): the events in the range the
// calendar shows, as FLOW-265's List view had them, in a fixed-height scroll with
// a sticky header. Deleting skips events with a signed contract or an approved
// BEO (the API says why). Bulk: change owner, change status.
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
    <div className="calendar-events-table">
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
    </div>
  );
}
