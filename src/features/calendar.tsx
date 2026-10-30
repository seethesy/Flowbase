import { useCallback, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import type { DatesSetArg, EventClickArg, EventSourceFuncArg } from "@fullcalendar/core";
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
  // Stable, so re-rendering the page doesn't make FullCalendar fetch again.
  const load = useCallback(async (range: EventSourceFuncArg) => {
    // Dates come as UTC-coerced strings; the end is exclusive.
    const from = range.startStr.slice(0, 10);
    const to = addLocalDays(range.endStr.slice(0, 10), -1);
    try {
      const entries = toCalendarEntries(await calendarApi.get(from, to));
      setError("");
      return entries;
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, []);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
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
      <div className="calendar-panel">
        <FullCalendar
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
          eventClick={open}
          datesSet={remember}
        />
      </div>
    </>
  );
}
