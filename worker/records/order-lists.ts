import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { isPlaced, suggestOrderLines, type OrderCandidate, type OrderLine, type OrderList,
  type ReceiveInput, type RecordOrderInput, type VendorOrder } from "../../shared/order-lists";
import type { Unit } from "../../shared/units";
import { utcToBusinessTime } from "../../shared/time";
import type { Db, DbLike } from "../db/client";
import { consumableAllocations, events, inventoryConsumableDetails, allInventoryItems, allInventoryItemFields,
  inventoryStock, orderLists, vendors } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { can } from "../policy";
import { registerApprovalSubject, requestApproval } from "./approvals";
import { cancelOrderList as cancelList, cancelVendorOrder, ordersByList, receiveVendorOrder,
  recordVendorOrder } from "./vendor-orders";

const requireEditor = (actor: Actor) => {
  if (!can(actor, "order_lists.write")) throw forbidden();
};
const toList = (row: typeof orderLists.$inferSelect, orders: VendorOrder[] = []): OrderList => ({
  id: row.id, from: row.fromDate, to: row.toDate, status: row.status,
  lines: row.lines, approvalId: row.approvalId, orders,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

registerApprovalSubject("order_list", {
  approverRole: "admin",
  onApproved: async (tx, actor, request) => {
    await tx.update(orderLists)
      .set({ status: "approved", updatedBy: actor.userId, updatedAt: new Date() })
      .where(and(eq(orderLists.id, request.subjectId), eq(orderLists.status, "submitted")));
  },
  onRejected: async (tx, actor, request) => {
    await tx.update(orderLists)
      .set({ status: "rejected", updatedBy: actor.userId, updatedAt: new Date() })
      .where(and(eq(orderLists.id, request.subjectId), eq(orderLists.status, "submitted")));
  },
});

// Lines for the events and low stock from `from` to `to`; with itemIds, only
// those items' lines (the Order tab's Add to order list, FLOW-292).
export async function suggestOrderList(db: DbLike, from: string, to: string, itemIds?: string[]): Promise<OrderLine[]> {
  const [items, stock, allocations] = await Promise.all([
    db.select({ item: allInventoryItemFields, detail: inventoryConsumableDetails, vendor: vendors })
      .from(allInventoryItems)
      .innerJoin(inventoryConsumableDetails, eq(inventoryConsumableDetails.itemId, allInventoryItems.id))
      .leftJoin(vendors, eq(vendors.id, inventoryConsumableDetails.preferredVendorId))
      .where(and(eq(allInventoryItems.kind, "consumable"), eq(allInventoryItems.active, true),
        isNull(allInventoryItems.archivedAt),
        itemIds ? inArray(allInventoryItems.id, itemIds) : undefined)),
    db.select({ itemId: inventoryStock.itemId,
      onHand: sql<string>`coalesce(sum(${inventoryStock.quantity}), 0)` })
      .from(inventoryStock).where(isNull(inventoryStock.archivedAt))
      .groupBy(inventoryStock.itemId),
    db.select({ allocation: consumableAllocations, event: events })
      .from(consumableAllocations).innerJoin(events, eq(events.id, consumableAllocations.eventId))
      .where(and(isNull(consumableAllocations.archivedAt), isNull(events.archivedAt),
        sql`(${events.startsAt} at time zone 'America/New_York')::date between ${from}::date and ${to}::date`,
        sql`${consumableAllocations.shortage} > 0`)),
  ]);
  const onHand = new Map(stock.map((row) => [row.itemId, Number(row.onHand)]));
  const shortages = new Map<string, OrderCandidate["shortages"]>();
  for (const { allocation, event } of allocations) {
    const rows = shortages.get(allocation.itemId) ?? [];
    rows.push({ eventId: event.id, eventTitle: event.title, quantity: allocation.shortage, orderBy: allocation.orderBy });
    shortages.set(allocation.itemId, rows);
  }
  return suggestOrderLines(items.map(({ item, detail, vendor }) => ({
    itemId: item.id, itemName: item.name, unit: item.unit as Unit,
    purchaseUnit: detail.purchaseUnit as Unit, packCount: detail.packCount,
    eachSize: detail.eachSizeQuantity !== null && detail.eachSizeUnit
      ? { quantity: detail.eachSizeQuantity, unit: detail.eachSizeUnit as Unit } : null,
    vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? detail.preferredVendor,
    orderingInstructions: vendor?.orderingInstructions ?? "",
    onHand: onHand.get(item.id) ?? 0, parLevel: detail.parLevel,
    shortages: shortages.get(item.id) ?? [],
  })));
}

export async function createOrderList(db: Db, actor: Actor, from: string, to: string) {
  requireEditor(actor);
  const lines = await suggestOrderList(db, from, to);
  const [row] = await db.insert(orderLists).values({ fromDate: from, toDate: to, lines,
    createdBy: actor.userId, updatedBy: actor.userId }).returning();
  return toList(row);
}
// The Order tab's Add to order list (FLOW-292 AC4): puts each item on the newest
// draft order list, with what it needs to get back to par in purchase units,
// replacing a line the item already has there. With no draft list, a new one
// starts today. Items that need nothing are left off; the list is returned.
export async function addToDraftOrderList(db: Db, actor: Actor, itemIds: string[]) {
  requireEditor(actor);
  const today = utcToBusinessTime(new Date()).date;
  const id = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(orderLists)
      .where(and(eq(orderLists.status, "draft"), isNull(orderLists.archivedAt)))
      .orderBy(sql`${orderLists.createdAt} desc`).limit(1).for("update");
    const added = await suggestOrderList(tx, today, today, itemIds);
    if (!added.length && !draft)
      throw new ApiError(409, "NOTHING_TO_ORDER", "Nothing selected needs reordering.");
    if (!draft) {
      const [row] = await tx.insert(orderLists).values({ fromDate: today, toDate: today, lines: added,
        createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: orderLists.id });
      return row.id;
    }
    const replaced = new Set(added.map((line) => line.itemId));
    const lines = [...draft.lines.filter((line) => !replaced.has(line.itemId)), ...added];
    await tx.update(orderLists).set({ lines, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(orderLists.id, draft.id));
    return draft.id;
  });
  return getOrderList(db, actor, id);
}

export async function listOrderLists(db: DbLike, actor: Actor) {
  requireEditor(actor);
  const rows = await db.select().from(orderLists).where(isNull(orderLists.archivedAt))
    .orderBy(sql`${orderLists.createdAt} desc`).limit(100);
  const orders = await ordersByList(db, actor, rows.map((row) => row.id));
  return rows.map((row) => toList(row, orders.get(row.id)));
}
export async function getOrderList(db: DbLike, actor: Actor, id: string) {
  requireEditor(actor);
  const [row] = await db.select().from(orderLists)
    .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt)));
  if (!row) throw notFound("Order list");
  return toList(row, (await ordersByList(db, actor, [row.id])).get(row.id));
}
export async function updateOrderList(db: Db, actor: Actor, id: string, lines: OrderLine[]) {
  requireEditor(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(orderLists)
      .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt))).for("update");
    if (!row) throw notFound("Order list");
    if (row.status === "submitted") throw new ApiError(409, "ORDER_LIST_SUBMITTED", "Wait for the approval decision before editing.");
    if (isPlaced(row.status) && row.status !== "approved")
      throw new ApiError(409, "ORDER_LIST_ORDERED", "Orders are recorded against this list, so its lines can't change.");
    const ids = [...new Set(lines.map((line) => line.itemId))];
    const valid = ids.length ? await tx.select({ id: allInventoryItems.id }).from(allInventoryItems)
      .where(and(inArray(allInventoryItems.id, ids), eq(allInventoryItems.kind, "consumable"))) : [];
    if (valid.length !== ids.length || ids.length !== lines.length)
      throw new ApiError(400, "INVALID_REQUEST", "Each line must name a different consumable item.");
    await tx.update(orderLists).set({ lines, status: "draft", approvalId: null,
      updatedBy: actor.userId, updatedAt: new Date() }).where(eq(orderLists.id, id));
  });
  return getOrderList(db, actor, id);
}
export async function submitOrderList(db: Db, actor: Actor, id: string) {
  requireEditor(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(orderLists)
      .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt))).for("update");
    if (!row) throw notFound("Order list");
    if (row.status === "submitted") throw new ApiError(409, "ORDER_LIST_SUBMITTED", "This list is already waiting for approval.");
    if (isPlaced(row.status)) throw new ApiError(409, "ORDER_LIST_APPROVED", "This list is already approved.");
    if (!row.lines.length) throw new ApiError(400, "INVALID_REQUEST", "Add at least one line before submitting.");
    if (row.lines.some((line) => line.quantity <= 0))
      throw new ApiError(400, "INVALID_REQUEST", "Set a purchase quantity above zero for every line.");
    const approvalId = await requestApproval(tx, actor, { subjectType: "order_list", subjectId: id,
      summary: `Order list ${row.fromDate}–${row.toDate}`, link: `/inventory/orders/${id}` });
    await tx.update(orderLists).set({ status: "submitted", approvalId,
      updatedBy: actor.userId, updatedAt: new Date() }).where(eq(orderLists.id, id));
  });
  return getOrderList(db, actor, id);
}

// Ordering record (FLOW-87) and receiving (FLOW-88): worker/records/vendor-orders.ts.
export async function recordOrder(db: Db, actor: Actor, id: string, input: RecordOrderInput) {
  await db.transaction((tx) => recordVendorOrder(tx, actor, id, input));
  return getOrderList(db, actor, id);
}
export async function receiveOrder(db: Db, actor: Actor, id: string, orderId: string, input: ReceiveInput) {
  await db.transaction((tx) => receiveVendorOrder(tx, actor, id, orderId, input));
  return getOrderList(db, actor, id);
}
export async function cancelOrder(db: Db, actor: Actor, id: string, orderId: string) {
  await db.transaction((tx) => cancelVendorOrder(tx, actor, id, orderId));
  return getOrderList(db, actor, id);
}
export async function cancelOrderList(db: Db, actor: Actor, id: string) {
  await db.transaction((tx) => cancelList(tx, actor, id));
  return getOrderList(db, actor, id);
}
