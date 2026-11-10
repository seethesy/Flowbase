import type { EventInput } from "@fullcalendar/core";
import type { Calendar, CalendarEvent, CalendarLayer } from "../../shared/calendar";
import { eventStatusLabels } from "../../shared/core-records";
import { shiftKindLabels } from "../../shared/event-staff";
import { addLocalDays } from "../../shared/time";

// The calendar API's events and task due dates as FullCalendar entries (FLOW-63).
// Times stay New York wall-clock strings; the calendar runs in UTC so it draws
// them unchanged. Each entry carries the page it opens.

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

// Overview mode (FLOW-64): the compact line under an event's time and title.
export function overviewLine(event: CalendarEvent): string {
  return [
    event.venueName ?? "No venue",
    event.guestCount === null ? "Guests TBD" : plural(event.guestCount, "guest"),
    event.salespersonName ?? "No salesperson",
    plural(event.staffCount, "staff", "staff"),
  ].join(" · ");
}

export function toCalendarEntries(
  calendar: Calendar,
  layers: ReadonlySet<CalendarLayer> = new Set(),
): EventInput[] {
  const own = new Set(calendar.tasks.map((task) => task.id));
  return [
    ...calendar.events.map((event) => ({
      id: `event:${event.id}`,
      title: `${event.title} · ${eventStatusLabels[event.status]}`,
      start: event.start,
      end: event.end ?? undefined,
      // A block in the month view too, so the overview line fits under the title.
      display: "block",
      classNames: ["calendar-event", `calendar-status-${event.status}`],
      extendedProps: { path: `/events/${event.id}`, eventId: event.id, overview: overviewLine(event) },
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
