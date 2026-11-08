import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  applyReceipt,
  listStatusFromOrders,
  listVendors,
  type OrderListStatus,
  type ReceiveInput,
  type RecordOrderInput,
  type VendorOrder,
  type VendorOrderLine,
} from "../../shared/order-lists";
import { utcToBusinessTime } from "../../shared/time";
import { convert, type Unit } from "../../shared/units";
import { canSeeField } from "../../shared/visibility";
import { writeAudit } from "../audit/log";
import type { DbLike } from "../db/client";
import {
  inventoryConsumableDetails,
  inventoryItems,
  orderLists,
  vendorOrders,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can } from "../policy";
import { requestRecompute } from "./allocations";
import { recordCostChange } from "./inventory-costs";
import { recordMovement } from "./inventory-ledger";

// Ordering record (FLOW-87) and receiving (FLOW-88). Admin places each vendor's
// order on the vendor's portal, outside Flowbase, and records it here; the
// kitchen then receives deliveries line by line, which adds stock to each item's
// storage section and captures the actual unit cost. No PO PDFs, emails or portal
// automation (Q-15).

type OrderRow = typeof vendorOrders.$inferSelect;
type ListRow = typeof orderLists.$inferSelect;

// Order totals and receipt costs are internal costs (F-01-04).
export function toVendorOrder(actor: Actor, row: OrderRow): VendorOrder {
  const costs = canSeeField(actor, "internal_cost");
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    status: row.status,
    portalOrderNumber: row.portalOrderNumber,
    orderedOn: row.orderedOn,
    expectedDelivery: row.expectedDelivery,
    totalCents: costs ? row.totalCents : null,
    notes: row.notes,
    lines: row.lines,
    receipts: row.receipts.map((receipt) => ({
      ...receipt,
      lines: receipt.lines.map((line) => ({ ...line, unitCostCents: costs ? line.unitCostCents : null })),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

// Every list's vendor orders, oldest first, in one query.
export async function ordersByList(db: DbLike, actor: Actor, listIds: string[]) {
  const byList = new Map<string, VendorOrder[]>();
  if (!listIds.length) return byList;
  const rows = await db
    .select()
    .from(vendorOrders)
    .where(and(inArray(vendorOrders.orderListId, listIds), isNull(vendorOrders.archivedAt)))
    .orderBy(asc(vendorOrders.createdAt));
  for (const row of rows) {
    const orders = byList.get(row.orderListId) ?? [];
    orders.push(toVendorOrder(actor, row));
    byList.set(row.orderListId, orders);
  }
  return byList;
}

async function lockList(tx: DbLike, listId: string) {
  const [list] = await tx
    .select()
    .from(orderLists)
    .where(and(eq(orderLists.id, listId), isNull(orderLists.archivedAt)))
    .for("update");
  if (!list) throw notFound("Order list");
  return list;
}

// Stores the list status its vendor orders imply.
async function syncListStatus(tx: DbLike, actor: Actor, list: ListRow) {
  const orders = await tx
    .select({ vendorName: vendorOrders.vendorName, status: vendorOrders.status })
    .from(vendorOrders)
    .where(and(eq(vendorOrders.orderListId, list.id), isNull(vendorOrders.archivedAt)));
  const status: OrderListStatus = listStatusFromOrders(listVendors(list.lines), orders);
  if (status !== list.status)
    await tx
      .update(orderLists)
      .set({ status, updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(orderLists.id, list.id));
}

const orderSnapshot = (row: OrderRow) => ({
  orderListId: row.orderListId,
  vendorName: row.vendorName,
  status: row.status,
  portalOrderNumber: row.portalOrderNumber,
  orderedOn: row.orderedOn,
  expectedDelivery: row.expectedDelivery,
  totalCents: row.totalCents,
  notes: row.notes,
  lines: row.lines,
});

async function audit(tx: DbLike, actor: Actor, before: OrderRow | null, after: OrderRow) {
  await writeAudit(tx, actor, {
    entityType: "vendor_order",
    entityId: after.id,
    action: before ? "update" : "create",
    before: before ? orderSnapshot(before) : null,
    after: orderSnapshot(after),
  });
}

// Records one vendor's portal order (FLOW-87). Only Admin places orders; the list
// must be approved, and the vendor must not already have an order on it that
// isn't cancelled. Lines start as approved; the input lists any quantities the
// portal order changed (0 drops the item).
export async function recordVendorOrder(tx: DbLike, actor: Actor, listId: string, input: RecordOrderInput) {
  if (!can(actor, "order_lists.approve")) throw forbidden();
  const list = await lockList(tx, listId);
  if (!["approved", "ordered", "partially_received"].includes(list.status))
    throw new ApiError(409, "ORDER_LIST_NOT_APPROVED", "Record orders once Admin has approved the list.");
  const approved = list.lines.filter((line) => line.vendorName === input.vendorName && line.quantity > 0);
  if (!approved.length)
    throw new ApiError(400, "INVALID_REQUEST", "This list has nothing to order from that vendor.");
  const changes = new Map((input.lines ?? []).map((line) => [line.itemId, line.ordered]));
  for (const itemId of changes.keys())
    if (!approved.some((line) => line.itemId === itemId))
      throw new ApiError(400, "INVALID_REQUEST", "Each changed line must be one of this vendor's approved lines.");
  const lines: VendorOrderLine[] = approved
    .map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName,
      purchaseUnit: line.purchaseUnit,
      approvedQuantity: line.quantity,
      ordered: changes.get(line.itemId) ?? line.quantity,
      received: 0,
      note: "",
    }))
    .filter((line) => line.ordered > 0);
  if (!lines.length)
    throw new ApiError(400, "INVALID_REQUEST", "Order at least one item, or cancel the list instead.");
  const [active] = await tx
    .select({ id: vendorOrders.id })
    .from(vendorOrders)
    .where(
      and(
        eq(vendorOrders.orderListId, listId),
        eq(vendorOrders.vendorName, input.vendorName),
        inArray(vendorOrders.status, ["ordered", "partially_received", "received"]),
        isNull(vendorOrders.archivedAt),
      ),
    );
  if (active)
    throw new ApiError(409, "VENDOR_ALREADY_ORDERED", "This vendor's order is already recorded.");
  const [row] = await tx
    .insert(vendorOrders)
    .values({
      orderListId: listId,
      vendorId: approved[0].vendorId,
      vendorName: input.vendorName,
      portalOrderNumber: input.portalOrderNumber,
      orderedOn: input.orderedOn,
      expectedDelivery: input.expectedDelivery,
      totalCents: input.totalCents ?? null,
      notes: input.notes ?? "",
      lines,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();
  await audit(tx, actor, null, row);
  await syncListStatus(tx, actor, list);
  // Projected stock now counts the order from its expected delivery date (AC2).
  for (const line of lines) await requestRecompute(tx, line.itemId);
}

async function lockOrder(tx: DbLike, listId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(vendorOrders)
    .where(
      and(
        eq(vendorOrders.id, orderId),
        eq(vendorOrders.orderListId, listId),
        isNull(vendorOrders.archivedAt),
      ),
    )
    .for("update");
  if (!order) throw notFound("Order");
  return order;
}

// Cancels a vendor order nothing has arrived for yet (Admin).
export async function cancelVendorOrder(tx: DbLike, actor: Actor, listId: string, orderId: string) {
  if (!can(actor, "order_lists.approve")) throw forbidden();
  const list = await lockList(tx, listId);
  const order = await lockOrder(tx, listId, orderId);
  if (order.status !== "ordered")
    throw new ApiError(409, "ORDER_RECEIVED", "Part of this order has arrived, so it can't be cancelled.");
  const [row] = await tx
    .update(vendorOrders)
    .set({ status: "cancelled", updatedBy: actor.userId, updatedAt: new Date() })
    .where(eq(vendorOrders.id, orderId))
    .returning();
  await audit(tx, actor, order, row);
  await syncListStatus(tx, actor, list);
  for (const line of order.lines) await requestRecompute(tx, line.itemId);
}

// Cancels an approved list nothing has arrived for: its open orders too (Admin).
export async function cancelOrderList(tx: DbLike, actor: Actor, listId: string) {
  if (!can(actor, "order_lists.approve")) throw forbidden();
  const list = await lockList(tx, listId);
  if (!["approved", "ordered"].includes(list.status))
    throw new ApiError(409, "ORDER_LIST_NOT_CANCELLABLE", "Only an approved list with nothing received can be cancelled.");
  const open = await tx
    .select()
    .from(vendorOrders)
    .where(
      and(eq(vendorOrders.orderListId, listId), eq(vendorOrders.status, "ordered"), isNull(vendorOrders.archivedAt)),
    )
    .for("update");
  for (const order of open) {
    const [row] = await tx
      .update(vendorOrders)
      .set({ status: "cancelled", updatedBy: actor.userId, updatedAt: new Date() })
      .where(eq(vendorOrders.id, order.id))
      .returning();
    await audit(tx, actor, order, row);
    for (const line of order.lines) await requestRecompute(tx, line.itemId);
  }
  await tx
    .update(orderLists)
    .set({ status: "cancelled", updatedBy: actor.userId, updatedAt: new Date() })
    .where(eq(orderLists.id, listId));
}

// Receives one delivery (FLOW-88): each line's usable quantity becomes a receive
// movement into the item's storage section, in the item's stock unit; an actual
// unit cost updates the item's cost and its cost history (AC2); short or damaged
// deliveries are noted on the line. The order becomes partially received, or
// received once everything has arrived or the user says nothing more is coming.
export async function receiveVendorOrder(
  tx: DbLike,
  actor: Actor,
  listId: string,
  orderId: string,
  input: ReceiveInput,
) {
  if (!can(actor, "order_lists.write")) throw forbidden();
  const list = await lockList(tx, listId);
  const order = await lockOrder(tx, listId, orderId);
  if (order.status !== "ordered" && order.status !== "partially_received")
    throw new ApiError(409, "ORDER_CLOSED", `This order is ${order.status.replace("_", " ")}.`);
  const costs = canSeeField(actor, "internal_cost");
  const rows = input.lines.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    unitCostCents: line.unitCostCents ?? null,
    note: line.note ?? "",
  }));
  if (rows.some((row) => row.unitCostCents !== null) && !costs) throw forbidden();
  if (new Set(rows.map((row) => row.itemId)).size !== rows.length)
    throw new ApiError(400, "INVALID_REQUEST", "List each item once.");
  if (rows.some((row) => !order.lines.some((line) => line.itemId === row.itemId)))
    throw new ApiError(400, "INVALID_REQUEST", "Each received line must be on this order.");
  if (!input.complete && rows.every((row) => row.quantity === 0 && !row.note))
    throw new ApiError(400, "INVALID_REQUEST", "Enter what arrived.");

  const itemIds = rows.map((row) => row.itemId);
  const items = await tx
    .select({ item: inventoryItems, detail: inventoryConsumableDetails })
    .from(inventoryItems)
    .innerJoin(inventoryConsumableDetails, eq(inventoryConsumableDetails.itemId, inventoryItems.id))
    .where(inArray(inventoryItems.id, itemIds));
  const byId = new Map(items.map((row) => [row.item.id, row]));
  const reason = `Received order ${order.portalOrderNumber} from ${order.vendorName}`;
  for (const row of rows) {
    const found = byId.get(row.itemId);
    const line = order.lines.find((candidate) => candidate.itemId === row.itemId)!;
    if (!found) throw notFound("Item");
    const { item, detail } = found;
    if (row.quantity > 0) {
      if (!detail.storageSectionId)
        throw new ApiError(409, "NO_STORAGE_SECTION", `Set a storage section for ${item.name} before receiving it.`);
      const stock = convert(row.quantity, line.purchaseUnit as Unit, item.unit as Unit, {
        packCount: detail.packCount,
        eachSize:
          detail.eachSizeQuantity !== null && detail.eachSizeUnit
            ? { quantity: detail.eachSizeQuantity, unit: detail.eachSizeUnit as Unit }
            : null,
      });
      if (!stock.ok)
        throw new ApiError(400, "CANNOT_CONVERT", `${item.name}: ${stock.message}`);
      await recordMovement(tx, actor, item, {
        type: "receive",
        changes: [{ sectionId: detail.storageSectionId, quantity: stock.value }],
        reason: row.note ? `${reason}: ${row.note}` : reason,
        link: { type: "order", id: order.id },
      });
    }
    if (row.unitCostCents !== null && row.unitCostCents !== detail.unitCostCents) {
      await tx
        .update(inventoryConsumableDetails)
        .set({ unitCostCents: row.unitCostCents, updatedBy: actor.userId })
        .where(eq(inventoryConsumableDetails.itemId, item.id));
      await recordCostChange(tx, actor, {
        itemId: item.id,
        previousCents: detail.unitCostCents,
        unitCostCents: row.unitCostCents,
        source: "receiving",
      });
    }
  }

  const next = applyReceipt(order.lines, rows, input.complete ?? false);
  const now = new Date();
  const [updated] = await tx
    .update(vendorOrders)
    .set({
      status: next.status,
      lines: next.lines,
      receipts: [...order.receipts, { at: now.toISOString(), by: actor.userId, lines: rows }],
      updatedBy: actor.userId,
      updatedAt: now,
    })
    .where(eq(vendorOrders.id, orderId))
    .returning();
  await audit(tx, actor, order, updated);
  await syncListStatus(tx, actor, list);
  if (next.status === "received")
    await emitDomainEvent(tx, {
      name: "order.received",
      entityId: order.id,
      data: { orderListId: listId, receivedOn: utcToBusinessTime(now).date },
    });
  // What is still on its way changed, even where no stock moved (a line closed short).
  for (const line of order.lines) await requestRecompute(tx, line.itemId);
}
