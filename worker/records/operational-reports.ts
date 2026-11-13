import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { inventoryItems, reservations, vendorOrders } from "../db/schema";

// Include rentals with no reservations, and count only primary holds so kit parts
// do not inflate utilization. A cancelled order contributes no spend.
export async function operationalReport(db: DbLike, from: string, to: string) {
  const [rentals, orders] = await Promise.all([
    db.select({
      itemId: inventoryItems.id,
      name: inventoryItems.name,
      reservations: sql<number>`count(${reservations.id})::int`,
      quantity: sql<number>`coalesce(sum(${reservations.quantity}), 0)::float8`,
    }).from(inventoryItems).leftJoin(reservations, and(
      eq(reservations.itemId, inventoryItems.id),
      isNull(reservations.archivedAt),
      ne(reservations.status, "released"),
      isNull(reservations.kitReservationId),
      gte(reservations.windowStart, from), lte(reservations.windowStart, to),
    )).where(and(eq(inventoryItems.kind, "rental"), isNull(inventoryItems.archivedAt)))
      .groupBy(inventoryItems.id, inventoryItems.name).orderBy(inventoryItems.name),
    db.select({
      vendor: vendorOrders.vendorName,
      month: sql<string>`to_char(${vendorOrders.orderedOn}, 'YYYY-MM')`,
      orders: sql<number>`count(*)::int`,
      spendCents: sql<number>`coalesce(sum(${vendorOrders.totalCents}), 0)::int`,
    }).from(vendorOrders).where(and(
      isNull(vendorOrders.archivedAt),
      sql`${vendorOrders.status} <> 'cancelled'`,
      gte(vendorOrders.orderedOn, from), lte(vendorOrders.orderedOn, to),
    )).groupBy(vendorOrders.vendorName, sql`to_char(${vendorOrders.orderedOn}, 'YYYY-MM')`)
      .orderBy(vendorOrders.vendorName),
  ]);
  return { rentals, orders };
}
