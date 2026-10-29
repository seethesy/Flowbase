import { and, asc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Calendar, CalendarRange } from "../../shared/calendar";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { clients, events, tasks, venues } from "../db/schema";
import { visibleEvents } from "./events";
import { involving } from "./tasks";

// Basic calendar (FLOW-63): the events the viewer may open (salespeople their
// own, staff the events they work, FT+ roles all: visibleEvents) that overlap the
// range, and the viewer's own open tasks due in it. Times are New York wall-clock
// times, so the page draws them the same in any browser time zone.

// Enough for any real month; a guard against an unbounded response.
const MAX_ROWS = 1000;

const wallClock = (instant: Date) => {
  const { date, time } = utcToBusinessTime(instant);
  return `${date}T${time}`;
};

export async function getCalendar(
  db: DbLike,
  actor: Actor,
  range: CalendarRange,
): Promise<Calendar> {
  const start = businessTimeToUtc(range.from, "00:00");
  const end = businessTimeToUtc(addLocalDays(range.to, 1), "00:00");
  const eventRows = await db
    .select({
      id: events.id,
      title: events.title,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      clientName: clients.name,
      venueName: venues.name,
    })
    .from(events)
    .innerJoin(clients, eq(clients.id, events.clientId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        isNull(events.archivedAt),
        visibleEvents(actor),
        // Overlaps the range: starts before its end and ends (or, without an end
        // time, starts) on or after its start.
        lt(events.startsAt, end),
        gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, start),
      ),
    )
    .orderBy(asc(events.startsAt), asc(events.id))
    .limit(MAX_ROWS);
  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      dueAt: tasks.dueAt,
      eventId: tasks.eventId,
    })
    .from(tasks)
    .where(
      and(
        isNull(tasks.archivedAt),
        ne(tasks.status, "done"),
        involving(actor.userId),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, end),
      ),
    )
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(MAX_ROWS);
  return {
    events: eventRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      start: wallClock(row.startsAt),
      end: row.endsAt ? wallClock(row.endsAt) : null,
      clientName: row.clientName,
      venueName: row.venueName,
    })),
    tasks: taskRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      // Rows without a due time are filtered out above.
      due: wallClock(row.dueAt as Date),
      eventId: row.eventId,
    })),
  };
}
