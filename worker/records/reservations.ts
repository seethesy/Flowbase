import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { ProposalMapping } from "../../shared/proposal-mapping";
import { eventStatusDetailLabels } from "../../shared/core-records";
import { heldRentals, kitRequirements } from "../../shared/inventory-requirements";
import {
  holdStatusForEvent,
  windowsOverlap,
  availability,
  type Conflict,
  type ConflictState,
  type HoldAllocation,
  type ItemAvailability,
  type Reservation,
  type ResolveInput,
} from "../../shared/reservations";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { alias } from "drizzle-orm/pg-core";
import {
  eventRequirements,
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
import { replaceRequirements } from "./allocations";
import { loadCatalog, type CatalogItem } from "./catalog";

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
  const kits = await kitShares(db, rows);
  return rows.map((row) => {
    const share = kits.get(row.id) ?? allocations.get(row.id);
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

const round = (value: number) => Math.round(value * 10_000) / 10_000;

// A kit's hold gets what its scarcest part allows (FLOW-212 AC3): the kit itself
// has no stock, so its figures come from its parts' holds, and it carries the worst
// issue among them. Holds that aren't a kit's are left out.
async function kitShares(db: DbLike, rows: HoldRow[]) {
  const result = new Map<string, Pick<HoldAllocation, "allocated" | "shortfall" | "kind">>();
  const ids = rows.filter((row) => !row.kitReservationId).map((row) => row.id);
  if (!ids.length) return result;
  const parts = await db
    .select()
    .from(reservations)
    .where(and(inArray(reservations.kitReservationId, ids), isNull(reservations.archivedAt)));
  if (!parts.length) return result;
  const shares = await computeAllocations(db, [...new Set(parts.map((part) => part.itemId))]);
  for (const row of rows) {
    const mine = parts.filter((part) => part.kitReservationId === row.id);
    if (!mine.length) continue;
    const got = mine.map((part) => ({ part, share: shares.get(part.id) }));
    // A released hold has no share; neither does its kit.
    if (got.some(({ share }) => !share)) {
      result.set(row.id, { allocated: 0, shortfall: 0, kind: null });
      continue;
    }
    let allocated = Math.min(
      row.quantity,
      ...got.map(({ part, share }) => (share!.allocated * row.quantity) / part.quantity),
    );
    // Kits come whole: 6.5 sets' worth of parts is 6 sets.
    allocated = Number.isInteger(row.quantity) ? Math.floor(allocated + 1e-9) : round(allocated);
    const kinds = got.map(({ share }) => share!.kind);
    result.set(row.id, {
      allocated,
      shortfall: round(row.quantity - allocated),
      kind: kinds.includes("conflict") ? "conflict" : kinds.includes("warning") ? "warning" : null,
    });
  }
  return result;
}

// The event's holds, released ones included (they show why an item was let go).
// A kit's part holds are left out: the kit's hold stands for them.
export async function eventReservations(
  db: Db,
  actor: Actor,
  eventId: string,
): Promise<Reservation[]> {
  await findVisibleEvent(db, actor, eventId);
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.eventId, eventId),
        isNull(reservations.archivedAt),
        isNull(reservations.kitReservationId),
      ),
    )
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
        isNull(reservations.kitReservationId),
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
  await syncKitParts(tx, actor, event, after);
  return holdId;
}

// --- Kits (FLOW-212) -----------------------------------------------------------

// Brings a kit hold's part holds in line with the kit: each rental part is held at
// the kit's quantity times what one kit takes (nested kits opened up), parts the
// kit no longer has are let go, and the parts are re-evaluated so a short part
// opens a conflict that names it. Consumable parts are event requirements
// (syncKitRequirements). Does nothing for a rental that isn't a kit.
async function syncKitParts(
  tx: DbLike,
  actor: Actor,
  event: typeof events.$inferSelect,
  hold: HoldRow,
) {
  const catalog = await loadCatalog(tx, [hold.itemId]);
  const kit = catalog.get(hold.itemId);
  const existing = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.kitReservationId, hold.id), isNull(reservations.archivedAt)));
  if (!kit?.rental?.components.length && !existing.length) return;
  const wanted = new Map<string, number>();
  if (kit?.rental?.components.length) {
    for (const need of partsOf(catalog, kit, hold.quantity))
      if (catalog.get(need.itemId)?.kind === "rental" && need.quantity > 0)
        wanted.set(need.itemId, need.quantity);
  }
  const buffers = await bufferDays(tx, [...wanted.keys()]);
  const touched = new Set(existing.map((row) => row.itemId));
  for (const [itemId, quantity] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
    touched.add(itemId);
    const window = windowFor(event, buffers(itemId));
    const values = {
      quantity,
      status: hold.status,
      windowStart: window.start,
      windowEnd: window.end,
      updatedBy: actor.userId,
    };
    const row = existing.find((part) => part.itemId === itemId);
    if (row) {
      if (
        row.quantity === quantity &&
        row.status === hold.status &&
        row.windowStart === window.start &&
        row.windowEnd === window.end
      )
        continue;
      await tx.update(reservations).set(values).where(eq(reservations.id, row.id));
      await emitReservationChanged(tx, {
        reservationId: row.id,
        eventId: event.id,
        itemId,
        change: "quantity",
      });
    } else {
      const [created] = await tx
        .insert(reservations)
        .values({
          eventId: event.id,
          itemId,
          kitReservationId: hold.id,
          createdBy: actor.userId,
          ...values,
        })
        .returning({ id: reservations.id });
      await emitReservationChanged(tx, {
        reservationId: created.id,
        eventId: event.id,
        itemId,
        change: "created",
      });
    }
  }
  for (const row of existing)
    if (!wanted.has(row.itemId))
      await archivePart(tx, actor, row);
  await evaluateItems(tx, touched);
  await syncKitRequirements(tx, actor, event.id);
}

// What one kit hold needs of each part. A part that is retired, or a loop in the
// kit, stops the hold with the reason.
function partsOf(catalog: Map<string, CatalogItem>, kit: CatalogItem, quantity: number) {
  try {
    return kitRequirements(kit.id, quantity, [...catalog.values()], 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const missing = /^Item (.+) is unavailable\.$/.exec(message)?.[1];
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      missing
        ? `${kit.name} includes an archived or inactive item (${catalog.get(missing)?.name ?? "unknown"}).`
        : `${kit.name}: ${message}`,
    );
  }
}

async function archivePart(tx: DbLike, actor: Actor, row: HoldRow) {
  await tx
    .update(reservations)
    .set({ archivedAt: new Date(), updatedBy: actor.userId })
    .where(eq(reservations.id, row.id));
  await emitReservationChanged(tx, {
    reservationId: row.id,
    eventId: row.eventId,
    itemId: row.itemId,
    change: "removed",
  });
}

// The consumable parts of the event's kit holds (candles in a candle set) as
// requirements with source "kit", so allocation and ordering count them (FLOW-85).
// Pulling and closing out the kit's lines records their use once (FLOW-157).
export async function syncKitRequirements(tx: DbLike, actor: Actor | null, eventId: string) {
  const holds = await tx
    .select({ itemId: reservations.itemId, quantity: reservations.quantity })
    .from(reservations)
    .innerJoin(inventoryRentalDetails, eq(inventoryRentalDetails.itemId, reservations.itemId))
    .where(
      and(
        eq(reservations.eventId, eventId),
        isNull(reservations.archivedAt),
        isNull(reservations.kitReservationId),
        sql`jsonb_array_length(${inventoryRentalDetails.components}) > 0`,
      ),
    );
  const catalog = await loadCatalog(tx, holds.map((hold) => hold.itemId));
  const totals = new Map<string, number>();
  for (const hold of holds) {
    const kit = catalog.get(hold.itemId);
    if (!kit) continue;
    let parts: { itemId: string; quantity: number }[];
    try {
      parts = kitRequirements(kit.id, hold.quantity, [...catalog.values()], 0);
    } catch {
      continue;
    }
    for (const part of parts)
      if (catalog.get(part.itemId)?.kind === "consumable")
        totals.set(part.itemId, round((totals.get(part.itemId) ?? 0) + part.quantity));
  }
  const [current] = await tx
    .select({ id: eventRequirements.id })
    .from(eventRequirements)
    .where(
      and(
        eq(eventRequirements.eventId, eventId),
        eq(eventRequirements.source, "kit"),
        isNull(eventRequirements.archivedAt),
      ),
    )
    .limit(1);
  // Nothing to write and nothing to clear: keep the audit log quiet.
  if (!totals.size && !current) return;
  await replaceRequirements(
    tx,
    actor,
    eventId,
    "kit",
    [...totals].map(([itemId, quantity]) => ({ itemId, quantity, basis: "fixed" as const })),
  );
}

// Takes a hold off its event, its kit parts with it. The rows stay, archived.
async function archiveHold(
  tx: DbLike,
  actor: Actor,
  hold: HoldRow,
  change: string,
  set: Partial<typeof reservations.$inferInsert> = {},
) {
  await tx
    .update(reservations)
    .set({ ...set, archivedAt: new Date(), updatedBy: actor.userId })
    .where(eq(reservations.id, hold.id));
  await writeAudit(tx, actor, {
    entityType: "reservation",
    entityId: hold.id,
    action: "archive",
    before: snapshot(hold),
    after: { ...snapshot(hold), ...(set.status && { status: set.status }), archived: true },
  });
  await emitReservationChanged(tx, {
    reservationId: hold.id,
    eventId: hold.eventId,
    itemId: hold.itemId,
    change,
  });
  const parts = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.kitReservationId, hold.id), isNull(reservations.archivedAt)));
  for (const part of parts) await archivePart(tx, actor, part);
  await evaluateItems(tx, [hold.itemId, ...parts.map((part) => part.itemId)]);
  await syncKitRequirements(tx, actor, hold.eventId);
}

// What a mapping puts on hold: its rental lines, decor lines that are catalog
// rentals (a decor kit is one), and the rentals a service includes, with fixed and
// per-guest quantities (FLOW-213). A kit is held as itself; its hold holds the parts.
async function proposalRentals(tx: DbLike, mapping: ProposalMapping | null, guests: number) {
  const quantities = new Map<string, number>();
  const lines = (mapping?.lines ?? []).filter(
    (line) =>
      ["rental", "decor", "service"].includes(line.kind) && line.catalogId && !line.notTracked && line.quantity,
  );
  const catalog = await loadCatalog(tx, lines.map((line) => line.catalogId!));
  const items = [...catalog.values()];
  const add = (itemId: string, quantity: number) =>
    quantities.set(itemId, round((quantities.get(itemId) ?? 0) + quantity));
  for (const line of lines) {
    const item = catalog.get(line.catalogId!);
    // A rental line is held as written; holding refuses an item that can't be held.
    if (line.kind === "rental") {
      add(line.catalogId!, line.quantity!);
      continue;
    }
    if (!item || item.kind !== (line.kind === "service" ? "service" : "rental")) continue;
    if (line.kind === "decor") {
      add(item.id, line.quantity!);
      continue;
    }
    let held: { itemId: string; quantity: number }[];
    try {
      held = heldRentals(item.id, line.quantity!, items, guests);
    } catch {
      // A retired item or a loop: nothing to hold until someone fixes the catalog.
      continue;
    }
    for (const need of held) if (need.quantity > 0) add(need.itemId, need.quantity);
  }
  return quantities;
}

// Apply the rental quantities from the approved, sent version in the same
// transaction as the proposal and event stage changes.
export async function syncProposalRentalHolds(tx: DbLike, actor: Actor, eventId: string, mapping: ProposalMapping, previous: ProposalMapping | null = null) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) throw notFound("Event");
  const guests = event.servingsCount ?? event.guestCount ?? 0;
  const quantities = await proposalRentals(tx, mapping, guests);
  for (const [itemId, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
    await lockRentalItem(tx, itemId);
    await upsertHold(tx, actor, event, itemId, quantity, "set");
    await evaluateItem(tx, itemId);
  }
  const previousItems = await proposalRentals(tx, previous, guests);
  for (const itemId of previousItems.keys()) {
    if (quantities.has(itemId)) continue;
    const [existing] = await tx.select().from(reservations).where(and(eq(reservations.eventId, eventId), eq(reservations.itemId, itemId), isNull(reservations.archivedAt), isNull(reservations.kitReservationId)));
    if (!existing) continue;
    await archiveHold(tx, actor, existing, "removed", { status: "released" });
  }
}

async function lockHold(tx: DbLike, actor: Actor, holdId: string) {
  const [found] = await tx.select().from(reservations).where(eq(reservations.id, holdId));
  if (!found || found.archivedAt) throw notFound("Reservation");
  const event = await lockVisibleEvent(tx, actor, found.eventId);
  await lockRentalItem(tx, found.itemId).catch(() => undefined);
  const [hold] = await tx.select().from(reservations).where(eq(reservations.id, holdId));
  if (!hold || hold.archivedAt) throw notFound("Reservation");
  if (hold.kitReservationId) throw partOfKit();
  return { hold, event };
}

const partOfKit = () =>
  new ApiError(409, "PART_OF_KIT", "This item is held as part of a kit. Change the kit's hold instead.");

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
    await archiveHold(tx, actor, hold, "removed");
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
  const catalog = await loadCatalog(db, [itemId]);
  const kit = catalog.get(itemId);
  if (kit?.rental?.components.length) return kitAvailability(db, actor, catalog, kit, window);
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
    parts: [],
  };
}

// A kit has no stock of its own (FLOW-212 AC3): it is free as many times as its
// scarcest rental part allows over the span, and each part says how many kits it
// would cover. Consumable parts are allocated with the event's requirements.
async function kitAvailability(
  db: DbLike,
  actor: Actor,
  catalog: Map<string, CatalogItem>,
  kit: CatalogItem,
  window: { start: string; end: string },
): Promise<ItemAvailability> {
  const parts = partsOf(catalog, kit, 1).filter(
    (part) => catalog.get(part.itemId)?.kind === "rental" && part.quantity > 0,
  );
  const ids = parts.map((part) => part.itemId);
  const [holds, owned, onRequest] = await Promise.all([
    liveHolds(db, ids),
    ownedStock(db, ids),
    subRentalIds(db, ids),
  ]);
  const kits = (count: number | null, per: number) =>
    count === null ? null : Math.max(0, Math.floor(count / per + 1e-9));
  const rows = parts.map((part) => {
    const figures = onRequest.has(part.itemId)
      ? null
      : availability(
          owned.get(part.itemId) ?? 0,
          window,
          holds.filter((hold) => hold.itemId === part.itemId),
        );
    return {
      itemId: part.itemId,
      itemName: catalog.get(part.itemId)?.name ?? "",
      perKit: part.quantity,
      onRequest: onRequest.has(part.itemId),
      owned: owned.get(part.itemId) ?? 0,
      available: figures?.available ?? null,
      availableWithTentative: figures?.availableWithTentative ?? null,
    };
  });
  const limited = rows.filter((row) => !row.onRequest);
  const least = (values: (number | null)[]) =>
    limited.length ? Math.min(...values.map((value) => value ?? 0)) : null;
  const kitHolds = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.itemId, kit.id),
        isNull(reservations.archivedAt),
        ne(reservations.status, "released"),
        sql`${reservations.windowStart} <= ${window.end} and ${reservations.windowEnd} >= ${window.start}`,
      ),
    )
    .orderBy(asc(reservations.windowStart), asc(reservations.id));
  return {
    itemId: kit.id,
    from: window.start,
    to: window.end,
    onRequest: rows.length > 0 && !limited.length,
    owned: least(limited.map((row) => kits(row.owned, row.perKit))) ?? 0,
    available: least(limited.map((row) => kits(row.available, row.perKit))),
    availableWithTentative: least(
      limited.map((row) => kits(row.availableWithTentative, row.perKit)),
    ),
    holds: await toReservations(db, actor, kitHolds),
    parts: rows,
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
  // A part of a kit names the kit too (FLOW-212 AC3).
  const kitOf = new Map<string, string>();
  const kitHold = alias(reservations, "kit_hold");
  const partRows = await db
    .select({ id: reservations.id, kitItemId: kitHold.itemId })
    .from(reservations)
    .innerJoin(kitHold, eq(kitHold.id, reservations.kitReservationId))
    .where(inArray(reservations.id, [...new Set(rows.map((row) => row.reservationId))]));
  for (const part of partRows) kitOf.set(part.id, part.kitItemId);
  const [names, infos] = await Promise.all([
    itemNames(db, [...new Set([...rows.map((row) => row.itemId), ...kitOf.values()])]),
    visibleEventInfo(db, actor, [...new Set(rows.map((row) => row.eventId))]),
  ]);
  return rows.map((row) => {
    const info = infos.get(row.eventId);
    const kitItemId = kitOf.get(row.reservationId);
    return {
      id: row.id,
      reservationId: row.reservationId,
      itemId: row.itemId,
      itemName: names.get(row.itemId) ?? "",
      kitName: kitItemId ? (names.get(kitItemId) ?? "") : null,
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
        // A kit's page also shows its parts' conflicts (FLOW-212).
        or(
          eq(reservationConflicts.itemId, itemId),
          sql`${reservationConflicts.reservationId} in (select part.id from reservations part join reservations kit on kit.id = part.kit_reservation_id where kit.item_id = ${itemId})`,
        ),
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
    // A kit's part follows the kit: change the kit's hold, or accept the risk.
    if (hold.kitReservationId && input.method !== "accept_risk")
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        "This item is part of a kit. Change the kit's quantity or accept the risk.",
      );
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
      else await archiveHold(tx, actor, hold, "moved");
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
