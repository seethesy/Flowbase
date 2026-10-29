import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  allocateConsumable,
  allocatedEventStatuses,
  requiredQuantity,
  type Demand,
  type ItemAllocationRow,
  type OnOrder,
  type Requirement,
  type RequirementsInput,
} from "../../shared/allocation";
import { bookingOrder } from "../../shared/reservations";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  consumableAllocations,
  eventRequirements,
  events,
  inventoryConsumableDetails,
  inventoryItems,
  inventoryStock,
  jobs,
  vendors,
} from "../db/schema";
import { ApiError, notFound } from "../hono";
import { enqueueJob, type JobRegistry } from "../jobs/queue";
import { findVisibleEvent, lockVisibleEvent, visibleEvents } from "./events";
import { evaluateItem } from "./holds";

// Consumable allocation and projected stock (FLOW-85, ADR-12). What each event
// needs of a consumable is stored as requirements; the allocation job turns the
// requirements of events at Closed or later into allocations in booking order,
// stores each event's shortage and order-by date, and runs in the background so a
// request never carries the work. Everything that changes the answer asks for a
// recompute of the affected item: an event's status, guest count or date, its
// requirements, and stock (the stock.moved event).

export const RECOMPUTE_JOB = "allocation.recompute";

// Orders on their way (FLOW-86/87). No order records exist yet, so none is counted;
// the order module registers its source here when it lands (AC4's date rule is in
// shared/allocation.ts).
export type OnOrderSource = (db: DbLike, itemId: string) => Promise<OnOrder[]>;
let onOrderSource: OnOrderSource = async () => [];
export const registerOnOrderSource = (source: OnOrderSource) => {
  onOrderSource = source;
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

// Queues a recompute of the item unless one is already waiting. Call it inside the
// transaction that made the change, so it commits or rolls back with it.
export async function requestRecompute(tx: DbLike, itemId: string) {
  const [waiting] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, RECOMPUTE_JOB),
        eq(jobs.status, "pending"),
        isNull(jobs.archivedAt),
        sql`${jobs.payload}->>'itemId' = ${itemId}`,
      ),
    )
    .limit(1);
  if (waiting) return;
  await enqueueJob(tx, {
    type: RECOMPUTE_JOB,
    payload: { itemId },
    idempotencyKey: `${RECOMPUTE_JOB}:${itemId}:${crypto.randomUUID()}`,
  });
}

// Every consumable the event has requirements for, or had allocations for.
export async function requestEventRecompute(tx: DbLike, eventId: string) {
  const [lines, results] = await Promise.all([
    tx
      .select({ itemId: eventRequirements.itemId })
      .from(eventRequirements)
      .where(and(eq(eventRequirements.eventId, eventId), isNull(eventRequirements.archivedAt))),
    tx
      .select({ itemId: consumableAllocations.itemId })
      .from(consumableAllocations)
      .where(and(eq(consumableAllocations.eventId, eventId), isNull(consumableAllocations.archivedAt))),
  ]);
  for (const itemId of new Set([...lines, ...results].map((row) => row.itemId)))
    await requestRecompute(tx, itemId);
}

// Recomputes one consumable's allocations: every event at Closed or later that
// requires it, in booking order, against what is on hand and on order. Safe to
// repeat; it locks the item so recomputes of one item run one at a time.
export async function recomputeItem(tx: DbLike, itemId: string, now = new Date()) {
  const [item] = await tx
    .select({ id: inventoryItems.id, kind: inventoryItems.kind })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .for("update");
  if (!item || item.kind !== "consumable") return;

  const [lines, stock, vendor] = await Promise.all([
    tx
      .select({ line: eventRequirements, event: events })
      .from(eventRequirements)
      .innerJoin(events, eq(events.id, eventRequirements.eventId))
      .where(
        and(
          eq(eventRequirements.itemId, itemId),
          isNull(eventRequirements.archivedAt),
          isNull(events.archivedAt),
          inArray(events.status, [...allocatedEventStatuses]),
        ),
      ),
    tx
      .select({ total: sql<string>`coalesce(sum(${inventoryStock.quantity}), 0)` })
      .from(inventoryStock)
      .where(and(eq(inventoryStock.itemId, itemId), isNull(inventoryStock.archivedAt))),
    tx
      .select({ leadTimeDays: vendors.leadTimeDays })
      .from(inventoryConsumableDetails)
      .innerJoin(vendors, eq(vendors.id, inventoryConsumableDetails.preferredVendorId))
      .where(eq(inventoryConsumableDetails.itemId, itemId)),
  ]);
  const leadTimeDays = vendor[0]?.leadTimeDays ?? null;

  const demands = new Map<string, Demand>();
  for (const { line, event } of lines) {
    const needed = requiredQuantity(line, event.guestCount);
    const entered = line.createdAt.toISOString();
    const demand = demands.get(event.id);
    if (demand) {
      demand.required = round(demand.required + needed);
      if (entered < demand.enteredAt) demand.enteredAt = entered;
    } else
      demands.set(event.id, {
        eventId: event.id,
        required: needed,
        bookedAt: event.bookedAt?.toISOString() ?? null,
        enteredAt: entered,
        eventDate: utcToBusinessTime(event.startsAt).date,
        leadTimeDays,
      });
  }
  const results = allocateConsumable(
    Number(stock[0]?.total ?? 0),
    await onOrderSource(tx, itemId),
    [...demands.values()],
  );

  for (const result of results)
    await tx
      .insert(consumableAllocations)
      .values({
        eventId: result.eventId,
        itemId,
        required: result.required,
        allocated: result.allocated,
        shortage: result.shortage,
        projectedStock: result.projectedStock,
        orderBy: result.orderBy,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: [consumableAllocations.eventId, consumableAllocations.itemId],
        set: {
          required: result.required,
          allocated: result.allocated,
          shortage: result.shortage,
          projectedStock: result.projectedStock,
          orderBy: result.orderBy,
          computedAt: now,
          updatedAt: now,
          archivedAt: null,
        },
      });
  // Events that no longer need it, or are no longer Closed or Preparation.
  const current = results.map((result) => result.eventId);
  await tx
    .update(consumableAllocations)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(consumableAllocations.itemId, itemId),
        isNull(consumableAllocations.archivedAt),
        current.length
          ? sql`${consumableAllocations.eventId} not in (${sql.join(
              current.map((eventId) => sql`${eventId}`),
              sql`, `,
            )})`
          : undefined,
      ),
    );
}

// --- Jobs ---------------------------------------------------------------------

const payloadItemId = (payload: unknown, key: "itemId" | "entityId") => {
  const value = (payload as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : undefined;
};

// The allocation job and the stock subscriber. Stock changes re-evaluate a
// rental's conflicts (FLOW-77) and recompute a consumable's allocations (FLOW-85);
// an item with no holds, conflicts or requirements costs one cheap check.
export function registerInventoryPlanning(registry: JobRegistry) {
  registry.register(RECOMPUTE_JOB, async (job, { db }) => {
    const itemId = payloadItemId(job.payload, "itemId");
    if (itemId) await db.transaction((tx) => recomputeItem(tx, itemId));
  });
  registry.register("event:stock.moved", async (job, { db }) => {
    const itemId = payloadItemId(job.payload, "entityId");
    if (!itemId) return;
    await db.transaction(async (tx) => {
      await evaluateItem(tx, itemId);
      await recomputeItem(tx, itemId);
    });
  });
  return registry;
}

// --- API ----------------------------------------------------------------------

async function validateConsumables(tx: DbLike, itemIds: string[]) {
  if (!itemIds.length) return;
  const rows = await tx
    .select({
      id: inventoryItems.id,
      kind: inventoryItems.kind,
      archivedAt: inventoryItems.archivedAt,
    })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, itemIds));
  if (
    rows.length !== itemIds.length ||
    rows.some((row) => row.kind !== "consumable" || row.archivedAt)
  )
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "Requirements can only name existing ingredients, bar stock and supplies.",
    );
}

// The event's requirements with what the last recompute decided for each.
export async function listRequirements(
  db: Db,
  actor: Actor,
  eventId: string,
): Promise<Requirement[]> {
  const event = await findVisibleEvent(db, actor, eventId);
  const lines = await db
    .select({
      line: eventRequirements,
      name: inventoryItems.name,
      unit: inventoryItems.unit,
    })
    .from(eventRequirements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, eventRequirements.itemId))
    .where(and(eq(eventRequirements.eventId, eventId), isNull(eventRequirements.archivedAt)))
    .orderBy(asc(inventoryItems.name), asc(eventRequirements.source));
  const results = await db
    .select()
    .from(consumableAllocations)
    .where(
      and(eq(consumableAllocations.eventId, eventId), isNull(consumableAllocations.archivedAt)),
    );
  const byItem = new Map(results.map((row) => [row.itemId, row]));
  return lines.map(({ line, name, unit }) => {
    const result = byItem.get(line.itemId);
    return {
      itemId: line.itemId,
      itemName: name,
      unit,
      basis: line.basis,
      quantity: line.quantity,
      source: line.source,
      required: requiredQuantity(line, event.guestCount),
      allocated: result?.allocated ?? null,
      shortage: result?.shortage ?? null,
      projectedStock: result?.projectedStock ?? null,
      orderBy: result?.orderBy ?? null,
    };
  });
}

// Replaces the event's manually entered requirements as a set and asks for the
// affected items to be recomputed. Other sources' lines are left alone.
export async function setManualRequirements(
  db: Db,
  actor: Actor,
  eventId: string,
  input: RequirementsInput,
): Promise<Requirement[]> {
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    await validateConsumables(tx, input.lines.map((line) => line.itemId));
    const existing = await tx
      .select()
      .from(eventRequirements)
      .where(
        and(
          eq(eventRequirements.eventId, eventId),
          eq(eventRequirements.source, "manual"),
          isNull(eventRequirements.archivedAt),
        ),
      );
    const wanted = new Map(input.lines.map((line) => [line.itemId, line]));
    const before = Object.fromEntries(
      existing.map((row) => [row.itemId, { basis: row.basis, quantity: row.quantity }]),
    );
    for (const row of existing) {
      const line = wanted.get(row.itemId);
      if (!line)
        await tx
          .update(eventRequirements)
          .set({ archivedAt: new Date(), updatedBy: actor.userId })
          .where(eq(eventRequirements.id, row.id));
      else if (row.basis !== (line.basis ?? "fixed") || row.quantity !== line.quantity)
        await tx
          .update(eventRequirements)
          .set({ basis: line.basis ?? "fixed", quantity: line.quantity, updatedBy: actor.userId })
          .where(eq(eventRequirements.id, row.id));
    }
    const kept = new Set(existing.map((row) => row.itemId));
    const added = input.lines.filter((line) => !kept.has(line.itemId));
    if (added.length)
      await tx.insert(eventRequirements).values(
        added.map((line) => ({
          eventId,
          itemId: line.itemId,
          basis: line.basis ?? "fixed",
          quantity: line.quantity,
          source: "manual",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      );
    await writeAudit(tx, actor, {
      entityType: "event_requirements",
      entityId: eventId,
      action: "update",
      before,
      after: Object.fromEntries(
        input.lines.map((line) => [
          line.itemId,
          { basis: line.basis ?? "fixed", quantity: line.quantity },
        ]),
      ),
    });
    for (const itemId of new Set([...existing.map((row) => row.itemId), ...wanted.keys()]))
      await requestRecompute(tx, itemId);
  });
  return listRequirements(db, actor, eventId);
}

// Who gets the item, in booking order, and who is short (AC1/AC2).
export async function itemAllocations(
  db: Db,
  actor: Actor,
  itemId: string,
): Promise<ItemAllocationRow[]> {
  const [item] = await db
    .select({ kind: inventoryItems.kind })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  if (!item) throw notFound("Item");
  if (item.kind !== "consumable")
    throw new ApiError(400, "INVALID_REQUEST", "Allocation applies to consumable items.");
  const rows = await db
    .select({ result: consumableAllocations, event: events })
    .from(consumableAllocations)
    .innerJoin(events, eq(events.id, consumableAllocations.eventId))
    .where(
      and(eq(consumableAllocations.itemId, itemId), isNull(consumableAllocations.archivedAt)),
    );
  const visible = new Set(
    rows.length
      ? (
          await db
            .select({ id: events.id })
            .from(events)
            .where(
              and(
                inArray(events.id, rows.map((row) => row.event.id)),
                visibleEvents(actor),
              ),
            )
        ).map((row) => row.id)
      : [],
  );
  return rows
    .sort((a, b) =>
      bookingOrder(
        {
          id: a.event.id,
          bookedAt: a.event.bookedAt?.toISOString() ?? null,
          enteredAt: a.result.createdAt.toISOString(),
        },
        {
          id: b.event.id,
          bookedAt: b.event.bookedAt?.toISOString() ?? null,
          enteredAt: b.result.createdAt.toISOString(),
        },
      ),
    )
    .map(({ result, event }) => ({
      eventId: event.id,
      eventTitle: visible.has(event.id) ? event.title : null,
      eventDate: utcToBusinessTime(event.startsAt).date,
      bookedAt: event.bookedAt?.toISOString() ?? null,
      required: result.required,
      allocated: result.allocated,
      shortage: result.shortage,
      projectedStock: result.projectedStock,
      orderBy: result.orderBy,
    }));
}
