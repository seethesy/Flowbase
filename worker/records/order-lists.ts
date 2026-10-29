import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { suggestOrderLines, type OrderCandidate, type OrderLine, type OrderList } from "../../shared/order-lists";
import type { Unit } from "../../shared/units";
import type { Db, DbLike } from "../db/client";
import { consumableAllocations, events, inventoryConsumableDetails, inventoryItems,
  inventoryStock, orderLists, vendors } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { registerApprovalSubject, requestApproval } from "./approvals";

const requireEditor = (actor: Actor) => {
  if (actor.role !== "admin" && actor.role !== "kitchen_lead") throw forbidden();
};
const toList = (row: typeof orderLists.$inferSelect): OrderList => ({
  id: row.id, from: row.fromDate, to: row.toDate, status: row.status,
  lines: row.lines, approvalId: row.approvalId,
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

export async function suggestOrderList(db: DbLike, from: string, to: string): Promise<OrderLine[]> {
  const [items, stock, allocations] = await Promise.all([
    db.select({ item: inventoryItems, detail: inventoryConsumableDetails, vendor: vendors })
      .from(inventoryItems)
      .innerJoin(inventoryConsumableDetails, eq(inventoryConsumableDetails.itemId, inventoryItems.id))
      .leftJoin(vendors, eq(vendors.id, inventoryConsumableDetails.preferredVendorId))
      .where(and(eq(inventoryItems.kind, "consumable"), eq(inventoryItems.active, true),
        isNull(inventoryItems.archivedAt))),
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
export async function listOrderLists(db: DbLike, actor: Actor) {
  requireEditor(actor);
  return (await db.select().from(orderLists).where(isNull(orderLists.archivedAt))
    .orderBy(sql`${orderLists.createdAt} desc`).limit(100)).map(toList);
}
export async function getOrderList(db: DbLike, actor: Actor, id: string) {
  requireEditor(actor);
  const [row] = await db.select().from(orderLists)
    .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt)));
  if (!row) throw notFound("Order list");
  return toList(row);
}
export async function updateOrderList(db: Db, actor: Actor, id: string, lines: OrderLine[]) {
  requireEditor(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(orderLists)
      .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt))).for("update");
    if (!row) throw notFound("Order list");
    if (row.status === "submitted") throw new ApiError(409, "ORDER_LIST_SUBMITTED", "Wait for the approval decision before editing.");
    const ids = [...new Set(lines.map((line) => line.itemId))];
    const valid = ids.length ? await tx.select({ id: inventoryItems.id }).from(inventoryItems)
      .where(and(inArray(inventoryItems.id, ids), eq(inventoryItems.kind, "consumable"))) : [];
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
