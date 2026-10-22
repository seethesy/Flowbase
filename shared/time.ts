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

// The UTC instant for a New York wall-clock date ("2026-10-30") and time ("18:30").
export function businessTimeToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (ms: number) => wallClock(new Date(ms)).utcMs - ms;
  let instant = asUtc - offset(asUtc);
  // Re-check once across a daylight-saving change.
  const corrected = asUtc - offset(instant);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

// The New York wall-clock date and time of a UTC instant.
export function utcToBusinessTime(instant: Date) {
  const { date, time } = wallClock(instant);
  return { date, time };
}
