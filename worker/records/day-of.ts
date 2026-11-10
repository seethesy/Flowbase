import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  DAY_OF_LOG_LIMIT,
  clockLabel,
  dayOfCheckpointKeys,
  dayOfCheckpointLabels,
  dayOfStaffStatusLabels,
  dayOfTruckStatusLabels,
  describeFieldChange,
  describeUpdate,
  type DayOfBoard,
  type DayOfCheckpointKey,
  type DayOfLog,
  type DayOfStaffStatus,
  type DayOfUpdate,
  type DayOfUpdateKind,
  type TruckStatus,
} from "../../shared/day-of";
import { can } from "../../shared/policy";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  dayOfCheckpoints,
  dayOfStaffStates,
  dayOfUpdates,
  eventShifts,
  eventStaffSlots,
  events,
  kitchenMenus,
  truckAssignments,
  trucks,
  users,
  venues,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { findVisibleEvent, lockVisibleEvent, visibleEvents } from "./events";

// Day-of board (FLOW-155) and update log (FLOW-156).
//
// The board lists, for one New York date, the events the viewer may open
// (`visibleEvents`: salespeople their own, staff the events they work, FT+ roles
// all) with their staff, trucks and checkpoints. Managers (`events.write`) update
// it; every update appends exactly one `day_of_updates` row in the same
// transaction. Nothing here broadcasts: the Worker pings every committed API write
// and open screens refetch through the shared freshness service (FLOW-206), so
// each reader gets only what their own access allows.

// Guards against an unbounded response; a real event day has a few dozen rows.
const EVENT_LIMIT = 200;
const ROW_LIMIT = 2000;

const person = (name: string | null, email: string | null) => name || email || "";
const assertEdit = (actor: Actor) => {
  if (!can(actor, "events.write")) throw forbidden();
};

// ---- The board ----

export async function getDayOfBoard(
  db: DbLike,
  actor: Actor,
  date: string,
): Promise<DayOfBoard> {
  const start = businessTimeToUtc(date, "00:00");
  const end = businessTimeToUtc(addLocalDays(date, 1), "00:00");
  const visible = and(isNull(events.archivedAt), visibleEvents(actor));
  const canUpdate = can(actor, "events.write");

  // Staff on a shift that starts on this date, with their day-of state if one was set.
  const staffRows = await db
    .select({
      slotId: eventStaffSlots.id,
      eventId: eventShifts.eventId,
      userId: users.id,
      name: users.name,
      email: users.email,
      position: eventStaffSlots.position,
      shiftKind: eventShifts.kind,
      shiftStartsAt: eventShifts.startsAt,
      shiftEndsAt: eventShifts.endsAt,
      status: dayOfStaffStates.status,
      location: dayOfStaffStates.location,
      updatedAt: dayOfStaffStates.updatedAt,
    })
    .from(eventStaffSlots)
    .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .innerJoin(events, eq(events.id, eventShifts.eventId))
    .innerJoin(users, eq(users.id, eventStaffSlots.assigneeId))
    .leftJoin(dayOfStaffStates, eq(dayOfStaffStates.slotId, eventStaffSlots.id))
    .where(
      and(
        visible,
        isNull(eventStaffSlots.archivedAt),
        isNull(eventShifts.archivedAt),
        gte(eventShifts.startsAt, start),
        lt(eventShifts.startsAt, end),
      ),
    )
    .orderBy(asc(eventShifts.startsAt), asc(eventStaffSlots.sortOrder), asc(eventStaffSlots.id))
    .limit(ROW_LIMIT);

  // Trucks whose assignment window touches this date.
  const truckRows = await db
    .select({
      assignment: truckAssignments,
      truck: trucks,
      driverName: users.name,
      driverEmail: users.email,
    })
    .from(truckAssignments)
    .innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
    .innerJoin(events, eq(events.id, truckAssignments.eventId))
    .leftJoin(users, eq(users.id, truckAssignments.driverId))
    .where(
      and(
        visible,
        isNull(truckAssignments.archivedAt),
        isNull(trucks.archivedAt),
        lt(truckAssignments.departsAt, end),
        gt(truckAssignments.returnsAt, start),
      ),
    )
    .orderBy(asc(trucks.name), asc(truckAssignments.departsAt), asc(truckAssignments.id))
    .limit(ROW_LIMIT);

  // Events that take place on the date, plus those that only have a shift or a
  // truck on it (the setup day, the load-out).
  const involved = [
    ...new Set([
      ...staffRows.map((row) => row.eventId),
      ...truckRows.map((row) => row.assignment.eventId),
    ]),
  ];
  const takesPlace = and(
    lt(events.startsAt, end),
    or(gte(events.endsAt, start), and(isNull(events.endsAt), gte(events.startsAt, start))),
  );
  const eventRows = await db
    .select({
      id: events.id,
      title: events.title,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      arrivesAt: events.arrivesAt,
      venueName: venues.name,
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(visible, involved.length ? or(takesPlace, inArray(events.id, involved)) : takesPlace))
    .orderBy(asc(events.startsAt), asc(events.id))
    .limit(EVENT_LIMIT);
  if (!eventRows.length) return { date, events: [], canUpdate };

  const eventIds = eventRows.map((row) => row.id);
  const reachedRows = await db
    .select({
      eventId: dayOfCheckpoints.eventId,
      key: dayOfCheckpoints.key,
      reachedAt: dayOfCheckpoints.reachedAt,
      reachedByName: users.name,
      reachedByEmail: users.email,
    })
    .from(dayOfCheckpoints)
    .leftJoin(users, eq(users.id, dayOfCheckpoints.reachedBy))
    .where(and(inArray(dayOfCheckpoints.eventId, eventIds), isNull(dayOfCheckpoints.archivedAt)));
  const menuRows = await db
    .select({ eventId: kitchenMenus.eventId, leavesKitchenAt: kitchenMenus.leavesKitchenAt })
    .from(kitchenMenus)
    .where(and(inArray(kitchenMenus.eventId, eventIds), isNull(kitchenMenus.archivedAt)));

  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    date,
    canUpdate,
    events: eventRows.map((event) => {
      const happensToday =
        event.startsAt < end &&
        (event.endsAt ? event.endsAt >= start : event.startsAt >= start);
      const planned: Record<DayOfCheckpointKey, Date | null> = {
        food_left_kitchen:
          menuRows.find((menu) => menu.eventId === event.id)?.leavesKitchenAt ?? null,
        arrived_at_venue: event.arrivesAt,
        service_started: event.startsAt,
        service_ended: event.endsAt,
      };
      return {
        id: event.id,
        title: event.title,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        endsAt: iso(event.endsAt),
        venueName: event.venueName,
        staff: staffRows
          .filter((row) => row.eventId === event.id)
          .map((row) => ({
            slotId: row.slotId,
            userId: row.userId,
            name: person(row.name, row.email),
            position: row.position,
            shiftKind: row.shiftKind,
            shiftStartsAt: row.shiftStartsAt.toISOString(),
            shiftEndsAt: row.shiftEndsAt.toISOString(),
            status: row.status ?? "scheduled",
            location: row.location ?? "",
            updatedAt: iso(row.updatedAt),
          })),
        trucks: truckRows
          .filter((row) => row.assignment.eventId === event.id)
          .map((row) => ({
            assignmentId: row.assignment.id,
            truckId: row.truck.id,
            name: row.truck.name,
            status: row.truck.status,
            location: row.truck.location,
            driverId: row.assignment.driverId,
            driverName: row.assignment.driverId
              ? person(row.driverName, row.driverEmail)
              : null,
            departsAt: row.assignment.departsAt.toISOString(),
            returnsAt: row.assignment.returnsAt.toISOString(),
            updatedAt: row.truck.updatedAt.toISOString(),
          })),
        checkpoints: happensToday
          ? dayOfCheckpointKeys.map((key) => {
              const reached = reachedRows.find(
                (row) => row.eventId === event.id && row.key === key,
              );
              return {
                key,
                label: dayOfCheckpointLabels[key],
                plannedAt: iso(planned[key]),
                reachedAt: iso(reached?.reachedAt ?? null),
                reachedByName: reached?.reachedAt
                  ? person(reached.reachedByName, reached.reachedByEmail) || null
                  : null,
              };
            })
          : [],
      };
    }),
  };
}

// ---- Updating the board ----

type Changes = Record<string, { before: unknown; after: unknown }>;

// Appends the update's log row. Called once per board update, in its transaction.
async function appendLog(
  tx: DbLike,
  actor: Actor,
  entry: {
    eventId: string;
    kind: DayOfUpdateKind;
    truckId?: string;
    slotId?: string;
    subjectName: string;
    summary: string;
    changes: Changes;
    urgent: boolean;
  },
) {
  const [row] = await tx
    .insert(dayOfUpdates)
    .values({
      eventId: entry.eventId,
      kind: entry.kind,
      truckId: entry.truckId ?? null,
      slotId: entry.slotId ?? null,
      subjectName: entry.subjectName,
      summary: entry.summary,
      changes: entry.changes,
      urgent: entry.urgent,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: dayOfUpdates.id });
  return readUpdate(tx, row.id);
}

const updateColumns = {
  update: dayOfUpdates,
  actorName: users.name,
  actorEmail: users.email,
  truckName: trucks.name,
};
function toUpdate(row: {
  update: typeof dayOfUpdates.$inferSelect;
  actorName: string | null;
  actorEmail: string | null;
  truckName: string | null;
}): DayOfUpdate {
  return {
    id: row.update.id,
    eventId: row.update.eventId,
    kind: row.update.kind,
    truckId: row.update.truckId,
    truckName: row.truckName,
    subjectName: row.update.subjectName,
    summary: row.update.summary,
    urgent: row.update.urgent,
    actorId: row.update.createdBy,
    actorName: person(row.actorName, row.actorEmail) || null,
    at: row.update.createdAt.toISOString(),
  };
}
async function readUpdate(tx: DbLike, id: string) {
  const [row] = await tx
    .select(updateColumns)
    .from(dayOfUpdates)
    .leftJoin(users, eq(users.id, dayOfUpdates.createdBy))
    .leftJoin(trucks, eq(trucks.id, dayOfUpdates.truckId))
    .where(eq(dayOfUpdates.id, id));
  return toUpdate(row);
}

// Urgent updates tell the affected staff right away: in the app and, through the
// urgent-types, consent and cap rules of the SMS channel (FLOW-52, stub outbox),
// by text. The person who made the update is never told about their own change.
// The notification fan-out reads the recipients and message from the job.
async function notifyAffected(
  tx: DbLike,
  actor: Actor,
  event: { id: string; title: string },
  userIds: (string | null)[],
  summary: string,
) {
  const recipientIds = [
    ...new Set(userIds.filter((id): id is string => !!id && id !== actor.userId)),
  ];
  if (!recipientIds.length) return;
  await emitDomainEvent(tx, {
    name: "event.day_of_changed",
    entityId: event.id,
    data: {
      recipientIds,
      title: `Day-of update: ${event.title}`.slice(0, 200),
      body: summary.slice(0, 1000),
      link: `/day-of?date=${utcToBusinessTime(new Date()).date}`,
    },
  });
}

const noChange = () => new ApiError(409, "NO_CHANGE", "Nothing changed.");

// A staff member's status and location. The staff member is told when it's urgent.
export async function updateDayOfStaff(
  db: Db,
  actor: Actor,
  slotId: string,
  input: { status?: DayOfStaffStatus; location?: string; urgent: boolean },
): Promise<DayOfUpdate> {
  assertEdit(actor);
  return db.transaction(async (tx) => {
    const load = (q: DbLike) =>
      q
        .select({
          eventId: eventShifts.eventId,
          position: eventStaffSlots.position,
          userId: users.id,
          name: users.name,
          email: users.email,
        })
        .from(eventStaffSlots)
        .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
        .innerJoin(users, eq(users.id, eventStaffSlots.assigneeId))
        .where(
          and(
            eq(eventStaffSlots.id, slotId),
            isNull(eventStaffSlots.archivedAt),
            isNull(eventShifts.archivedAt),
          ),
        );
    const [first] = await load(tx);
    if (!first) throw notFound("Staff assignment");
    // Updates to one event run one after another, so the log order is the order
    // people saw. The slot is read again once the lock is held: it may have been
    // reassigned or removed while this update waited.
    const event = await lockVisibleEvent(tx, actor, first.eventId);
    const [row] = await load(tx);
    if (!row || row.eventId !== event.id) throw notFound("Staff assignment");

    const [state] = await tx
      .select()
      .from(dayOfStaffStates)
      .where(eq(dayOfStaffStates.slotId, slotId));
    const before = {
      status: state?.status ?? ("scheduled" as DayOfStaffStatus),
      location: state?.location ?? "",
    };
    const after = {
      status: input.status ?? before.status,
      location: input.location ?? before.location,
    };
    const parts: string[] = [];
    const changes: Changes = {};
    if (after.status !== before.status) {
      parts.push(describeFieldChange("status", before.status, after.status, dayOfStaffStatusLabels));
      changes.status = { before: before.status, after: after.status };
    }
    if (after.location !== before.location) {
      parts.push(describeFieldChange("location", before.location, after.location));
      changes.location = { before: before.location, after: after.location };
    }
    if (!parts.length) throw noChange();

    await tx
      .insert(dayOfStaffStates)
      .values({
        slotId,
        status: after.status,
        location: after.location,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: dayOfStaffStates.slotId,
        set: {
          status: after.status,
          location: after.location,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        },
      });
    const name = person(row.name, row.email);
    const summary = describeUpdate(`${name} (${row.position})`, parts);
    const entry = await appendLog(tx, actor, {
      eventId: event.id,
      kind: "staff",
      slotId,
      subjectName: name,
      summary,
      changes,
      urgent: input.urgent,
    });
    if (input.urgent) await notifyAffected(tx, actor, event, [row.userId], summary);
    return entry;
  });
}

// A truck's status and location, set by hand (no GPS). The truck is one vehicle
// across events, so its status and location follow it; the log row belongs to the
// event whose card was updated. The driver and loaders are told when it's urgent.
export async function updateDayOfTruck(
  db: Db,
  actor: Actor,
  assignmentId: string,
  input: { status?: TruckStatus; location?: string; urgent: boolean },
): Promise<DayOfUpdate> {
  assertEdit(actor);
  return db.transaction(async (tx) => {
    const load = (q: DbLike) =>
      q
        .select({ assignment: truckAssignments })
        .from(truckAssignments)
        .innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
        .where(
          and(
            eq(truckAssignments.id, assignmentId),
            isNull(truckAssignments.archivedAt),
            isNull(trucks.archivedAt),
          ),
        );
    const [first] = await load(tx);
    if (!first) throw notFound("Truck assignment");
    const event = await lockVisibleEvent(tx, actor, first.assignment.eventId);
    const [row] = await load(tx);
    if (!row || row.assignment.eventId !== event.id) throw notFound("Truck assignment");

    const [truck] = await tx
      .select()
      .from(trucks)
      .where(eq(trucks.id, row.assignment.truckId))
      .for("update");
    const before = { status: truck.status, location: truck.location };
    const after = {
      status: input.status ?? before.status,
      location: input.location ?? before.location,
    };
    const parts: string[] = [];
    const changes: Changes = {};
    if (after.status !== before.status) {
      parts.push(describeFieldChange("status", before.status, after.status, dayOfTruckStatusLabels));
      changes.status = { before: before.status, after: after.status };
    }
    if (after.location !== before.location) {
      parts.push(describeFieldChange("location", before.location, after.location));
      changes.location = { before: before.location, after: after.location };
    }
    if (!parts.length) throw noChange();

    await tx
      .update(trucks)
      .set({ status: after.status, location: after.location, updatedBy: actor.userId })
      .where(eq(trucks.id, truck.id));
    await writeAudit(tx, actor, {
      entityType: "truck",
      entityId: truck.id,
      action: "update",
      before,
      after,
    });
    const summary = describeUpdate(truck.name, parts);
    const entry = await appendLog(tx, actor, {
      eventId: event.id,
      kind: "truck",
      truckId: truck.id,
      subjectName: truck.name,
      summary,
      changes,
      urgent: input.urgent,
    });
    if (input.urgent)
      await notifyAffected(
        tx,
        actor,
        event,
        [row.assignment.driverId, ...row.assignment.loaderIds],
        summary,
      );
    return entry;
  });
}

// Marks a checkpoint reached now (FLOW-155 AC2: "food left kitchen" records the
// time against the timeline), or clears a mark made by mistake. The event day's
// staff are told when it's urgent.
export async function setDayOfCheckpoint(
  db: Db,
  actor: Actor,
  eventId: string,
  key: DayOfCheckpointKey,
  input: { reached: boolean; urgent: boolean },
): Promise<DayOfUpdate> {
  assertEdit(actor);
  return db.transaction(async (tx) => {
    const event = await lockVisibleEvent(tx, actor, eventId);
    const label = dayOfCheckpointLabels[key];
    const [current] = await tx
      .select()
      .from(dayOfCheckpoints)
      .where(and(eq(dayOfCheckpoints.eventId, eventId), eq(dayOfCheckpoints.key, key)));
    const was = current?.reachedAt ?? null;
    if (input.reached && was)
      throw new ApiError(409, "ALREADY_REACHED", `${label} is already marked.`);
    if (!input.reached && !was)
      throw new ApiError(409, "NOT_REACHED", `${label} isn't marked.`);

    const now = new Date();
    const reachedAt = input.reached ? now : null;
    const reachedBy = input.reached ? actor.userId : null;
    await tx
      .insert(dayOfCheckpoints)
      .values({
        eventId,
        key,
        reachedAt,
        reachedBy,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: [dayOfCheckpoints.eventId, dayOfCheckpoints.key],
        set: { reachedAt, reachedBy, updatedBy: actor.userId, updatedAt: now },
      });
    const at = (instant: Date) => clockLabel(utcToBusinessTime(instant).time);
    const summary = reachedAt
      ? `${label} at ${at(reachedAt)}`
      : `${label} cleared (was ${at(was as Date)})`;
    const entry = await appendLog(tx, actor, {
      eventId,
      kind: "checkpoint",
      subjectName: label,
      summary,
      changes: {
        reachedAt: { before: was?.toISOString() ?? null, after: reachedAt?.toISOString() ?? null },
      },
      urgent: input.urgent,
    });
    if (input.urgent) {
      const crew = await tx
        .select({ userId: eventStaffSlots.assigneeId })
        .from(eventStaffSlots)
        .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
        .where(
          and(
            eq(eventShifts.eventId, eventId),
            eq(eventShifts.kind, "event_day"),
            isNull(eventShifts.archivedAt),
            isNull(eventStaffSlots.archivedAt),
          ),
        );
      await notifyAffected(tx, actor, event, crew.map((row) => row.userId), `${event.title}: ${summary}`);
    }
    return entry;
  });
}

// ---- The update log ----

// An event's day-of log, newest first, for anyone who can open the event.
export async function getDayOfLog(
  db: DbLike,
  actor: Actor,
  eventId: string,
): Promise<DayOfLog> {
  await findVisibleEvent(db, actor, eventId);
  const rows = await db
    .select(updateColumns)
    .from(dayOfUpdates)
    .leftJoin(users, eq(users.id, dayOfUpdates.createdBy))
    .leftJoin(trucks, eq(trucks.id, dayOfUpdates.truckId))
    .where(and(eq(dayOfUpdates.eventId, eventId), isNull(dayOfUpdates.archivedAt)))
    .orderBy(desc(dayOfUpdates.createdAt), desc(dayOfUpdates.id))
    .limit(DAY_OF_LOG_LIMIT + 1);
  return {
    eventId,
    entries: rows.slice(0, DAY_OF_LOG_LIMIT).map(toUpdate),
    truncated: rows.length > DAY_OF_LOG_LIMIT,
  };
}
