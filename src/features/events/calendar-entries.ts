import type { EventInput } from "@fullcalendar/core";
import type { Calendar, CalendarLayer } from "../../../shared/calendar";
import { shiftKindLabels } from "../../../shared/event-staff";
import { addLocalDays } from "../../../shared/time";

// The calendar API's events and task due dates as FullCalendar entries (FLOW-63).
// Times stay New York wall-clock strings; the calendar runs in UTC so it draws
// them unchanged. Each entry carries the page it opens.

// Negotiation and Closing aren't confirmed yet (FLOW-294); Closed, Preparation
// and Finished are.
export const isPendingStatus = (status: string) => status === "negotiation" || status === "closing";

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const clock = (wallClock: string) => {
  const [hours, minutes] = wallClock.slice(11, 16).split(":").map(Number);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
};
// "Sat, Nov 28" for a New York date.
export const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });

// "Sat, Nov 28" and "4:30 PM": a table cell's date with the time beneath it
// (FLOW-296).
export function calendarWhenParts(event: { start: string }): { date: string; time: string } {
  return { date: weekday(event.start.slice(0, 10)), time: clock(event.start) };
}

// "Sat, Nov 28 · 4:30 PM", the side panel's and list's date and time (FLOW-265).
export function calendarWhen(event: { start: string }): string {
  return `${weekday(event.start.slice(0, 10))} · ${clock(event.start)}`;
}

export function toCalendarEntries(
  calendar: Calendar,
  layers: ReadonlySet<CalendarLayer> = new Set(),
): EventInput[] {
  const own = new Set(calendar.tasks.map((task) => task.id));
  return [
    ...calendar.events.map((event) => ({
      id: `event:${event.id}`,
      title: event.title,
      start: event.start,
      end: event.end ?? undefined,
      // A chip in the status color (FLOW-251), with its time and name (FLOW-265):
      // filled when confirmed, a dot and no fill while pending (FLOW-294).
      display: "block",
      classNames: [
        "calendar-event",
        `calendar-status-${event.status}`,
        isPendingStatus(event.status) ? "calendar-pending" : "calendar-confirmed",
      ],
      extendedProps: {
        path: `/events/${event.id}`,
        eventId: event.id,
        status: event.status,
        pending: isPendingStatus(event.status),
      },
    })),
    ...calendar.tasks.map((task) => ({
      id: `task:${task.id}`,
      title: `Task: ${task.title}`,
      start: task.due,
      classNames: ["calendar-task"],
      extendedProps: { path: `/tasks/${task.id}` },
    })),
    // Layers (FLOW-67). A production task the viewer is on already shows above.
    ...(layers.has("production")
      ? calendar.layers.production
          .filter((task) => !own.has(task.id))
          .map((task) => ({
            id: `production:${task.id}`,
            title: `Production: ${task.title}`,
            start: task.due,
            classNames: ["calendar-layer", "calendar-production"],
            extendedProps: { path: `/tasks/${task.id}`, layer: "production" },
          }))
      : []),
    ...(layers.has("holds")
      ? calendar.layers.holds.map((hold) => ({
          id: `hold:${hold.eventId}:${hold.start}:${hold.end}`,
          title: `Tentative hold: ${hold.eventTitle} · ${plural(hold.items, "item")}`,
          start: hold.start,
          // All-day ends are exclusive.
          end: addLocalDays(hold.end, 1),
          allDay: true,
          classNames: ["calendar-layer", "calendar-hold"],
          extendedProps: { path: `/events/${hold.eventId}`, layer: "holds" },
        }))
      : []),
    ...(layers.has("shifts")
      ? calendar.layers.shifts.map((shift) => ({
          id: `shift:${shift.id}`,
          title: `${shiftKindLabels[shift.kind]}: ${shift.eventTitle} · ${shift.staffed}/${shift.slots} staffed`,
          start: shift.start,
          end: shift.end,
          classNames: ["calendar-layer", "calendar-shift"],
          extendedProps: { path: `/events/${shift.eventId}`, layer: "shifts" },
        }))
      : []),
  ];
}
