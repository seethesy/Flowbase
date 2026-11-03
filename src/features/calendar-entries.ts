import type { EventInput } from "@fullcalendar/core";
import type { Calendar } from "../../shared/calendar";
import { eventStatusLabels } from "../../shared/core-records";

// The calendar API's events and task due dates as FullCalendar entries (FLOW-63).
// Times stay New York wall-clock strings; the calendar runs in UTC so it draws
// them unchanged. Each entry carries the page it opens.
export function toCalendarEntries(calendar: Calendar): EventInput[] {
  return [
    ...calendar.events.map((event) => ({
      id: `event:${event.id}`,
      title: `${event.title} · ${eventStatusLabels[event.status]}`,
      start: event.start,
      end: event.end ?? undefined,
      classNames: ["calendar-event", `calendar-status-${event.status}`],
      extendedProps: { path: `/events/${event.id}` },
    })),
    ...calendar.tasks.map((task) => ({
      id: `task:${task.id}`,
      title: `Task: ${task.title}`,
      start: task.due,
      classNames: ["calendar-task"],
      extendedProps: { path: `/tasks/${task.id}` },
    })),
  ];
}
