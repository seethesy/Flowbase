import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { estimatedTotalCents, isDeletableList, isPlaced, suggestOrderLines, type OrderCandidate, type OrderLine, type OrderList,
  type ReceiveInput, type RecordOrderInput, type VendorOrder } from "../../shared/order-lists";
import type { Unit } from "../../shared/units";
import type { Db, DbLike } from "../db/client";
import { consumableAllocations, events, inventoryConsumableDetails, inventoryItems,
  inventoryStock, orderLists, users, vendors } from "../db/schema";
import { canSeeField } from "../../shared/visibility";
import { writeAudit } from "../audit/log";
import { ApiError, forbidden, notFound } from "../hono";
import { can } from "../policy";
import { registerApprovalSubject, requestApproval } from "./approvals";
import { cancelOrderList as cancelList, cancelVendorOrder, ordersByList, receiveVendorOrder,
  recordVendorOrder } from "./vendor-orders";

const requireEditor = (actor: Actor) => {
  if (!can(actor, "order_lists.write")) throw forbidden();
};
type ListRow = typeof orderLists.$inferSelect;
type Extras = { estTotalCents: number | null; createdBy: OrderList["createdBy"] };
const toList = (row: ListRow, orders: VendorOrder[] = [], extras?: Extras): OrderList => ({
  id: row.id, from: row.fromDate, to: row.toDate, status: row.status,
  lines: row.lines, approvalId: row.approvalId, orders, notes: row.notes,
  estTotalCents: extras?.estTotalCents ?? null, createdBy: extras?.createdBy ?? null,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

// The Purchasing tab's Est. total and Created by (FLOW-300). Unit costs are
// internal costs (F-01-04), so the total stays null for people who can't see them.
async function listExtras(db: DbLike, actor: Actor, rows: ListRow[]): Promise<Map<string, Extras>> {
  const canSeeCosts = canSeeField(actor, "internal_cost");
  const itemIds = [...new Set(rows.flatMap((row) => row.lines.map((line) => line.itemId)))];
  const creatorIds = [...new Set(rows.map((row) => row.createdBy).filter((value): value is string => !!value))];
  const costs: { itemId: string; cents: number | null }[] = itemIds.length && canSeeCosts
    ? await db.select({ itemId: inventoryConsumableDetails.itemId, cents: inventoryConsumableDetails.unitCostCents })
      .from(inventoryConsumableDetails).where(inArray(inventoryConsumableDetails.itemId, itemIds))
    : [];
  const creators: { id: string; name: string }[] = creatorIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds))
    : [];
  const unitCosts = new Map<string, number | null>(costs.map((row) => [row.itemId, row.cents]));
  const names = new Map(creators.map((row) => [row.id, row.name]));
  return new Map(rows.map((row) => [row.id, {
    estTotalCents: canSeeCosts ? estimatedTotalCents(row.lines, unitCosts) : null,
    createdBy: row.createdBy ? { id: row.createdBy, name: names.get(row.createdBy) ?? "" } : null,
  }]));
}

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
  return toList(row, [], (await listExtras(db, actor, [row])).get(row.id));
}
export async function listOrderLists(db: DbLike, actor: Actor) {
  requireEditor(actor);
  const rows = await db.select().from(orderLists).where(isNull(orderLists.archivedAt))
    .orderBy(sql`${orderLists.createdAt} desc`).limit(100);
  const [orders, extras] = await Promise.all([
    ordersByList(db, actor, rows.map((row) => row.id)), listExtras(db, actor, rows)]);
  return rows.map((row) => toList(row, orders.get(row.id), extras.get(row.id)));
}
export async function getOrderList(db: DbLike, actor: Actor, id: string) {
  requireEditor(actor);
  const [row] = await db.select().from(orderLists)
    .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt)));
  if (!row) throw notFound("Order list");
  const [orders, extras] = await Promise.all([
    ordersByList(db, actor, [row.id]), listExtras(db, actor, [row])]);
  return toList(row, orders.get(row.id), extras.get(row.id));
}

// The list's notes, edited inline on the Purchasing tab (FLOW-300), in any status.
export async function updateOrderListNotes(db: Db, actor: Actor, id: string, notes: string) {
  requireEditor(actor);
  const [row] = await db.update(orderLists).set({ notes, updatedBy: actor.userId, updatedAt: new Date() })
    .where(and(eq(orderLists.id, id), isNull(orderLists.archivedAt))).returning({ id: orderLists.id });
  if (!row) throw notFound("Order list");
  return getOrderList(db, actor, id);
}

// Bulk delete (FLOW-300): only Draft, Rejected and Cancelled lists; the others
// wait for approval or have orders recorded against them.
export async function orderListDeleteName(db: Db, actor: Actor, id: string) {
  const list = await getOrderList(db, actor, id);
  return `Order list ${list.from} – ${list.to}`;
}
export async function orderListDeleteBlocked(db: DbLike, actor: Actor, id: string) {
  const list = await getOrderList(db, actor, id);
  return isDeletableList(list.status) ? null : "only Draft, Rejected and Cancelled lists can be deleted";
}
export async function setOrderListArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  requireEditor(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(orderLists).where(eq(orderLists.id, id)).for("update");
    if (!row || (archived && row.archivedAt)) throw notFound("Order list");
    if (archived && !isDeletableList(row.status))
      throw new ApiError(409, "ORDER_LIST_NOT_DELETABLE", "Only Draft, Rejected and Cancelled lists can be deleted.");
    const [updated] = await tx.update(orderLists)
      .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(orderLists.id, id)).returning();
    const snapshot = (value: ListRow) => ({ status: value.status, from: value.fromDate, to: value.toDate,
      archivedAt: value.archivedAt?.toISOString() ?? null });
    await writeAudit(tx, actor, { entityType: "order_list", entityId: id,
      action: archived ? "archive" : "restore", before: snapshot(row), after: snapshot(updated) });
  });
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
