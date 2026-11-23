import type { ReactNode } from "react";
import { BUSINESS_TIME_ZONE, utcToBusinessTime } from "../../../shared/time";

// A table cell holding a date and a time (FLOW-296): the date as the main text,
// the time beneath it, smaller and muted. A value with only one part shows
// that part as plain text.
export function DateTimeCell({ date, time }: { date?: ReactNode; time?: ReactNode }) {
  const hasDate = date !== undefined && date !== null && date !== "";
  const hasTime = time !== undefined && time !== null && time !== "";
  if (!hasDate && !hasTime) return <>—</>;
  if (!hasDate || !hasTime) return <>{hasDate ? date : time}</>;
  return (
    <span className="date-time-cell">
      <span className="date-time-cell__date">{date}</span>
      <small className="date-time-cell__time">{time}</small>
    </span>
  );
}

// An instant (ISO string) as the business day and time, as dateTimeLabel
// writes them ("2026-09-03" and "18:00").
export function instantParts(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return utcToBusinessTime(at);
}

// An instant as a medium date and a short time in business time
// ("Sep 3, 2026" and "6:00 PM"), as registry datetime fields show it.
export function instantLabels(iso: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return {
    date: at.toLocaleDateString("en-US", { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric" }),
    time: at.toLocaleTimeString("en-US", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit" }),
  };
}

// The sort key of a wall-clock date and time ("2026-09-03T18:00"), so a column
// that shows both sorts by both. A missing time sorts first on its day.
export const dateTimeSortKey = (date: string | null | undefined, time?: string | null) =>
  date ? `${date}T${time ?? ""}` : "";
