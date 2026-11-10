import { z } from "zod";
import { eventStatusSchema } from "./core-records";
import { shiftKindSchema } from "./event-staff";
import { id, localDate, text, timestamp } from "./schema-primitives";
import { truckStatusSchema, type truckStatuses } from "./trucks";

// Day-of board and update log (FLOW-155/156, ADR-11, Q-26, Q-50). For one New York
// date, the board lists every event the viewer may open with its staff (location,
// assignment, status), its trucks (location, driver, status, all set by hand, no
// GPS) and its timeline checkpoints. Managers update it through the day; every
// update appends one row to the permanent day-of log. Everyone's open board stays
// fresh through the shared freshness service (FLOW-206): nothing here broadcasts.

export const dayOfStaffStatuses = [
  "scheduled",
  "en_route",
  "on_site",
  "working",
  "on_break",
  "done",
] as const;
export const dayOfStaffStatusSchema = z.enum(dayOfStaffStatuses);
export type DayOfStaffStatus = z.infer<typeof dayOfStaffStatusSchema>;
export const dayOfStaffStatusLabels: Record<DayOfStaffStatus, string> = {
  scheduled: "Scheduled",
  en_route: "En route",
  on_site: "On site",
  working: "Working",
  on_break: "On break",
  done: "Done",
};

export type TruckStatus = (typeof truckStatuses)[number];
export const dayOfTruckStatusLabels: Record<TruckStatus, string> = {
  available: "Available",
  loading: "Loading",
  en_route: "En route",
  at_event: "At event",
  returning: "Returning",
  maintenance: "Maintenance",
};

// The checkpoints of an event day, in the order they happen. Each has a planned
// time taken from the event itself (see worker/records/day-of.ts) and an actual
// time a manager records.
export const dayOfCheckpointKeys = [
  "food_left_kitchen",
  "arrived_at_venue",
  "service_started",
  "service_ended",
] as const;
export const dayOfCheckpointKeySchema = z.enum(dayOfCheckpointKeys);
export type DayOfCheckpointKey = z.infer<typeof dayOfCheckpointKeySchema>;
export const dayOfCheckpointLabels: Record<DayOfCheckpointKey, string> = {
  food_left_kitchen: "Food left kitchen",
  arrived_at_venue: "Arrived at venue",
  service_started: "Service started",
  service_ended: "Service ended",
};

export const dayOfUpdateKinds = ["staff", "truck", "checkpoint"] as const;
export const dayOfUpdateKindSchema = z.enum(dayOfUpdateKinds);
export type DayOfUpdateKind = z.infer<typeof dayOfUpdateKindSchema>;

// ---- Reading the board ----

export const dayOfQuerySchema = z.object({ date: localDate });

export const dayOfCheckpointSchema = z.object({
  key: dayOfCheckpointKeySchema,
  label: z.string(),
  plannedAt: timestamp.nullable(),
  reachedAt: timestamp.nullable(),
  reachedByName: z.string().nullable(),
});
export type DayOfCheckpoint = z.infer<typeof dayOfCheckpointSchema>;

export const dayOfStaffSchema = z.object({
  slotId: id,
  userId: id,
  name: z.string(),
  position: z.string(),
  shiftKind: shiftKindSchema,
  shiftStartsAt: timestamp,
  shiftEndsAt: timestamp,
  status: dayOfStaffStatusSchema,
  location: z.string(),
  updatedAt: timestamp.nullable(),
});
export type DayOfStaff = z.infer<typeof dayOfStaffSchema>;

export const dayOfTruckSchema = z.object({
  assignmentId: id,
  truckId: id,
  name: z.string(),
  status: truckStatusSchema,
  location: z.string(),
  driverId: id.nullable(),
  driverName: z.string().nullable(),
  departsAt: timestamp,
  returnsAt: timestamp,
  updatedAt: timestamp,
});
export type DayOfTruck = z.infer<typeof dayOfTruckSchema>;

export const dayOfEventSchema = z.object({
  id,
  title: z.string(),
  status: eventStatusSchema,
  startsAt: timestamp,
  endsAt: timestamp.nullable(),
  venueName: z.string().nullable(),
  staff: z.array(dayOfStaffSchema),
  trucks: z.array(dayOfTruckSchema),
  checkpoints: z.array(dayOfCheckpointSchema),
});
export type DayOfEvent = z.infer<typeof dayOfEventSchema>;

export const dayOfBoardSchema = z.object({
  date: localDate,
  events: z.array(dayOfEventSchema),
  // Managers who may edit events update the board; everyone else only watches.
  canUpdate: z.boolean(),
});
export type DayOfBoard = z.infer<typeof dayOfBoardSchema>;

// ---- Updating the board ----

const location = text(200);
// `urgent` tells the affected staff by SMS (stub outbox) as well as in the app.
const urgent = z.boolean().default(false);

export const dayOfStaffUpdateSchema = z
  .object({
    status: dayOfStaffStatusSchema.optional(),
    location: location.optional(),
    urgent,
  })
  .refine((value) => value.status !== undefined || value.location !== undefined, {
    message: "Change the status or the location.",
  });
export type DayOfStaffUpdate = z.input<typeof dayOfStaffUpdateSchema>;

export const dayOfTruckUpdateSchema = z
  .object({
    status: truckStatusSchema.optional(),
    location: location.optional(),
    urgent,
  })
  .refine((value) => value.status !== undefined || value.location !== undefined, {
    message: "Change the status or the location.",
  });
export type DayOfTruckUpdate = z.input<typeof dayOfTruckUpdateSchema>;

// Marks a checkpoint reached now, or clears a mark made by mistake.
export const dayOfCheckpointInputSchema = z.object({
  reached: z.boolean(),
  urgent,
});
export type DayOfCheckpointInput = z.input<typeof dayOfCheckpointInputSchema>;

// ---- The update log ----

export const dayOfUpdateSchema = z.object({
  id,
  eventId: id,
  kind: dayOfUpdateKindSchema,
  truckId: id.nullable(),
  truckName: z.string().nullable(),
  // Who or what changed: the staff member, the truck or the checkpoint.
  subjectName: z.string(),
  summary: z.string(),
  urgent: z.boolean(),
  actorId: id.nullable(),
  actorName: z.string().nullable(),
  at: timestamp,
});
export type DayOfUpdate = z.infer<typeof dayOfUpdateSchema>;

export const dayOfLogSchema = z.object({
  eventId: id,
  entries: z.array(dayOfUpdateSchema),
  // True when the event has more entries than one response carries.
  truncated: z.boolean(),
});
export type DayOfLog = z.infer<typeof dayOfLogSchema>;

// The most entries one log response carries; a real event day writes a few dozen.
export const DAY_OF_LOG_LIMIT = 1000;

// ---- Wording shared by the API and the screens ----

// "16:05" → "4:05pm", the form the truck conflicts and the log use.
export function clockLabel(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

const shown = (value: string) => (value === "" ? "none" : `"${value}"`);

// What one field change reads like in the log: `status: Scheduled → On site`.
export function describeFieldChange(
  field: "status" | "location",
  before: string,
  after: string,
  labels?: Record<string, string>,
) {
  if (field === "status")
    return `status: ${labels?.[before] ?? before} → ${labels?.[after] ?? after}`;
  return `location: ${shown(before)} → ${shown(after)}`;
}

// The log row for a board update, e.g.
// `Alex Rivera (Server): status: Scheduled → On site; location: none → "Dock B"`.
export function describeUpdate(subject: string, parts: string[]) {
  return `${subject}: ${parts.join("; ")}`;
}

// The CSV of an event's log (FLOW-156), oldest first.
export const dayOfLogCsvHeaders = [
  "Date",
  "Time",
  "Type",
  "Truck",
  "Subject",
  "Update",
  "Urgent",
  "By",
];
