import { z } from "zod";
import { eventStatusSchema } from "./core-records";
import { shiftKindSchema } from "./event-staff";
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
  // Overview mode (FLOW-64). None of these is in a restricted field group
  // (shared/visibility.ts), so everyone who may open the event sees them.
  guestCount: z.number().int().nullable(),
  // Null when the event has no salesperson.
  salespersonName: z.string().nullable(),
  // People assigned to the event's staffing slots, each counted once.
  staffCount: z.number().int(),
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

// Calendar layers (FLOW-67): event-related schedules the page can show or hide.
// The API always sends every layer, so toggling one needs no new request. Truck
// assignments and expected order deliveries join when their modules exist.
export const calendarLayers = ["production", "holds", "shifts"] as const;
export const calendarLayerSchema = z.enum(calendarLayers);
export type CalendarLayer = z.infer<typeof calendarLayerSchema>;
export const calendarLayerLabels: Record<CalendarLayer, string> = {
  production: "Production tasks",
  holds: "Tentative holds",
  shifts: "Staff shifts",
};

// The tentative rental holds of one event over one window of New York dates.
export const calendarHoldSchema = z.object({
  eventId: id,
  eventTitle: z.string(),
  // Inclusive New York dates.
  start: localDate,
  end: localDate,
  // Distinct items held and their total quantity.
  items: z.number().int(),
  quantity: z.number(),
});
export type CalendarHold = z.infer<typeof calendarHoldSchema>;

// A shift on an event's roster (FLOW-140), including setup days before it.
export const calendarShiftSchema = z.object({
  id,
  eventId: id,
  eventTitle: z.string(),
  kind: shiftKindSchema,
  start: wallClock,
  end: wallClock,
  slots: z.number().int(),
  // Slots with someone assigned.
  staffed: z.number().int(),
});
export type CalendarShift = z.infer<typeof calendarShiftSchema>;

export const calendarSchema = z.object({
  events: z.array(calendarEventSchema),
  // Open tasks the viewer is assigned to, oversees or created, by due time.
  tasks: z.array(calendarTaskSchema),
  layers: z.object({
    // Open production tasks the viewer may see (FT+ all, others their own).
    production: z.array(calendarTaskSchema),
    // Tentative holds and shifts on the events the viewer may open.
    holds: z.array(calendarHoldSchema),
    shifts: z.array(calendarShiftSchema),
  }),
});
export type Calendar = z.infer<typeof calendarSchema>;
