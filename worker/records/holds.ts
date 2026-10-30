import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  allocateHolds,
  DEFAULT_BUFFER_DAYS,
  holdStatusForEvent,
  holdWindow,
  issueSignature,
  type Hold,
  type HoldAllocation,
  type HoldStatus,
} from "../../shared/reservations";
import { VENDOR_SECTION } from "../../shared/sub-rentals";
import { utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import {
  events,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryStock,
  reservationConflicts,
  reservations,
  users,
} from "../db/schema";
import { emitDomainEvent } from "../jobs/queue";

// Holds and conflict detection (FLOW-76, FLOW-77). This module only needs the
// tables, so the event code can call it (worker/records/events.ts) without a
// cycle; the API functions live in worker/records/reservations.ts.

type Buffers = { before: number; after: number };

// The New York calendar days an event occupies: its start date through the date it
// ends on, so multi-day events and ones that run past midnight use their full span.
export function eventDays(row: { startsAt: Date; endsAt: Date | null }) {
  const startDate = utcToBusinessTime(row.startsAt).date;
  return {
    startDate,
    endDate: row.endsAt ? utcToBusinessTime(row.endsAt).date : startDate,
  };
}

// Each rental's buffer days (FLOW-72); one day either side when it has none.
export async function bufferDays(db: DbLike, itemIds: string[]) {
  const found = new Map<string, Buffers>();
  if (!itemIds.length) return (itemId: string): Buffers => found.get(itemId) ?? defaultBuffers;
  const rows = await db
    .select({
      itemId: inventoryRentalDetails.itemId,
      before: inventoryRentalDetails.bufferDaysBefore,
      after: inventoryRentalDetails.bufferDaysAfter,
    })
    .from(inventoryRentalDetails)
    .where(inArray(inventoryRentalDetails.itemId, itemIds));
  for (const row of rows) found.set(row.itemId, { before: row.before, after: row.after });
  return (itemId: string): Buffers => found.get(itemId) ?? defaultBuffers;
}
const defaultBuffers: Buffers = {
  before: DEFAULT_BUFFER_DAYS,
  after: DEFAULT_BUFFER_DAYS,
};

export const windowFor = (
  event: { startsAt: Date; endsAt: Date | null },
  buffers: Buffers,
) => holdWindow(eventDays(event), buffers);

// Stock the business owns: everything outside the Vendor section (FLOW-75).
export async function ownedStock(db: DbLike, itemIds: string[]) {
  const owned = new Map<string, number>();
  if (!itemIds.length) return owned;
  const rows = await db
    .select({
      itemId: inventoryStock.itemId,
      total: sql<string>`coalesce(sum(${inventoryStock.quantity}), 0)`,
    })
    .from(inventoryStock)
    .innerJoin(inventorySections, eq(inventorySections.id, inventoryStock.sectionId))
    .where(
      and(
        inArray(inventoryStock.itemId, itemIds),
        isNull(inventoryStock.archivedAt),
        ne(inventorySections.name, VENDOR_SECTION),
      ),
    )
    .groupBy(inventoryStock.itemId);
  for (const row of rows) owned.set(row.itemId, Number(row.total));
  return owned;
}

// Items rented from a vendor: available on request, so a hold never runs short.
export async function subRentalIds(db: DbLike, itemIds: string[]) {
  if (!itemIds.length) return new Set<string>();
  const rows = await db
    .select({ itemId: inventoryRentalDetails.itemId })
    .from(inventoryRentalDetails)
    .where(
      and(
        inArray(inventoryRentalDetails.itemId, itemIds),
        isNotNull(inventoryRentalDetails.vendorId),
      ),
    );
  return new Set(rows.map((row) => row.itemId));
}

// Every hold that is still in play for the items: not released or removed, on an
// event that isn't archived.
export async function liveHolds(db: DbLike, itemIds: string[]): Promise<Hold[]> {
  if (!itemIds.length) return [];
  const rows = await db
    .select({ hold: reservations, bookedAt: events.bookedAt })
    .from(reservations)
    .innerJoin(events, eq(events.id, reservations.eventId))
    .where(
      and(
        inArray(reservations.itemId, itemIds),
        isNull(reservations.archivedAt),
        ne(reservations.status, "released"),
        isNull(events.archivedAt),
      ),
    );
  return rows.map(({ hold, bookedAt }) => ({
    id: hold.id,
    eventId: hold.eventId,
    itemId: hold.itemId,
    quantity: hold.quantity,
    status: hold.status,
    window: { start: hold.windowStart, end: hold.windowEnd },
    bookedAt: bookedAt?.toISOString() ?? null,
    enteredAt: hold.createdAt.toISOString(),
  }));
}

// What each live hold of the items gets, in booking order (shared/reservations.ts).
export async function computeAllocations(db: DbLike, itemIds: string[]) {
  const result = new Map<string, HoldAllocation>();
  if (!itemIds.length) return result;
  const [holds, owned, onRequest] = await Promise.all([
    liveHolds(db, itemIds),
    ownedStock(db, itemIds),
    subRentalIds(db, itemIds),
  ]);
  for (const itemId of itemIds) {
    const forItem = holds.filter((hold) => hold.itemId === itemId);
    const shares = onRequest.has(itemId)
      ? forItem.map(
          (hold): HoldAllocation => ({
            holdId: hold.id,
            eventId: hold.eventId,
            itemId,
            status: hold.status,
            quantity: hold.quantity,
            allocated: hold.quantity,
            shortfall: 0,
            kind: null,
          }),
        )
      : allocateHolds(owned.get(itemId) ?? 0, forItem);
    for (const share of shares) result.set(share.holdId, share);
  }
  return result;
}

export const emitReservationChanged = (
  tx: DbLike,
  change: { reservationId: string; eventId: string; itemId: string; change: string },
) =>
  // Every change emits a domain event so conflicts are re-evaluated (FLOW-76).
  emitDomainEvent(tx, {
    name: "reservation.changed",
    entityId: change.reservationId,
    data: { eventId: change.eventId, itemId: change.itemId, change: change.change },
  });

// The assigned salesperson, the Sales Managers and the event's Production Lead(s)
// (FLOW-77).
async function conflictRecipients(
  tx: DbLike,
  event: {
    assignedSalespersonId: string | null;
    productionLeadId: string | null;
    assistantLeadIds: string[];
  },
) {
  const managers = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "sales_manager"),
        eq(users.status, "active"),
        isNull(users.archivedAt),
      ),
    );
  return [
    ...new Set(
      [
        event.assignedSalespersonId,
        event.productionLeadId,
        ...event.assistantLeadIds,
        ...managers.map((manager) => manager.id),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
}

// Re-evaluates one rental item (FLOW-77): shares its owned stock between its holds
// in booking order, opens a conflict for each hold that comes up short, updates the
// ones whose situation changed and closes the ones that cleared. A confirmed
// conflict notifies the three roles once; it notifies again only when its
// signature changes. Safe to repeat. Call it inside the transaction that made the
// change; it locks the item so evaluations of one item run one at a time.
export async function evaluateItem(tx: DbLike, itemId: string): Promise<void> {
  const [item] = await tx
    .select({
      id: inventoryItems.id,
      kind: inventoryItems.kind,
      name: inventoryItems.name,
      unit: inventoryItems.unit,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .for("update");
  if (!item || item.kind !== "rental") return;

  const allocations = [...(await computeAllocations(tx, [itemId])).values()];
  const short = new Map(allocations.filter((a) => a.kind).map((a) => [a.holdId, a]));
  const existing = await tx
    .select()
    .from(reservationConflicts)
    .where(
      and(
        eq(reservationConflicts.itemId, itemId),
        ne(reservationConflicts.state, "resolved"),
        isNull(reservationConflicts.archivedAt),
      ),
    );
  const open = new Map(existing.map((row) => [row.reservationId, row]));
  const notify: { id: string; signature: string; allocation: HoldAllocation }[] = [];

  for (const [holdId, allocation] of short) {
    const signature = issueSignature(allocation);
    const row = open.get(holdId);
    if (!row) {
      const [created] = await tx
        .insert(reservationConflicts)
        .values({
          reservationId: holdId,
          itemId,
          eventId: allocation.eventId,
          kind: allocation.kind!,
          quantity: allocation.quantity,
          allocated: allocation.allocated,
          shortfall: allocation.shortfall,
          signature,
        })
        .returning({ id: reservationConflicts.id });
      if (allocation.kind === "conflict")
        notify.push({ id: created.id, signature, allocation });
      continue;
    }
    // Same situation: an open conflict stays open and an accepted risk stays accepted.
    if (row.signature === signature) continue;
    await tx
      .update(reservationConflicts)
      .set({
        kind: allocation.kind!,
        state: "open",
        quantity: allocation.quantity,
        allocated: allocation.allocated,
        shortfall: allocation.shortfall,
        signature,
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
      })
      .where(eq(reservationConflicts.id, row.id));
    if (allocation.kind === "conflict" && row.notifiedSignature !== signature)
      notify.push({ id: row.id, signature, allocation });
  }

  // No longer short: stock arrived, a hold shrank or was released.
  const now = new Date();
  for (const row of existing)
    if (!short.has(row.reservationId))
      await tx
        .update(reservationConflicts)
        .set({
          state: "resolved",
          resolution: { method: "cleared", itemId: null, itemName: null, quantity: null, note: "" },
          resolvedBy: null,
          resolvedAt: now,
        })
        .where(eq(reservationConflicts.id, row.id));

  for (const entry of notify) {
    const [event] = await tx
      .select({
        title: events.title,
        assignedSalespersonId: events.assignedSalespersonId,
        productionLeadId: events.productionLeadId,
        assistantLeadIds: events.assistantLeadIds,
      })
      .from(events)
      .where(eq(events.id, entry.allocation.eventId));
    if (!event) continue;
    await tx
      .update(reservationConflicts)
      .set({ notifiedSignature: entry.signature })
      .where(eq(reservationConflicts.id, entry.id));
    await emitDomainEvent(tx, {
      name: "inventory.conflict_detected",
      entityId: entry.id,
      // The generic notification payload (shared/notifications.ts).
      data: {
        recipientIds: await conflictRecipients(tx, event),
        title: `Inventory conflict: ${item.name}`,
        body: `${event.title} needs ${entry.allocation.quantity} ${item.unit} of ${item.name} and only ${entry.allocation.allocated} is available (${entry.allocation.shortfall} short).`,
        link: `/events/${entry.allocation.eventId}`,
        itemId,
        eventId: entry.allocation.eventId,
      },
      idempotencyKey: `inventory.conflict_detected:${entry.id}:${entry.signature}`,
    });
  }
}

// Evaluates several items in a fixed order, so concurrent callers can't deadlock.
export async function evaluateItems(tx: DbLike, itemIds: Iterable<string>) {
  for (const itemId of [...new Set(itemIds)].sort()) await evaluateItem(tx, itemId);
}

// Brings an event's holds in line with the event (FLOW-76): status follows the
// event's status (tentative → confirmed at Closed, released at Lost) and the window
// follows its dates. Items whose holds changed are re-evaluated (FLOW-77: on every
// event date change). Call it inside the transaction that changed the event;
// `reevaluateAll` also re-evaluates unchanged ones, for archive and restore.
export async function syncEventHolds(
  tx: DbLike,
  eventId: string,
  options: { reevaluateAll?: boolean } = {},
): Promise<void> {
  const held = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.eventId, eventId), isNull(reservations.archivedAt)));
  if (!held.length) return;
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) return;
  const status: HoldStatus = holdStatusForEvent(event.status);
  const buffers = await bufferDays(tx, held.map((hold) => hold.itemId));
  const touched = new Set<string>();
  for (const hold of held) {
    const window = windowFor(event, buffers(hold.itemId));
    const changes: string[] = [];
    if (hold.status !== status) changes.push("status");
    if (hold.windowStart !== window.start || hold.windowEnd !== window.end)
      changes.push("window");
    if (!changes.length) continue;
    await tx
      .update(reservations)
      .set({ status, windowStart: window.start, windowEnd: window.end })
      .where(eq(reservations.id, hold.id));
    await emitReservationChanged(tx, {
      reservationId: hold.id,
      eventId,
      itemId: hold.itemId,
      change: changes.join("+"),
    });
    touched.add(hold.itemId);
  }
  await evaluateItems(
    tx,
    options.reevaluateAll ? held.map((hold) => hold.itemId) : touched,
  );
}
