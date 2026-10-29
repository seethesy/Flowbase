import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { eventStatusDetailLabels } from "../../shared/core-records";
import {
  holdStatusForEvent,
  windowsOverlap,
  availability,
  type Conflict,
  type ConflictState,
  type ItemAvailability,
  type Reservation,
  type ResolveInput,
} from "../../shared/reservations";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  events,
  inventoryItems,
  inventoryRentalDetails,
  reservationConflicts,
  reservations,
} from "../db/schema";
import { ApiError, notFound } from "../hono";
import {
  bufferDays,
  computeAllocations,
  emitReservationChanged,
  evaluateItem,
  evaluateItems,
  liveHolds,
  ownedStock,
  subRentalIds,
  windowFor,
} from "./holds";
import { findVisibleEvent, lockVisibleEvent, visibleEvents } from "./events";

// Reservations (FLOW-76) and conflict resolution (FLOW-77): the API behind the
// event hub's holds and the item's availability. Holds follow their event's status
// and dates (worker/records/holds.ts); people place, resize and remove them here.
type HoldRow = typeof reservations.$inferSelect;

const snapshot = (row: HoldRow) => ({
  eventId: row.eventId,
  itemId: row.itemId,
  quantity: row.quantity,
  status: row.status,
  windowStart: row.windowStart,
  windowEnd: row.windowEnd,
});

// Titles are shown only for events the viewer can open; the quantities that decide
// availability are not secret.
async function visibleEventInfo(db: DbLike, actor: Actor, eventIds: string[]) {
  if (!eventIds.length) return new Map<string, { title: string; date: string; bookedAt: string | null }>();
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      bookedAt: events.bookedAt,
    })
    .from(events)
    .where(and(inArray(events.id, eventIds), visibleEvents(actor)));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        title: row.title,
        date: utcToBusinessTime(row.startsAt).date,
        bookedAt: row.bookedAt?.toISOString() ?? null,
      },
    ]),
  );
}

async function itemNames(db: DbLike, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>();
  const rows = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, itemIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function toReservations(
  db: DbLike,
  actor: Actor,
  rows: HoldRow[],
): Promise<Reservation[]> {
  if (!rows.length) return [];
  const itemIds = [...new Set(rows.map((row) => row.itemId))];
  const [allocations, names, infos] = await Promise.all([
    computeAllocations(db, itemIds),
    itemNames(db, itemIds),
    visibleEventInfo(db, actor, [...new Set(rows.map((row) => row.eventId))]),
  ]);
  return rows.map((row) => {
    const share = allocations.get(row.id);
    const info = infos.get(row.eventId);
    return {
      id: row.id,
      eventId: row.eventId,
      eventTitle: info?.title ?? null,
      eventDate: info?.date ?? null,
      itemId: row.itemId,
      itemName: names.get(row.itemId) ?? "",
      quantity: row.quantity,
      status: row.status,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      bookedAt: info?.bookedAt ?? null,
      allocated: share?.allocated ?? 0,
      shortfall: share?.shortfall ?? 0,
      issue: share?.kind ?? null,
    };
  });
}

// The event's holds, released ones included (they show why an item was let go).
export async function eventReservations(
  db: Db,
  actor: Actor,
  eventId: string,
): Promise<Reservation[]> {
  await findVisibleEvent(db, actor, eventId);
  const rows = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.eventId, eventId), isNull(reservations.archivedAt)))
    .orderBy(asc(reservations.createdAt), asc(reservations.id));
  return toReservations(db, actor, rows);
}

async function lockRentalItem(tx: DbLike, itemId: string) {
  const [item] = await tx
    .select({
      id: inventoryItems.id,
      kind: inventoryItems.kind,
      active: inventoryItems.active,
      archivedAt: inventoryItems.archivedAt,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .for("update");
  if (!item) throw new ApiError(400, "INVALID_REQUEST", "Choose an existing item.");
  if (item.kind !== "rental")
    throw new ApiError(400, "INVALID_REQUEST", "Only rental items can be held for an event.");
  if (item.archivedAt || !item.active)
    throw new ApiError(400, "INVALID_REQUEST", "That item is archived or inactive.");
  return item;
}

// Holds the quantity of a rental for the event, replacing the quantity of its
// existing hold on that item. Tentative until the event reaches Closed (the status
// follows the event). Called by people here and by the proposal's "record as sent"
// step (F-11-06) when it creates its holds.
export async function placeHold(
  db: Db,
  actor: Actor,
  eventId: string,
  input: { itemId: string; quantity: number },
): Promise<Reservation> {
  const id = await db.transaction(async (tx) => {
    const event = await lockVisibleEvent(tx, actor, eventId);
    if (event.archivedAt)
      throw new ApiError(409, "INVALID_STATE", "Restore the event before holding items for it.");
    if (event.status === "lost" || event.status === "finished")
      throw new ApiError(
        409,
        "INVALID_STATE",
        `A ${eventStatusDetailLabels[event.status]} event doesn't hold items.`,
      );
    await lockRentalItem(tx, input.itemId);
    const holdId = await upsertHold(tx, actor, event, input.itemId, input.quantity, "set");
    await evaluateItem(tx, input.itemId);
    return holdId;
  });
  const [row] = await db.select().from(reservations).where(eq(reservations.id, id));
  return (await toReservations(db, actor, [row]))[0];
}

// Creates the event's hold on the item, or sets (or adds to) its quantity.
async function upsertHold(
  tx: DbLike,
  actor: Actor,
  event: typeof events.$inferSelect,
  itemId: string,
  quantity: number,
  mode: "set" | "add",
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.eventId, event.id),
        eq(reservations.itemId, itemId),
        isNull(reservations.archivedAt),
      ),
    );
  const window = windowFor(event, (await bufferDays(tx, [itemId]))(itemId));
  const values = {
    quantity:
      mode === "add" && existing
        ? Math.round((existing.quantity + quantity) * 10_000) / 10_000
        : quantity,
    status: holdStatusForEvent(event.status),
    windowStart: window.start,
    windowEnd: window.end,
    updatedBy: actor.userId,
  };
  let holdId: string;
  if (existing) {
    holdId = existing.id;
    await tx.update(reservations).set(values).where(eq(reservations.id, existing.id));
  } else {
    const [created] = await tx
      .insert(reservations)
      .values({ eventId: event.id, itemId, createdBy: actor.userId, ...values })
      .returning({ id: reservations.id });
    holdId = created.id;
  }
  const [after] = await tx.select().from(reservations).where(eq(reservations.id, holdId));
  await writeAudit(tx, actor, {
    entityType: "reservation",
    entityId: holdId,
    action: existing ? "update" : "create",
    before: existing ? snapshot(existing) : null,
    after: snapshot(after),
  });
  await emitReservationChanged(tx, {
    reservationId: holdId,
    eventId: event.id,
    itemId,
    change: existing ? "quantity" : "created",
  });
  return holdId;
}

async function lockHold(tx: DbLike, actor: Actor, holdId: string) {
  const [found] = await tx.select().from(reservations).where(eq(reservations.id, holdId));
  if (!found || found.archivedAt) throw notFound("Reservation");
  const event = await lockVisibleEvent(tx, actor, found.eventId);
  await lockRentalItem(tx, found.itemId).catch(() => undefined);
  const [hold] = await tx.select().from(reservations).where(eq(reservations.id, holdId));
  if (!hold || hold.archivedAt) throw notFound("Reservation");
  return { hold, event };
}

export async function updateHold(
  db: Db,
  actor: Actor,
  holdId: string,
  quantity: number,
): Promise<Reservation> {
  await db.transaction(async (tx) => {
    const { hold, event } = await lockHold(tx, actor, holdId);
    await upsertHold(tx, actor, event, hold.itemId, quantity, "set");
    await evaluateItem(tx, hold.itemId);
  });
  const [row] = await db.select().from(reservations).where(eq(reservations.id, holdId));
  return (await toReservations(db, actor, [row]))[0];
}

// Takes the item off the event. The row stays, archived, so its history does.
export async function removeHold(db: Db, actor: Actor, holdId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { hold } = await lockHold(tx, actor, holdId);
    await tx
      .update(reservations)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(reservations.id, holdId));
    await writeAudit(tx, actor, {
      entityType: "reservation",
      entityId: holdId,
      action: "archive",
      before: snapshot(hold),
      after: { ...snapshot(hold), archived: true },
    });
    await emitReservationChanged(tx, {
      reservationId: holdId,
      eventId: hold.eventId,
      itemId: hold.itemId,
      change: "removed",
    });
    await evaluateItem(tx, hold.itemId);
  });
}

// What is free of a rental over a span of days (AC1), and the holds in the way.
export async function itemAvailability(
  db: Db,
  actor: Actor,
  itemId: string,
  from: string,
  to: string,
): Promise<ItemAvailability> {
  const [item] = await db
    .select({ id: inventoryItems.id, kind: inventoryItems.kind })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  if (!item) throw notFound("Item");
  if (item.kind !== "rental")
    throw new ApiError(400, "INVALID_REQUEST", "Availability by date is tracked for rental items.");
  const window = { start: from, end: to };
  const [holds, owned, onRequest] = await Promise.all([
    liveHolds(db, [itemId]),
    ownedStock(db, [itemId]),
    subRentalIds(db, [itemId]),
  ]);
  const inWindow = holds.filter((hold) => windowsOverlap(window, hold.window));
  const figures = onRequest.has(itemId)
    ? null
    : availability(owned.get(itemId) ?? 0, window, holds);
  const rows = inWindow.length
    ? await db
        .select()
        .from(reservations)
        .where(inArray(reservations.id, inWindow.map((hold) => hold.id)))
        .orderBy(asc(reservations.windowStart), asc(reservations.id))
    : [];
  return {
    itemId,
    from,
    to,
    onRequest: onRequest.has(itemId),
    owned: owned.get(itemId) ?? 0,
    available: figures?.available ?? null,
    availableWithTentative: figures?.availableWithTentative ?? null,
    holds: await toReservations(db, actor, rows),
  };
}

// --- Conflicts ---------------------------------------------------------------

type ConflictRow = typeof reservationConflicts.$inferSelect;

async function toConflicts(
  db: DbLike,
  actor: Actor,
  rows: ConflictRow[],
): Promise<Conflict[]> {
  if (!rows.length) return [];
  const [names, infos] = await Promise.all([
    itemNames(db, [...new Set(rows.map((row) => row.itemId))]),
    visibleEventInfo(db, actor, [...new Set(rows.map((row) => row.eventId))]),
  ]);
  return rows.map((row) => {
    const info = infos.get(row.eventId);
    return {
      id: row.id,
      reservationId: row.reservationId,
      itemId: row.itemId,
      itemName: names.get(row.itemId) ?? "",
      eventId: row.eventId,
      eventTitle: info?.title ?? null,
      eventDate: info?.date ?? null,
      kind: row.kind,
      state: row.state,
      quantity: row.quantity,
      allocated: row.allocated,
      shortfall: row.shortfall,
      openedAt: row.createdAt.toISOString(),
      resolution: row.resolution,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  });
}

const stateFilter = (state: ConflictState | undefined) =>
  state ? eq(reservationConflicts.state, state) : ne(reservationConflicts.state, "resolved");

// Open (and accepted) conflicts on the event hub, newest first.
export async function eventConflicts(
  db: Db,
  actor: Actor,
  eventId: string,
  state?: ConflictState,
): Promise<Conflict[]> {
  await findVisibleEvent(db, actor, eventId);
  const rows = await db
    .select()
    .from(reservationConflicts)
    .where(
      and(
        eq(reservationConflicts.eventId, eventId),
        isNull(reservationConflicts.archivedAt),
        stateFilter(state),
      ),
    )
    .orderBy(desc(reservationConflicts.createdAt), desc(reservationConflicts.id))
    .limit(200);
  return toConflicts(db, actor, rows);
}

// Open (and accepted) conflicts on the item page, for the events the viewer can open.
export async function itemConflicts(
  db: Db,
  actor: Actor,
  itemId: string,
  state?: ConflictState,
): Promise<Conflict[]> {
  const rows = await db
    .select({ conflict: reservationConflicts })
    .from(reservationConflicts)
    .innerJoin(events, eq(events.id, reservationConflicts.eventId))
    .where(
      and(
        eq(reservationConflicts.itemId, itemId),
        isNull(reservationConflicts.archivedAt),
        stateFilter(state),
        visibleEvents(actor),
      ),
    )
    .orderBy(desc(reservationConflicts.createdAt), desc(reservationConflicts.id))
    .limit(200);
  return toConflicts(
    db,
    actor,
    rows.map((row) => row.conflict),
  );
}

async function getConflict(db: DbLike, actor: Actor, id: string): Promise<Conflict> {
  const [row] = await db
    .select()
    .from(reservationConflicts)
    .where(eq(reservationConflicts.id, id));
  if (!row) throw notFound("Conflict");
  await findVisibleEvent(db, actor, row.eventId);
  return (await toConflicts(db, actor, [row]))[0];
}

// The four ways out (FLOW-77): move the short quantity to a substitute item or to a
// vendor, lower the quantity, or accept the risk with a note. Who resolved it and
// how stay on the conflict (AC2).
export async function resolveConflict(
  db: Db,
  actor: Actor,
  conflictId: string,
  input: ResolveInput,
): Promise<Conflict> {
  await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(reservationConflicts)
      .where(eq(reservationConflicts.id, conflictId));
    if (!found) throw notFound("Conflict");
    const event = await lockVisibleEvent(tx, actor, found.eventId);
    const targetId = "itemId" in input ? input.itemId : null;
    if (targetId === found.itemId)
      throw new ApiError(400, "INVALID_REQUEST", "Pick a different item.");
    // Items are locked in id order, so two resolutions can't deadlock.
    for (const itemId of [found.itemId, ...(targetId ? [targetId] : [])].sort())
      await tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.id, itemId))
        .for("update");
    const [conflict] = await tx
      .select()
      .from(reservationConflicts)
      .where(eq(reservationConflicts.id, conflictId))
      .for("update");
    if (conflict.state === "resolved")
      throw new ApiError(409, "ALREADY_RESOLVED", "This conflict is already resolved.");
    const [hold] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, conflict.reservationId));
    if (!hold || hold.archivedAt) throw notFound("Reservation");
    const now = new Date();
    const resolved = (
      state: "resolved" | "accepted",
      resolution: NonNullable<ConflictRow["resolution"]>,
    ) =>
      tx
        .update(reservationConflicts)
        .set({ state, resolution, resolvedBy: actor.userId, resolvedAt: now })
        .where(eq(reservationConflicts.id, conflictId));
    const touched = new Set([conflict.itemId]);

    if (input.method === "accept_risk") {
      await resolved("accepted", {
        method: "accept_risk",
        itemId: null,
        itemName: null,
        quantity: null,
        note: input.note,
      });
    } else if (input.method === "adjust") {
      if (input.quantity >= hold.quantity)
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          `Enter a quantity below the ${hold.quantity} held.`,
        );
      await upsertHold(tx, actor, event, hold.itemId, input.quantity, "set");
      await resolved("resolved", {
        method: "adjust",
        itemId: null,
        itemName: null,
        quantity: input.quantity,
        note: input.note ?? "",
      });
    } else {
      // substitute or sub_rent: the short quantity moves to another rental.
      const target = await lockRentalItem(tx, input.itemId);
      const [details] = await tx
        .select({ vendorId: inventoryRentalDetails.vendorId })
        .from(inventoryRentalDetails)
        .where(eq(inventoryRentalDetails.itemId, target.id));
      if (input.method === "sub_rent" && !details?.vendorId)
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Pick an item that is rented from a vendor.",
        );
      const moved = conflict.shortfall;
      const remaining = Math.round((hold.quantity - moved) * 10_000) / 10_000;
      if (remaining > 0)
        await upsertHold(tx, actor, event, hold.itemId, remaining, "set");
      else {
        await tx
          .update(reservations)
          .set({ archivedAt: now, updatedBy: actor.userId })
          .where(eq(reservations.id, hold.id));
        await writeAudit(tx, actor, {
          entityType: "reservation",
          entityId: hold.id,
          action: "archive",
          before: snapshot(hold),
          after: { ...snapshot(hold), archived: true },
        });
        await emitReservationChanged(tx, {
          reservationId: hold.id,
          eventId: hold.eventId,
          itemId: hold.itemId,
          change: "moved",
        });
      }
      await upsertHold(tx, actor, event, target.id, moved, "add");
      const names = await itemNames(tx, [target.id]);
      await resolved("resolved", {
        method: input.method,
        itemId: target.id,
        itemName: names.get(target.id) ?? null,
        quantity: moved,
        note: input.note ?? "",
      });
      touched.add(target.id);
    }
    await writeAudit(tx, actor, {
      entityType: "reservation_conflict",
      entityId: conflictId,
      action: "update",
      before: { state: conflict.state },
      after: { state: input.method === "accept_risk" ? "accepted" : "resolved", method: input.method },
    });
    await evaluateItems(tx, touched);
  });
  return getConflict(db, actor, conflictId);
}
