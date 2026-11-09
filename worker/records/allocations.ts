import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  allocateConsumable,
  allocatePool,
  allocatedEventStatuses,
  type BarPlan,
  type BarPlanInput,
  type PoolDemand,
  type PoolItem,
  requiredQuantity,
  type Demand,
  type ItemAllocationRow,
  type OnOrder,
  type Requirement,
  type RequirementsInput,
} from "../../shared/allocation";
import { outstanding } from "../../shared/order-lists";
import { bookingOrder } from "../../shared/reservations";
import { utcToBusinessTime } from "../../shared/time";
import { convert, type Unit } from "../../shared/units";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  consumableAllocations,
  eventBarTiers,
  eventRequirements,
  events,
  inventoryBarDetails,
  inventoryConsumableDetails,
  inventoryItems,
  inventoryStock,
  jobs,
  vendorOrders,
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

// Orders on their way (FLOW-87 AC2): what is still to arrive on each recorded
// vendor order that isn't received or cancelled, converted from purchase units to
// the item's stock unit and counted from the order's expected delivery date (AC4's
// date rule is in shared/allocation.ts).
export type OnOrderSource = (db: DbLike, itemId: string) => Promise<OnOrder[]>;
export const vendorOrdersOnOrder: OnOrderSource = async (db, itemId) => {
  const [orders, [item]] = await Promise.all([
    db
      .select({ lines: vendorOrders.lines, expectedDelivery: vendorOrders.expectedDelivery })
      .from(vendorOrders)
      .where(
        and(
          inArray(vendorOrders.status, ["ordered", "partially_received"]),
          isNull(vendorOrders.archivedAt),
          sql`${vendorOrders.lines} @> ${JSON.stringify([{ itemId }])}::jsonb`,
        ),
      ),
    db
      .select({ unit: inventoryItems.unit, detail: inventoryConsumableDetails })
      .from(inventoryItems)
      .innerJoin(inventoryConsumableDetails, eq(inventoryConsumableDetails.itemId, inventoryItems.id))
      .where(eq(inventoryItems.id, itemId)),
  ]);
  if (!item) return [];
  return orders.flatMap((order) =>
    order.lines
      .filter((line) => line.itemId === itemId && outstanding(line) > 0)
      .flatMap((line) => {
        const converted = convert(outstanding(line), line.purchaseUnit as Unit, item.unit as Unit, {
          packCount: item.detail.packCount,
          eachSize:
            item.detail.eachSizeQuantity !== null && item.detail.eachSizeUnit
              ? { quantity: item.detail.eachSizeQuantity, unit: item.detail.eachSizeUnit as Unit }
              : null,
        });
        return converted.ok
          ? [{ quantity: converted.value, expectedDelivery: order.expectedDelivery }]
          : [];
      }),
  );
};
let onOrderSource: OnOrderSource = vendorOrdersOnOrder;
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
  // Bar tier lines (FLOW-170) recompute their whole pool.
  const tiers = await tx
    .selectDistinct({ category: eventBarTiers.category, tier: eventBarTiers.tier })
    .from(eventBarTiers)
    .where(and(eq(eventBarTiers.eventId, eventId), isNull(eventBarTiers.archivedAt)));
  for (const { category, tier } of tiers) await requestBarRecompute(tx, category, tier);
}

// Recomputes one consumable's allocations: every event at Closed or later that
// requires it, in booking order, against what is on hand and on order. Safe to
// repeat; it locks the item so recomputes of one item run one at a time.
export async function recomputeItem(tx: DbLike, itemId: string, now = new Date()) {
  const [pool] = await tx
    .select({ subtype: inventoryItems.subtype, category: inventoryItems.category, tier: inventoryItems.tier })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  // A bar item with a tier is allocated with the rest of its tier (FLOW-170).
  if (pool?.subtype === "bar" && isBarTier(pool.tier))
    return recomputeBarPool(tx, pool.category, pool.tier, now);
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

// --- Bar tier pools (FLOW-170) -------------------------------------------------

export const BAR_RECOMPUTE_JOB = "allocation.recompute_bar";
type Tier = (typeof eventBarTiers.$inferSelect)["tier"];
const isBarTier = (value: string): value is Tier => ["rail", "mid", "high", "premium"].includes(value);

// Queues a recompute of one category and tier's pool unless one is waiting.
export async function requestBarRecompute(tx: DbLike, category: string, tier: string) {
  const [waiting] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, BAR_RECOMPUTE_JOB),
        eq(jobs.status, "pending"),
        isNull(jobs.archivedAt),
        sql`${jobs.payload}->>'category' = ${category}`,
        sql`${jobs.payload}->>'tier' = ${tier}`,
      ),
    )
    .limit(1);
  if (waiting) return;
  await enqueueJob(tx, {
    type: BAR_RECOMPUTE_JOB,
    payload: { category, tier },
    idempotencyKey: `${BAR_RECOMPUTE_JOB}:${category}:${tier}:${crypto.randomUUID()}`,
  });
}

// Recomputes every bar item of one category and tier, and the event tier lines
// that draw on them, in booking order (shared/allocation.ts allocatePool). Locks
// the pool's items in id order so pool recomputes run one at a time.
export async function recomputeBarPool(tx: DbLike, category: string, tier: string, now = new Date()) {
  if (!isBarTier(tier)) return;
  const inPool = and(
    eq(inventoryItems.kind, "consumable"),
    eq(inventoryItems.subtype, "bar"),
    eq(inventoryItems.category, category),
    eq(inventoryItems.tier, tier),
    isNull(inventoryItems.archivedAt),
  );
  await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(inPool)
    .orderBy(asc(inventoryItems.id)).for("update");
  const [rows, tierLines] = await Promise.all([
    tx
      .select({ item: inventoryItems, bar: inventoryBarDetails, leadTimeDays: vendors.leadTimeDays })
      .from(inventoryItems)
      .leftJoin(inventoryBarDetails, eq(inventoryBarDetails.itemId, inventoryItems.id))
      .leftJoin(inventoryConsumableDetails, eq(inventoryConsumableDetails.itemId, inventoryItems.id))
      .leftJoin(vendors, eq(vendors.id, inventoryConsumableDetails.preferredVendorId))
      .where(inPool),
    tx
      .select({ line: eventBarTiers, event: events })
      .from(eventBarTiers)
      .innerJoin(events, eq(events.id, eventBarTiers.eventId))
      .where(and(eq(eventBarTiers.category, category), eq(eventBarTiers.tier, tier), isNull(eventBarTiers.archivedAt))),
  ]);
  const itemIds = rows.map((row) => row.item.id);
  const stock = itemIds.length
    ? await tx
        .select({ itemId: inventoryStock.itemId, total: sql<string>`coalesce(sum(${inventoryStock.quantity}), 0)` })
        .from(inventoryStock)
        .where(and(inArray(inventoryStock.itemId, itemIds), isNull(inventoryStock.archivedAt)))
        .groupBy(inventoryStock.itemId)
    : [];
  const lines = itemIds.length
    ? await tx
        .select({ line: eventRequirements, event: events })
        .from(eventRequirements)
        .innerJoin(events, eq(events.id, eventRequirements.eventId))
        .where(
          and(
            inArray(eventRequirements.itemId, itemIds),
            isNull(eventRequirements.archivedAt),
            isNull(events.archivedAt),
            inArray(events.status, [...allocatedEventStatuses]),
          ),
        )
    : [];
  const onHand = new Map(stock.map((row) => [row.itemId, Number(row.total)]));
  const items: PoolItem[] = [];
  for (const row of rows)
    items.push({
      itemId: row.item.id,
      name: row.item.name,
      onHand: onHand.get(row.item.id) ?? 0,
      onOrder: await onOrderSource(tx, row.item.id),
      leadTimeDays: row.leadTimeDays ?? null,
      housePick: row.bar?.housePick ?? false,
    });
  // Inactive items keep their own lines but aren't drawn on for a tier.
  const drawable = rows.filter((row) => row.item.active);

  const demands = new Map<string, PoolDemand>();
  const demandFor = (event: typeof events.$inferSelect, entered: Date) => {
    const enteredAt = entered.toISOString();
    let demand = demands.get(event.id);
    if (!demand) {
      demand = {
        eventId: event.id,
        bookedAt: event.bookedAt?.toISOString() ?? null,
        enteredAt,
        eventDate: utcToBusinessTime(event.startsAt).date,
        items: {},
        tiers: [],
      };
      demands.set(event.id, demand);
    } else if (enteredAt < demand.enteredAt) demand.enteredAt = enteredAt;
    return demand;
  };
  for (const { line, event } of lines) {
    const demand = demandFor(event, line.createdAt);
    demand.items = {
      ...demand.items,
      [line.itemId]: round((demand.items[line.itemId] ?? 0) + requiredQuantity(line, event.guestCount)),
    };
  }
  const allocatedStatuses: readonly string[] = allocatedEventStatuses;
  const live = tierLines.filter(({ event }) => !event.archivedAt && allocatedStatuses.includes(event.status));
  for (const { line, event } of live) {
    const demand = demandFor(event, line.createdAt);
    demand.tiers = [
      ...demand.tiers,
      {
        lineId: line.id,
        required: requiredQuantity(line, event.guestCount),
        candidates: drawable
          .filter((row) => !line.subcategory || row.bar?.subcategory === line.subcategory)
          .map((row) => row.item.id),
      },
    ];
  }
  const results = allocatePool(items, [...demands.values()]);

  for (const result of results.items)
    await tx
      .insert(consumableAllocations)
      .values({
        eventId: result.eventId,
        itemId: result.itemId,
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
  // Each pool item keeps only the events this recompute gave it.
  for (const itemId of itemIds) {
    const current = results.items.filter((result) => result.itemId === itemId).map((result) => result.eventId);
    await tx
      .update(consumableAllocations)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(consumableAllocations.itemId, itemId),
          isNull(consumableAllocations.archivedAt),
          current.length
            ? sql`${consumableAllocations.eventId} not in (${sql.join(current.map((eventId) => sql`${eventId}`), sql`, `)})`
            : undefined,
        ),
      );
  }
  // Tier lines of events not Closed or later have no result.
  const decided = new Map(results.tiers.map((result) => [result.lineId, result]));
  for (const { line } of tierLines) {
    const result = decided.get(line.id);
    await tx
      .update(eventBarTiers)
      .set({
        allocated: result?.allocated ?? null,
        shortage: result?.shortage ?? null,
        orderBy: result?.orderBy ?? null,
        reorderItemId: result?.reorderItemId ?? null,
        computedAt: result ? now : null,
      })
      .where(eq(eventBarTiers.id, line.id));
  }
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
  registry.register(BAR_RECOMPUTE_JOB, async (job, { db }) => {
    const { category, tier } = (job.payload ?? {}) as { category?: unknown; tier?: unknown };
    if (typeof category === "string" && typeof tier === "string")
      await db.transaction((tx) => recomputeBarPool(tx, category, tier));
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

// Replaces the event's lines from one source as a set and asks for the affected
// items to be recomputed. Other sources' lines are left alone.
export async function replaceRequirements(
  tx: DbLike,
  actor: Actor | null,
  eventId: string,
  source: string,
  lines: RequirementsInput["lines"],
) {
  const existing = await tx
    .select()
    .from(eventRequirements)
    .where(
      and(
        eq(eventRequirements.eventId, eventId),
        eq(eventRequirements.source, source),
        isNull(eventRequirements.archivedAt),
      ),
    );
  const wanted = new Map(lines.map((line) => [line.itemId, line]));
  // Manual lines keep the item id as the audit key; other sources prefix theirs.
  const key = (itemId: string) => (source === "manual" ? itemId : `${source}:${itemId}`);
  const before = Object.fromEntries(
    existing.map((row) => [key(row.itemId), { basis: row.basis, quantity: row.quantity }]),
  );
  for (const row of existing) {
    const line = wanted.get(row.itemId);
    if (!line)
      await tx
        .update(eventRequirements)
        .set({ archivedAt: new Date(), updatedBy: actor?.userId ?? null })
        .where(eq(eventRequirements.id, row.id));
    else if (row.basis !== (line.basis ?? "fixed") || row.quantity !== line.quantity)
      await tx
        .update(eventRequirements)
        .set({ basis: line.basis ?? "fixed", quantity: line.quantity, updatedBy: actor?.userId ?? null })
        .where(eq(eventRequirements.id, row.id));
  }
  const kept = new Set(existing.map((row) => row.itemId));
  const added = lines.filter((line) => !kept.has(line.itemId));
  if (added.length)
    await tx.insert(eventRequirements).values(
      added.map((line) => ({
        eventId,
        itemId: line.itemId,
        basis: line.basis ?? "fixed",
        quantity: line.quantity,
        source,
        createdBy: actor?.userId ?? null,
        updatedBy: actor?.userId ?? null,
      })),
    );
  await writeAudit(tx, actor, {
    entityType: "event_requirements",
    entityId: eventId,
    action: "update",
    before,
    after: Object.fromEntries(
      lines.map((line) => [key(line.itemId), { basis: line.basis ?? "fixed", quantity: line.quantity }]),
    ),
  });
  for (const itemId of new Set([...existing.map((row) => row.itemId), ...wanted.keys()]))
    await requestRecompute(tx, itemId);
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
    await replaceRequirements(tx, actor, eventId, "manual", input.lines);
  });
  return listRequirements(db, actor, eventId);
}

// --- Bar plan (FLOW-170) --------------------------------------------------------

const tierKey = (line: { category: string; subcategory: string; tier: string }) =>
  `${line.category}|${line.subcategory}|${line.tier}`;

// The event's bar lines: by item (requirements with source "bar") and by tier,
// with what the last recompute decided for each.
export async function getBarPlan(db: Db, actor: Actor, eventId: string): Promise<BarPlan> {
  const event = await findVisibleEvent(db, actor, eventId);
  const items = (await listRequirements(db, actor, eventId)).filter((line) => line.source === "bar");
  const lines = await db
    .select({ line: eventBarTiers, reorderName: inventoryItems.name })
    .from(eventBarTiers)
    .leftJoin(inventoryItems, eq(inventoryItems.id, eventBarTiers.reorderItemId))
    .where(and(eq(eventBarTiers.eventId, eventId), isNull(eventBarTiers.archivedAt)))
    .orderBy(asc(eventBarTiers.category), asc(eventBarTiers.subcategory), asc(eventBarTiers.tier));
  const pools = lines.length
    ? await db
        .select({
          name: inventoryItems.name,
          category: inventoryItems.category,
          tier: inventoryItems.tier,
          subcategory: inventoryBarDetails.subcategory,
        })
        .from(inventoryItems)
        .leftJoin(inventoryBarDetails, eq(inventoryBarDetails.itemId, inventoryItems.id))
        .where(
          and(
            eq(inventoryItems.kind, "consumable"),
            eq(inventoryItems.subtype, "bar"),
            eq(inventoryItems.active, true),
            isNull(inventoryItems.archivedAt),
            inArray(inventoryItems.category, [...new Set(lines.map(({ line }) => line.category))]),
          ),
        )
        .orderBy(asc(inventoryItems.name))
    : [];
  return {
    items,
    tiers: lines.map(({ line, reorderName }) => ({
      id: line.id,
      category: line.category,
      subcategory: line.subcategory,
      tier: line.tier,
      basis: line.basis,
      quantity: line.quantity,
      required: requiredQuantity(line, event.guestCount),
      allocated: line.allocated,
      shortage: line.shortage,
      orderBy: line.orderBy,
      reorderItemName: line.computedAt ? reorderName : null,
      items: pools
        .filter(
          (item) =>
            item.category === line.category &&
            item.tier === line.tier &&
            (!line.subcategory || item.subcategory === line.subcategory),
        )
        .map((item) => item.name),
    })),
  };
}

// Replaces the event's bar lines, by item and by tier, as a set, and asks for the
// items and tier pools they touch to be recomputed.
export async function setBarPlan(db: Db, actor: Actor, eventId: string, input: BarPlanInput): Promise<BarPlan> {
  const items = input.items ?? [];
  const tiers = (input.tiers ?? []).map((line) => ({
    category: line.category,
    subcategory: line.subcategory ?? "",
    tier: line.tier,
    basis: line.basis ?? "fixed",
    quantity: line.quantity,
  }));
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const ids = items.map((line) => line.itemId);
    if (ids.length) {
      const rows = await tx
        .select({ id: inventoryItems.id, subtype: inventoryItems.subtype, archivedAt: inventoryItems.archivedAt })
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, ids));
      if (rows.length !== ids.length || rows.some((row) => row.subtype !== "bar" || row.archivedAt))
        throw new ApiError(400, "INVALID_REQUEST", "Bar lines can only name existing bar items.");
    }
    await replaceRequirements(tx, actor, eventId, "bar", items);

    const existing = await tx
      .select()
      .from(eventBarTiers)
      .where(and(eq(eventBarTiers.eventId, eventId), isNull(eventBarTiers.archivedAt)));
    const wanted = new Map(tiers.map((line) => [tierKey(line), line]));
    for (const row of existing) {
      const line = wanted.get(tierKey(row));
      if (!line)
        await tx
          .update(eventBarTiers)
          .set({ archivedAt: new Date(), updatedBy: actor.userId })
          .where(eq(eventBarTiers.id, row.id));
      else if (row.basis !== line.basis || row.quantity !== line.quantity)
        await tx
          .update(eventBarTiers)
          .set({ basis: line.basis, quantity: line.quantity, updatedBy: actor.userId })
          .where(eq(eventBarTiers.id, row.id));
    }
    const kept = new Set(existing.map(tierKey));
    const added = tiers.filter((line) => !kept.has(tierKey(line)));
    if (added.length)
      await tx
        .insert(eventBarTiers)
        .values(added.map((line) => ({ eventId, ...line, createdBy: actor.userId, updatedBy: actor.userId })));
    await writeAudit(tx, actor, {
      entityType: "event_requirements",
      entityId: eventId,
      action: "update",
      before: Object.fromEntries(
        existing.map((row) => [`tier:${tierKey(row)}`, { basis: row.basis, quantity: row.quantity }]),
      ),
      after: Object.fromEntries(
        tiers.map((line) => [`tier:${tierKey(line)}`, { basis: line.basis, quantity: line.quantity }]),
      ),
    });
    const pools = new Map(
      [...existing, ...tiers].map((line) => [`${line.category}|${line.tier}`, line]),
    );
    for (const { category, tier } of pools.values()) await requestBarRecompute(tx, category, tier);
    await requestEventRecompute(tx, eventId);
  });
  return getBarPlan(db, actor, eventId);
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
