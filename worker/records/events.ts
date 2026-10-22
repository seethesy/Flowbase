import {
  and,
  asc,
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
import type { FlowEvent, eventInputSchema } from "../../shared/core-records";
import { businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { Db, DbLike } from "../db/client";
import { clientContacts, clients, eventAreas, events, venues } from "../db/schema";
import { ApiError, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { eventScope } from "../policy";
import { findVisibleClient } from "./clients";
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

const DAY_MS = 24 * 60 * 60_000;

// Stored as UTC instants from New York wall-clock times. An end time earlier than
// the start runs past midnight.
function instants(input: Pick<EventInput, "date" | "startTime" | "endTime">) {
  const startsAt = businessTimeToUtc(input.date, input.startTime);
  if (!input.endTime) return { startsAt, endsAt: null };
  let endsAt = businessTimeToUtc(input.date, input.endTime);
  if (endsAt < startsAt) endsAt = new Date(endsAt.getTime() + DAY_MS);
  return { startsAt, endsAt };
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
          ? lt(
              events.startsAt,
              new Date(businessTimeToUtc(filter.to, "00:00").getTime() + DAY_MS),
            )
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
  status: input.status,
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

export async function createEvent(
  db: Db,
  actor: Actor,
  input: EventInput,
): Promise<FlowEvent> {
  const resolved = await resolveReferences(db, actor, input);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(events)
      .values({
        ...eventValues(input, actor),
        address: resolved.address,
        assignedSalespersonId: resolved.salesperson,
        bookedAt: input.status === "booked" ? new Date() : null,
        createdBy: actor.userId,
      })
      .returning({ id: events.id });
    await replaceAreas(tx, row.id, resolved.areas ?? []);
    await emitDomainEvent(tx, { name: "event.created", entityId: row.id });
    return row.id;
  });
  return getEvent(db, actor, id);
}

export async function updateEvent(
  db: Db,
  actor: Actor,
  id: string,
  input: EventInput,
): Promise<FlowEvent> {
  const current = await findVisibleEvent(db, actor, id);
  const resolved = await resolveReferences(db, actor, input, current);
  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({
        ...eventValues(input, actor),
        address: resolved.address,
        assignedSalespersonId: resolved.salesperson,
        // booked_at records the first time the event was booked.
        bookedAt:
          current.bookedAt ?? (input.status === "booked" ? new Date() : null),
      })
      .where(eq(events.id, id));
    if (resolved.areas) await replaceAreas(tx, id, resolved.areas);
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
  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId })
      .where(eq(events.id, id));
    await emitDomainEvent(tx, {
      name: archived ? "event.archived" : "event.restored",
      entityId: id,
    });
  });
  return getEvent(db, actor, id);
}
