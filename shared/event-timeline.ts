import { z } from "zod";
import { localTime } from "./core-records";
import { id, localDate, text, timestamp } from "./schema-primitives";

// The event timeline and production schedule (FLOW-126, Q-03): the event's
// schedule across every day it involves, matching the timeline on today's BEO.
// An entry is a time range on one day with an activity, who does it and where.
// `production` entries are pre-event milestones (build the arch, pull the rentals)
// and `event` entries the day-of schedule; both carry through to the BEO
// (FLOW-143).

export const timelineKinds = ["production", "event"] as const;
export const timelineKindSchema = z.enum(timelineKinds);
export type TimelineKind = z.infer<typeof timelineKindSchema>;
export const timelineKindLabels: Record<TimelineKind, string> = {
  production: "Production",
  event: "Event",
};

// Who does it: a staff member, a role from the staff position list ("Servers"),
// or an outside party from the vendor directory (a DJ, a videographer). The
// outside party is a vendor record, not a Flowbase user (AC2).
export const timelineWhoKinds = ["staff", "role", "vendor"] as const;
export const timelineWhoInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("staff"), userId: id }),
  z.object({
    type: z.literal("role"),
    label: text(100).min(1, "Choose a role."),
  }),
  z.object({ type: z.literal("vendor"), vendorId: id }),
]);
export type TimelineWhoInput = z.infer<typeof timelineWhoInputSchema>;

export const timelineEntryInputSchema = z.object({
  kind: timelineKindSchema,
  // New York wall-clock date and times, like the event's. An end time earlier than
  // the start runs past midnight.
  date: localDate,
  startTime: localTime,
  endTime: localTime,
  activity: text(500).min(1, "Describe the activity."),
  who: timelineWhoInputSchema.nullable().default(null),
  // One of the event's areas (copied from the venue, or added on the event).
  where: text(100).default(""),
  // Set when the entry was added from a mapped proposal line (F-11-04), so the
  // line stops being suggested.
  source: z
    .object({ proposalId: id, sourceKey: text(200).min(1) })
    .nullable()
    .default(null),
});
export type TimelineEntryInput = z.input<typeof timelineEntryInputSchema>;

// Who an entry names, with a display name. Vendors and staff carry their id so the
// edit form can select them again; a role is its label.
export const timelineWhoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("staff"), id, name: z.string() }),
  z.object({ type: z.literal("role"), label: z.string() }),
  z.object({ type: z.literal("vendor"), id, name: z.string() }),
]);
export type TimelineWho = z.infer<typeof timelineWhoSchema>;
export const timelineWhoLabel = (who: TimelineWho | null) =>
  !who ? "" : who.type === "role" ? who.label : who.name;

export const timelineEntrySchema = z.object({
  id,
  kind: timelineKindSchema,
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  startsAt: timestamp,
  endsAt: timestamp,
  activity: z.string(),
  who: timelineWhoSchema.nullable(),
  where: z.string(),
  fromProposal: z.boolean(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

// The staff shift (FLOW-140) on a day: the team, working hours and activities
// the BEO's day-before setup shows. Read-only here; the Staff section edits it.
export const timelineShiftSchema = z.object({
  id,
  kind: z.enum(["pull_load", "setup", "event_day"]),
  startTime: z.string(),
  endTime: z.string(),
  activities: z.string(),
  slots: z.number().int(),
  filled: z.number().int(),
});
export type TimelineShift = z.infer<typeof timelineShiftSchema>;

export const timelineDaySchema = z.object({
  date: z.string(),
  isEventDay: z.boolean(),
  shifts: z.array(timelineShiftSchema),
  entries: z.array(timelineEntrySchema),
});
export type TimelineDay = z.infer<typeof timelineDaySchema>;

// A line of a mapped proposal's timeline (F-11-04) not yet added as an entry.
// startTime/endTime are filled when the line begins with a time ("4:00 pm –
// 5:30 pm Guest arrival").
export const timelineSuggestionSchema = z.object({
  proposalId: id,
  proposalTitle: z.string(),
  sourceKey: z.string(),
  text: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  activity: z.string(),
});
export type TimelineSuggestion = z.infer<typeof timelineSuggestionSchema>;

export const eventTimelineSchema = z.object({
  eventId: id,
  days: z.array(timelineDaySchema),
  suggestions: z.array(timelineSuggestionSchema),
  // The event's area names, for "where".
  areas: z.array(z.string()),
  canEdit: z.boolean(),
});
export type EventTimeline = z.infer<typeof eventTimelineSchema>;

// Groups entries (and the shifts that happen on the same days) by New York date,
// days in date order, entries in start order (AC1). The event's own date is always
// a day, so an event with no entries yet still shows where its schedule will go.
export function groupTimeline<
  E extends { date: string; startsAt: string; id: string },
  S extends { date: string; startsAt: string },
>(
  entries: E[],
  shifts: S[],
  eventDate: string,
): { date: string; isEventDay: boolean; entries: E[]; shifts: S[] }[] {
  const dates = new Set([
    eventDate,
    ...entries.map((entry) => entry.date),
    ...shifts.map((shift) => shift.date),
  ]);
  const byStart = <T extends { startsAt: string }>(a: T, b: T) =>
    a.startsAt.localeCompare(b.startsAt);
  return [...dates].sort().map((date) => ({
    date,
    isEventDay: date === eventDate,
    entries: entries
      .filter((entry) => entry.date === date)
      .sort(
        (a, b) => byStart(a, b) || a.id.localeCompare(b.id),
      ),
    shifts: shifts.filter((shift) => shift.date === date).sort(byStart),
  }));
}

const clock = (hour: string, minute: string | undefined, meridiem: string) => {
  let value = Number(hour) % 12;
  if (meridiem.toLowerCase() === "pm") value += 12;
  return `${String(value).padStart(2, "0")}:${minute ?? "00"}`;
};

// Reads the times a proposal's timeline line starts with, so the entry form opens
// pre-filled. "4:00 pm - 5:30 pm Guest arrival" gives a start and an end;
// "4 pm Guest arrival" only a start. Anything else is all activity. This is a
// convenience: the person confirms the entry before it is saved (no AI, ADR-16).
export function parseTimelineLine(line: string): {
  startTime: string | null;
  endTime: string | null;
  activity: string;
} {
  const trimmed = line.trim();
  const time = String.raw`(\d{1,2})(?::([0-5]\d))?\s*([ap]m)`;
  const range = new RegExp(
    String.raw`^${time}\s*(?:-|–|—|to)\s*${time}\s*[:\-–—]?\s*(.*)$`,
    "i",
  ).exec(trimmed);
  if (range && Number(range[1]) >= 1 && Number(range[1]) <= 12 && Number(range[4]) >= 1 && Number(range[4]) <= 12)
    return {
      startTime: clock(range[1], range[2], range[3]),
      endTime: clock(range[4], range[5], range[6]),
      activity: range[7].trim() || trimmed,
    };
  const single = new RegExp(String.raw`^${time}\s*[:\-–—]?\s*(.*)$`, "i").exec(
    trimmed,
  );
  if (single && Number(single[1]) >= 1 && Number(single[1]) <= 12)
    return {
      startTime: clock(single[1], single[2], single[3]),
      endTime: null,
      activity: single[4].trim() || trimmed,
    };
  return { startTime: null, endTime: null, activity: trimmed };
}
