import { and, asc, eq, gte, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Calendar, CalendarRange } from "../../shared/calendar";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import {
  clients,
  eventShifts,
  eventStaffSlots,
  events,
  reservations,
  tasks,
  users,
  venues,
} from "../db/schema";
import { visibleEvents } from "./events";
import { involving, visibleTasks } from "./tasks";

// Basic calendar (FLOW-63): the events the viewer may open (salespeople their
// own, staff the events they work, FT+ roles all: visibleEvents) that overlap the
// range, and the viewer's own open tasks due in it. Times are New York wall-clock
// times, so the page draws them the same in any browser time zone.
//
// Overview mode (FLOW-64) adds each event's guest count, salesperson and staff
// count. Layers (FLOW-67) add production tasks, tentative holds and staff shifts;
// they come with every response so the page can toggle them without a request.

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
      guestCount: events.guestCount,
      salespersonName: users.name,
      salespersonEmail: users.email,
      staffCount: sql<number>`(select count(distinct ${eventStaffSlots.assigneeId}) from ${eventStaffSlots} join ${eventShifts} on ${eventShifts.id} = ${eventStaffSlots.shiftId} where ${eventShifts.eventId} = ${events.id} and ${eventShifts.archivedAt} is null and ${eventStaffSlots.archivedAt} is null)`.mapWith(Number),
    })
    .from(events)
    .innerJoin(clients, eq(clients.id, events.clientId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .leftJoin(users, eq(users.id, events.assignedSalespersonId))
    .where(
      and(
        isNull(events.archivedAt),
        visibleEvents(actor),
        // Overlaps the range: starts before its end and ends (or, without an end
        // time, starts) on or after its start. Compared column by column, so each
        // Date is sent the way its column's type encodes it.
        lt(events.startsAt, end),
        or(
          gte(events.endsAt, start),
          and(isNull(events.endsAt), gte(events.startsAt, start)),
        ),
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
  const layers = await getLayers(db, actor, range, start, end);
  return {
    events: eventRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      start: wallClock(row.startsAt),
      end: row.endsAt ? wallClock(row.endsAt) : null,
      clientName: row.clientName,
      venueName: row.venueName,
      guestCount: row.guestCount,
      // A user without a name shows as their email, as on the roster.
      salespersonName: row.salespersonName || row.salespersonEmail || null,
      staffCount: row.staffCount,
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
    layers,
  };
}

async function getLayers(
  db: DbLike,
  actor: Actor,
  range: CalendarRange,
  start: Date,
  end: Date,
): Promise<Calendar["layers"]> {
  const productionRows = await db
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
        eq(tasks.type, "production"),
        ne(tasks.status, "done"),
        visibleTasks(actor),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, end),
      ),
    )
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(MAX_ROWS);
  // One entry per event and window: an event's items share a window unless their
  // buffer days differ.
  const holdRows = await db
    .select({
      eventId: reservations.eventId,
      eventTitle: events.title,
      start: reservations.windowStart,
      end: reservations.windowEnd,
      items: sql<number>`count(distinct ${reservations.itemId})`.mapWith(Number),
      quantity: sql<number>`sum(${reservations.quantity})`.mapWith(Number),
    })
    .from(reservations)
    .innerJoin(events, eq(events.id, reservations.eventId))
    .where(
      and(
        isNull(reservations.archivedAt),
        eq(reservations.status, "tentative"),
        isNull(events.archivedAt),
        visibleEvents(actor),
        lte(reservations.windowStart, range.to),
        gte(reservations.windowEnd, range.from),
      ),
    )
    .groupBy(
      reservations.eventId,
      events.title,
      reservations.windowStart,
      reservations.windowEnd,
    )
    .orderBy(asc(reservations.windowStart), asc(reservations.eventId))
    .limit(MAX_ROWS);
  const shiftRows = await db
    .select({
      id: eventShifts.id,
      eventId: eventShifts.eventId,
      eventTitle: events.title,
      kind: eventShifts.kind,
      startsAt: eventShifts.startsAt,
      endsAt: eventShifts.endsAt,
      slots: sql<number>`(select count(*) from ${eventStaffSlots} where ${eventStaffSlots.shiftId} = ${eventShifts.id} and ${eventStaffSlots.archivedAt} is null)`.mapWith(Number),
      staffed: sql<number>`(select count(*) from ${eventStaffSlots} where ${eventStaffSlots.shiftId} = ${eventShifts.id} and ${eventStaffSlots.archivedAt} is null and ${eventStaffSlots.assigneeId} is not null)`.mapWith(Number),
    })
    .from(eventShifts)
    .innerJoin(events, eq(events.id, eventShifts.eventId))
    .where(
      and(
        isNull(eventShifts.archivedAt),
        isNull(events.archivedAt),
        visibleEvents(actor),
        lt(eventShifts.startsAt, end),
        gte(eventShifts.endsAt, start),
      ),
    )
    .orderBy(asc(eventShifts.startsAt), asc(eventShifts.id))
    .limit(MAX_ROWS);
  return {
    production: productionRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      due: wallClock(row.dueAt as Date),
      eventId: row.eventId,
    })),
    holds: holdRows,
    shifts: shiftRows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      kind: row.kind,
      start: wallClock(row.startsAt),
      end: wallClock(row.endsAt),
      slots: row.slots,
      staffed: row.staffed,
    })),
  };
}
