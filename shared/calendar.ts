import { z } from "zod";
import { eventStatusSchema } from "./core-records";
import { id, localDate } from "./schema-primitives";
import { taskPrioritySchema, taskStatusSchema } from "./tasks";

// Basic calendar (FLOW-63, ADR-19): events and task due dates in a date range,
// limited to what the viewer may see. Every time is a New York wall-clock time
// ("YYYY-MM-DDTHH:mm"); the page shows it as is, whatever the browser's zone.

// The longest range one request may ask for: a month view shows six weeks.
export const CALENDAR_MAX_DAYS = 62;

const dayCount = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

// GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD, both New York dates, inclusive.
export const calendarRangeSchema = z
  .object({ from: localDate, to: localDate })
  .refine(
    ({ from, to }) => dayCount(from, to) >= 1,
    "The range must end on or after its start.",
  )
  .refine(
    ({ from, to }) => dayCount(from, to) <= CALENDAR_MAX_DAYS,
    `Ask for at most ${CALENDAR_MAX_DAYS} days at a time.`,
  );
export type CalendarRange = z.infer<typeof calendarRangeSchema>;

const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const calendarEventSchema = z.object({
  id,
  title: z.string(),
  status: eventStatusSchema,
  start: wallClock,
  // Null when the event has no end time.
  end: wallClock.nullable(),
  clientName: z.string(),
  venueName: z.string().nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarTaskSchema = z.object({
  id,
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  due: wallClock,
  eventId: id.nullable(),
});
export type CalendarTask = z.infer<typeof calendarTaskSchema>;

export const calendarSchema = z.object({
  events: z.array(calendarEventSchema),
  // Open tasks the viewer is assigned to, oversees or created, by due time.
  tasks: z.array(calendarTaskSchema),
});
export type Calendar = z.infer<typeof calendarSchema>;
