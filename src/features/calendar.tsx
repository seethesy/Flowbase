import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventSourceFuncArg,
} from "@fullcalendar/core";
import {
  calendarLayerLabels,
  calendarLayers,
  type Calendar,
  type CalendarLayer,
} from "../../shared/calendar";
import { isLocalDate } from "../../shared/schema-primitives";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { calendarApi } from "../services/core";
import { LoadError } from "../components/record-display";
import { toCalendarEntries } from "./calendar-entries";
import "./calendar.css";

// Basic calendar (FLOW-63, ADR-19): FullCalendar's free standard views only
// (month, week, day, list). The API sends New York wall-clock times, and the
// calendar runs in UTC so it draws them unchanged in any browser time zone; "now"
// is New York's wall clock read the same way. Clicking an event opens its hub,
// a task opens the task.
//
// Overview mode (FLOW-64): each event shows its venue, guest count, salesperson
// and staff count under its time and title. Layers (FLOW-67) are toggled with the
// checkboxes above the calendar and kept in the address; the API sends every layer,
// so a toggle redraws from the loaded range without asking again.

const views = ["dayGridMonth", "timeGridWeek", "timeGridDay", "listMonth"] as const;
type View = (typeof views)[number];
const isView = (value: string | null): value is View =>
  views.includes(value as View);

// Options as constants: FullCalendar re-applies any option whose object changes,
// and this page re-renders whenever the address changes.
const plugins = [dayGridPlugin, timeGridPlugin, listPlugin];
const headerToolbar = { left: "prev,next today", center: "title", right: views.join(",") };
const buttonText = { today: "Today" };
const viewOptions = {
  dayGridMonth: { buttonText: "Month" },
  timeGridWeek: { buttonText: "Week" },
  timeGridDay: { buttonText: "Day" },
  listMonth: { buttonText: "List" },
};
const eventTimeFormat = { hour: "numeric", minute: "2-digit", meridiem: "short" } as const;

const parseLayers = (value: string | null) =>
  new Set(
    (value ?? "")
      .split(",")
      .filter((layer): layer is CalendarLayer =>
        calendarLayers.includes(layer as CalendarLayer),
      ),
  );

// Events get the overview line; every other entry draws as FullCalendar does.
function renderEntry(arg: EventContentArg) {
  const overview = arg.event.extendedProps.overview as string | undefined;
  if (overview === undefined) return true;
  // The list view has its own time column.
  const showTime = !arg.view.type.startsWith("list") && arg.timeText;
  return (
    <div className="calendar-overview">
      {showTime && <div className="fc-event-time">{arg.timeText}</div>}
      <div className="fc-event-title">{arg.event.title}</div>
      <div className="calendar-overview-details">{overview}</div>
    </div>
  );
}

const nowInNewYork = () => {
  const { date, time } = utcToBusinessTime(new Date());
  return `${date}T${time}:00`;
};

export function CalendarPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState("");
  // The view and date in the address, so a reload or a shared link keeps them.
  const initial = useRef({
    view: isView(params.get("view")) ? (params.get("view") as View) : "dayGridMonth",
    date: isLocalDate(params.get("date") ?? "") ? params.get("date")! : undefined,
  });
  const calendarRef = useRef<FullCalendar>(null);
  const [layers, setLayers] = useState(() => parseLayers(params.get("layers")));
  const layersRef = useRef(layers);
  layersRef.current = layers;
  // The last range loaded, so toggling a layer redraws it without a request.
  const loaded = useRef<{ key: string; calendar: Promise<Calendar> } | null>(null);
  // Stable, so re-rendering the page doesn't make FullCalendar fetch again.
  const load = useCallback(async (range: EventSourceFuncArg) => {
    // Dates come as UTC-coerced strings; the end is exclusive.
    const from = range.startStr.slice(0, 10);
    const to = addLocalDays(range.endStr.slice(0, 10), -1);
    const key = `${from}/${to}`;
    if (loaded.current?.key !== key)
      loaded.current = { key, calendar: calendarApi.get(from, to) };
    const request = loaded.current;
    try {
      const entries = toCalendarEntries(await request.calendar, layersRef.current);
      setError("");
      return entries;
    } catch (e) {
      // A failed range is asked for again next time.
      if (loaded.current === request) loaded.current = null;
      setError((e as Error).message);
      return [];
    }
  }, []);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const firstLayers = useRef(true);
  useEffect(() => {
    if (firstLayers.current) {
      firstLayers.current = false;
      return;
    }
    calendarRef.current?.getApi().refetchEvents();
    setParamsRef.current(
      (current) => {
        const next = new URLSearchParams(current);
        if (layers.size) next.set("layers", calendarLayers.filter((l) => layers.has(l)).join(","));
        else next.delete("layers");
        return next;
      },
      { replace: true },
    );
  }, [layers]);
  const toggle = (layer: CalendarLayer, on: boolean) =>
    setLayers((current) => {
      const next = new Set(current);
      if (on) next.add(layer);
      else next.delete(layer);
      return next;
    });
  const remember = useCallback((dates: DatesSetArg) => {
    const date = dates.view.currentStart.toISOString().slice(0, 10);
    setParamsRef.current(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("view", dates.view.type);
        next.set("date", date);
        return next;
      },
      { replace: true },
    );
  }, []);
  const open = useCallback(
    (click: EventClickArg) => {
      click.jsEvent.preventDefault();
      navigate(String(click.event.extendedProps.path));
    },
    [navigate],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Calendar</h1>
          <p>Events and the tasks you're on, in New York time.</p>
        </div>
      </div>
      {error && <LoadError message={error} />}
      <fieldset className="calendar-layers">
        <legend>Layers</legend>
        {calendarLayers.map((layer) => (
          <label key={layer} className={`calendar-layer-toggle calendar-layer-${layer}`}>
            <input
              type="checkbox"
              checked={layers.has(layer)}
              onChange={(e) => toggle(layer, e.target.checked)}
            />
            {calendarLayerLabels[layer]}
          </label>
        ))}
      </fieldset>
      <div className="calendar-panel">
        <FullCalendar
          ref={calendarRef}
          plugins={plugins}
          initialView={initial.current.view}
          initialDate={initial.current.date}
          timeZone="UTC"
          now={nowInNewYork}
          headerToolbar={headerToolbar}
          buttonText={buttonText}
          views={viewOptions}
          eventTimeFormat={eventTimeFormat}
          height="auto"
          dayMaxEvents
          events={load}
          eventContent={renderEntry}
          eventClick={open}
          datesSet={remember}
        />
      </div>
    </>
  );
}
