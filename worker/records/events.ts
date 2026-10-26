import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import {
  eventStatusDetailLabels,
  type EventStatus,
  type EventStatusChange,
  type FlowEvent,
  type eventInputSchema,
} from "../../shared/core-records";
import {
  automaticNextStatuses,
  isAutomaticTransition,
  mayOverrideStatus,
} from "../../shared/event-lifecycle";
import type { EventHub, HubSection } from "../../shared/event-hub";
import {
  addLocalDays,
  businessTimeToUtc,
  isBusinessTime,
  utcToBusinessTime,
} from "../../shared/time";
import { listHistory, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  clientContacts,
  clients,
  eventAreas,
  events,
  eventStatusHistory,
  venues,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can, clientScope, eventScope } from "../policy";
import { setArchived } from "./archive";
import { findVisibleClient, getClient } from "./clients";
import { findVenue, venueAreaNames } from "./venues";

// Events (FLOW-55), the record everything else attaches to. A salesperson sees the
// events assigned to them; other staff see events they lead or assist (F-01-03).
type EventRow = typeof events.$inferSelect;
type EventInput = z.output<typeof eventInputSchema>;

export function visibleEvents(actor: Actor): SQL | undefined {
  const scope = eventScope(actor);
  if (scope === "all") return undefined;
  if (scope === "own") return eq(events.assignedSalespersonId, actor.userId);
  return or(
    eq(events.productionLeadId, actor.userId),
    sql`${events.assistantLeadIds} @> ${JSON.stringify([actor.userId])}::jsonb`,
  );
}

// A New York wall-clock time as a UTC instant; a time that doesn't happen (skipped
// when clocks spring forward) is a validation error, not a silently moved hour.
function businessInstant(date: string, time: string) {
  if (!isBusinessTime(date, time))
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      `${time} doesn't exist on ${date} in New York: clocks skip that hour. Pick another time.`,
    );
  return businessTimeToUtc(date, time);
}

// Stored as UTC instants from New York wall-clock times. An end time earlier than
// the start runs past midnight, so it is that time on the next calendar date.
function instants(input: Pick<EventInput, "date" | "startTime" | "endTime">) {
  const startsAt = businessInstant(input.date, input.startTime);
  if (!input.endTime) return { startsAt, endsAt: null };
  const endDate =
    input.endTime < input.startTime ? addLocalDays(input.date, 1) : input.date;
  return { startsAt, endsAt: businessInstant(endDate, input.endTime) };
}

async function toEvents(db: DbLike, rows: EventRow[]): Promise<FlowEvent[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const clientIds = [...new Set(rows.map((row) => row.clientId))];
  const venueIds = [
    ...new Set(rows.map((row) => row.venueId).filter((id): id is string => !!id)),
  ];
  const [clientNames, venueNames, areas] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(inArray(clients.id, clientIds)),
    venueIds.length
      ? db
          .select({ id: venues.id, name: venues.name })
          .from(venues)
          .where(inArray(venues.id, venueIds))
      : Promise.resolve([]),
    db
      .select()
      .from(eventAreas)
      .where(and(inArray(eventAreas.eventId, ids), isNull(eventAreas.archivedAt)))
      .orderBy(asc(eventAreas.sortOrder)),
  ]);
  return rows.map((row) => {
    const start = utcToBusinessTime(row.startsAt);
    return {
      id: row.id,
      title: row.title,
      date: start.date,
      startTime: start.time,
      endTime: row.endsAt ? utcToBusinessTime(row.endsAt).time : null,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      client: clientNames.find((client) => client.id === row.clientId) ?? {
        id: row.clientId,
        name: "",
      },
      pocContactId: row.pocContactId,
      venue: venueNames.find((venue) => venue.id === row.venueId) ?? null,
      address: row.address,
      areas: areas
        .filter((area) => area.eventId === row.id)
        .map(({ id, name }) => ({ id, name })),
      eventType: row.eventType,
      serviceType: row.serviceType,
      foodServiceStyle: row.foodServiceStyle,
      guestCount: row.guestCount,
      servingsCount: row.servingsCount,
      assignedSalespersonId: row.assignedSalespersonId,
      productionLeadId: row.productionLeadId,
      assistantLeadIds: row.assistantLeadIds,
      dressCode: row.dressCode,
      transportationNotes: row.transportationNotes,
      internalNotes: row.internalNotes,
      status: row.status,
      bookedAt: row.bookedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function listEvents(
  db: Db,
  actor: Actor,
  filter: {
    archived?: boolean;
    clientId?: string;
    venueId?: string;
    // New York dates, inclusive.
    from?: string;
    to?: string;
  },
): Promise<FlowEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        visibleEvents(actor),
        filter.archived ? isNotNull(events.archivedAt) : isNull(events.archivedAt),
        filter.clientId ? eq(events.clientId, filter.clientId) : undefined,
        filter.venueId ? eq(events.venueId, filter.venueId) : undefined,
        filter.from
          ? gte(events.startsAt, businessTimeToUtc(filter.from, "00:00"))
          : undefined,
        filter.to
          ? lt(events.startsAt, businessTimeToUtc(addLocalDays(filter.to, 1), "00:00"))
          : undefined,
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(500);
  return toEvents(db, rows);
}

export async function findVisibleEvent(db: DbLike, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), visibleEvents(actor)));
  if (!row) throw notFound("Event");
  return row;
}

export async function getEvent(db: Db, actor: Actor, id: string) {
  const [event] = await toEvents(db, [await findVisibleEvent(db, actor, id)]);
  return event;
}

// The event as an audit snapshot (FLOW-161). Areas are compared by name because
// saving the form replaces their rows; startsAt/endsAt repeat date and times.
async function eventSnapshot(db: DbLike, id: string) {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  const [event] = await toEvents(db, [row]);
  const snapshot: Record<string, unknown> = {
    ...event,
    areas: event.areas.map((area) => area.name),
  };
  delete snapshot.startsAt;
  delete snapshot.endsAt;
  return snapshot;
}

// Everyone who can open an event sees all of its fields, so nothing is hidden.
export async function eventHistory(db: DbLike, actor: Actor, id: string) {
  await findVisibleEvent(db, actor, id);
  return listHistory(db, "event", id, (changes) => changes);
}

// Hub sections whose module exists (FLOW-57), in display order. Each module ticket
// adds its section here: proposal and versions, booking and payments, BEO, pull list,
// tasks (FLOW-58), timeline, staff, trucks and history (FLOW-41).
const builtSections: HubSection[] = ["details", "client", "files"];

// Everything the event hub shows, limited to what the actor may see. The client
// section needs access to the client record itself: staff who only work the event
// see the client's name in the details, not the client.
export async function getEventHub(
  db: Db,
  actor: Actor,
  id: string,
): Promise<EventHub> {
  const event = await getEvent(db, actor, id);
  const client =
    clientScope(actor) === "none"
      ? null
      : await getClient(db, actor, event.client.id).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        });
  return {
    event,
    client,
    sections: builtSections.filter(
      (section) => section !== "client" || client !== null,
    ),
    canEdit: can(actor, "events.write"),
    canChangeStatus: mayOverrideStatus(actor, event),
  };
}

// Checks the references in an event and works out what it inherits from them.
async function resolveReferences(
  db: DbLike,
  actor: Actor,
  input: EventInput,
  current?: EventRow,
) {
  const client = await findVisibleClient(db, actor, input.clientId).catch(
    () => {
      throw new ApiError(400, "INVALID_REQUEST", "Choose a client you can see.");
    },
  );
  if (input.pocContactId) {
    const [contact] = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, input.pocContactId),
          eq(clientContacts.clientId, client.id),
          isNull(clientContacts.archivedAt),
        ),
      );
    if (!contact)
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        "The point of contact must be one of the client's contacts.",
      );
  }
  const venue = input.venueId
    ? await findVenue(db, input.venueId).catch(() => {
        throw new ApiError(400, "INVALID_REQUEST", "Choose an existing venue.");
      })
    : undefined;
  const venueChanged = input.venueId !== (current?.venueId ?? null);
  // Areas carry over from a newly picked venue unless the form sends its own.
  const areas =
    input.areas ??
    (venue && venueChanged
      ? (await venueAreaNames(db, venue.id)).map((area) => area.name)
      : undefined);
  const salesperson =
    eventScope(actor) === "all"
      ? input.assignedSalespersonId === undefined
        ? (current?.assignedSalespersonId ?? client.assignedSalespersonId)
        : input.assignedSalespersonId
      : actor.userId;
  return {
    address: input.address || venue?.address || "",
    areas,
    salesperson,
  };
}

const eventValues = (input: EventInput, actor: Actor) => ({
  title: input.title,
  ...instants(input),
  clientId: input.clientId,
  pocContactId: input.pocContactId,
  venueId: input.venueId,
  eventType: input.eventType,
  serviceType: input.serviceType,
  foodServiceStyle: input.foodServiceStyle,
  guestCount: input.guestCount,
  servingsCount: input.servingsCount,
  productionLeadId: input.productionLeadId,
  assistantLeadIds: input.assistantLeadIds,
  dressCode: input.dressCode,
  transportationNotes: input.transportationNotes,
  internalNotes: input.internalNotes,
  // Status is set on create and then only by the status changes below.
  updatedBy: actor.userId,
});

async function replaceAreas(tx: DbLike, eventId: string, names: string[]) {
  await tx
    .update(eventAreas)
    .set({ archivedAt: new Date() })
    .where(and(eq(eventAreas.eventId, eventId), isNull(eventAreas.archivedAt)));
  if (names.length)
    await tx
      .insert(eventAreas)
      .values(names.map((name, sortOrder) => ({ eventId, name, sortOrder })));
}

// Inserts the event, its areas, its first status history row, its audit row and the
// event.created outbox row inside the caller's transaction (lead conversion shares
// it); returns the new id.
export async function insertEvent(
  tx: DbLike,
  actor: Actor,
  input: EventInput,
): Promise<string> {
  const resolved = await resolveReferences(tx, actor, input);
  const [row] = await tx
    .insert(events)
    .values({
      ...eventValues(input, actor),
      status: input.status,
      address: resolved.address,
      assignedSalespersonId: resolved.salesperson,
      createdBy: actor.userId,
    })
    .returning({ id: events.id });
  await replaceAreas(tx, row.id, resolved.areas ?? []);
  await tx.insert(eventStatusHistory).values({
    eventId: row.id,
    fromStatus: null,
    toStatus: input.status,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  await writeAudit(tx, actor, {
    entityType: "event",
    entityId: row.id,
    action: "create",
    before: null,
    after: await eventSnapshot(tx, row.id),
  });
  await emitDomainEvent(tx, { name: "event.created", entityId: row.id });
  return row.id;
}

export async function createEvent(
  db: Db,
  actor: Actor,
  input: EventInput,
): Promise<FlowEvent> {
  const id = await db.transaction((tx) => insertEvent(tx, actor, input));
  return getEvent(db, actor, id);
}

export async function updateEvent(
  db: Db,
  actor: Actor,
  id: string,
  input: EventInput,
): Promise<FlowEvent> {
  // input.status is ignored here: status changes go through overrideEventStatus.
  const current = await findVisibleEvent(db, actor, id);
  const resolved = await resolveReferences(db, actor, input, current);
  await db.transaction(async (tx) => {
    const before = await eventSnapshot(tx, id);
    await tx
      .update(events)
      .set({
        ...eventValues(input, actor),
        address: resolved.address,
        assignedSalespersonId: resolved.salesperson,
      })
      .where(eq(events.id, id));
    if (resolved.areas) await replaceAreas(tx, id, resolved.areas);
    await writeAudit(tx, actor, {
      entityType: "event",
      entityId: id,
      action: "update",
      before,
      after: await eventSnapshot(tx, id),
    });
    await emitDomainEvent(tx, { name: "event.updated", entityId: id });
  });
  return getEvent(db, actor, id);
}

export async function setEventArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<FlowEvent> {
  await findVisibleEvent(db, actor, id);
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(events).set(values).where(eq(events.id, id)),
    audit: { entityType: "event", snapshot: eventSnapshot },
    event: "event",
  });
  return getEvent(db, actor, id);
}

// Status changes (FLOW-56). Every change, automatic or manual, records who, when and
// why in event_status_history, writes the audit row and emits exactly one domain
// event, event.<new status>, all in one transaction.
async function changeStatus(
  tx: DbLike,
  current: EventRow,
  change: {
    to: EventStatus;
    reason: string;
    manual: boolean;
    // null when the system made the change.
    actor: Actor | null;
  },
) {
  const from = current.status;
  const { to, reason, manual, actor } = change;
  const before = await eventSnapshot(tx, current.id);
  await tx
    .update(events)
    .set({
      status: to,
      updatedBy: actor?.userId ?? null,
    })
    .where(eq(events.id, current.id));
  await tx.insert(eventStatusHistory).values({
    eventId: current.id,
    fromStatus: from,
    toStatus: to,
    reason,
    manual,
    createdBy: actor?.userId ?? null,
    updatedBy: actor?.userId ?? null,
  });
  await writeAudit(tx, actor, {
    entityType: "event",
    entityId: current.id,
    action: "update",
    before,
    after: await eventSnapshot(tx, current.id),
  });
  await emitDomainEvent(tx, {
    name: `event.${to}`,
    entityId: current.id,
    data: { from, to, reason, manual },
  });
}

// Locked so two changes to the same event can't both succeed.
async function lockEvent(tx: DbLike, id: string) {
  const [row] = await tx
    .select()
    .from(events)
    .where(eq(events.id, id))
    .for("update");
  if (!row) throw notFound("Event");
  return row;
}

const sameStatus = (status: EventStatus) =>
  new ApiError(
    409,
    "INVALID_TRANSITION",
    `The event is already ${eventStatusDetailLabels[status]}.`,
  );

// A person changing the status (A1: any status, at any time). Admin, or the
// salesperson assigned to the event (A2).
export async function overrideEventStatus(
  db: Db,
  actor: Actor,
  id: string,
  input: { status: EventStatus; reason: string },
): Promise<FlowEvent> {
  await findVisibleEvent(db, actor, id);
  await db.transaction(async (tx) => {
    const current = await lockEvent(tx, id);
    if (!mayOverrideStatus(actor, current)) throw forbidden();
    if (current.status === input.status) throw sameStatus(input.status);
    await changeStatus(tx, current, {
      to: input.status,
      reason: input.reason,
      manual: true,
      actor,
    });
  });
  return getEvent(db, actor, id);
}

// The system moving an event along the forward chain (A1), for the features that
// drive it (proposals, contracts, payments). Call it inside the transaction that
// makes the triggering change. Anything but the next status, or Lost, is refused.
export async function advanceEventStatus(
  tx: DbLike,
  id: string,
  to: EventStatus,
  reason = "",
) {
  const current = await lockEvent(tx, id);
  if (!isAutomaticTransition(current.status, to)) {
    if (current.status === to) throw sameStatus(to);
    const allowed = automaticNextStatuses(current.status);
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `An event can't move automatically from ${eventStatusDetailLabels[current.status]} to ${eventStatusDetailLabels[to]}. ` +
        (allowed.length
          ? `Allowed next statuses: ${allowed.map((status) => eventStatusDetailLabels[status]).join(", ")}.`
          : `${eventStatusDetailLabels[current.status]} is final.`),
      { allowed },
    );
  }
  await changeStatus(tx, current, { to, reason, manual: false, actor: null });
}

// The event's status changes, newest first.
export async function eventStatusChanges(db: DbLike, actor: Actor, id: string) {
  await findVisibleEvent(db, actor, id);
  const rows = await db
    .select()
    .from(eventStatusHistory)
    .where(eq(eventStatusHistory.eventId, id))
    .orderBy(desc(eventStatusHistory.createdAt))
    .limit(500);
  return rows.map(
    (row): EventStatusChange => ({
      id: row.id,
      manual: row.manual,
      from: row.fromStatus,
      to: row.toStatus,
      reason: row.reason,
      actorId: row.createdBy,
      at: row.createdAt.toISOString(),
    }),
  );
}
