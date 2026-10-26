// Times are stored in UTC and shown in America/New_York (design principle 8).
export const BUSINESS_TIME_ZONE = "America/New_York";

const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function wallClock(instant: Date) {
  const value = Object.fromEntries(
    parts.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    utcMs: Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
      Number(value.second),
    ),
  };
}

// The calendar date `days` after a "YYYY-MM-DD" date. Calendar arithmetic, so a
// New York day that is 23 or 25 hours long still moves exactly one date (FLOW-200).
export function addLocalDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60_000;

// Every UTC instant that shows as this New York wall-clock date ("2026-10-30") and
// time ("18:30"), earliest first: none for a time skipped when clocks spring
// forward (or an impossible date), two for a time repeated when they fall back.
function businessInstants(date: string, time: string): number[] {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (ms: number) => wallClock(new Date(ms)).utcMs - ms;
  // A wall-clock time can only take the offset in force a day before or after it.
  const candidates = [...new Set([offset(asUtc - DAY_MS), offset(asUtc + DAY_MS)])]
    .map((value) => asUtc - value)
    .filter((instant) => {
      const shown = wallClock(new Date(instant));
      return shown.date === date && shown.time === time;
    });
  return candidates.sort((a, b) => a - b);
}

// Whether a New York wall-clock date and time happens at all (March 8, 2026 02:30
// doesn't: clocks jump from 02:00 to 03:00).
export const isBusinessTime = (date: string, time: string) =>
  businessInstants(date, time).length > 0;

// The UTC instant for a New York wall-clock date ("2026-10-30") and time ("18:30").
// A time that happens twice when clocks fall back takes its first (daylight time)
// occurrence. Throws for a time that doesn't happen; check isBusinessTime first
// when the time comes from a person.
export function businessTimeToUtc(date: string, time: string): Date {
  const [first] = businessInstants(date, time);
  if (first === undefined)
    throw new RangeError(`${date} ${time} doesn't exist in ${BUSINESS_TIME_ZONE}.`);
  return new Date(first);
}

// The New York wall-clock date and time of a UTC instant.
export function utcToBusinessTime(instant: Date) {
  const { date, time } = wallClock(instant);
  return { date, time };
}
