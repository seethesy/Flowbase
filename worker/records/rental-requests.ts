import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { can } from "../../shared/policy";
import { groupRentalRequests, type RentalRequest, type RentalRequestSettings } from "../../shared/rental-requests";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db } from "../db/client";
import { events, inventoryItems, inventoryRentalDetails, reservations, vendors } from "../db/schema";
import { ApiError } from "../hono";
import { findVisibleEvent, lockVisibleEvent } from "./events";

// Current vendor holds determine the lines. A conflict resolved by sub-renting
// moves its short quantity onto a vendor item, so it appears here automatically.
export async function listRentalRequests(db: Db, actor: Actor, eventId: string): Promise<RentalRequest[]> {
  await findVisibleEvent(db, actor, eventId);
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const holds = await db.select({
    itemId: inventoryItems.id,
    name: inventoryItems.name,
    vendorId: vendors.id,
    vendorName: vendors.name,
    quantity: reservations.quantity,
    from: reservations.windowStart,
    through: reservations.windowEnd,
  }).from(reservations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, reservations.itemId))
    .innerJoin(inventoryRentalDetails, eq(inventoryRentalDetails.itemId, inventoryItems.id))
    .innerJoin(vendors, eq(vendors.id, inventoryRentalDetails.vendorId))
    .where(and(eq(reservations.eventId, eventId), isNull(reservations.archivedAt)));
  const groups = groupRentalRequests(holds);
  const settings = new Map(event.rentalRequests.map((row) => [row.vendorId, row]));
  return groups.map((group) => {
    const saved = settings.get(group.vendorId);
    return {
      ...group,
      eventTitle: event.title,
      eventDate: utcToBusinessTime(event.startsAt).date,
      status: saved?.status ?? "draft",
      method: saved?.method ?? "delivery",
      details: saved?.details ?? event.address,
    };
  });
}

export async function updateRentalRequest(
  db: Db, actor: Actor, eventId: string, vendorId: string,
  input: Omit<RentalRequestSettings, "vendorId">,
) {
  if (!can(actor, "events.write")) throw new ApiError(403, "FORBIDDEN", "You don't have access to this.");
  const requests = await listRentalRequests(db, actor, eventId);
  if (!requests.some((request) => request.vendorId === vendorId))
    throw new ApiError(404, "NOT_FOUND", "Rental request not found.");
  await db.transaction(async (tx) => {
    const event = await lockVisibleEvent(tx, actor, eventId);
    const before = event.rentalRequests;
    const after = [...before.filter((row) => row.vendorId !== vendorId), { vendorId, ...input }];
    await tx.update(events).set({ rentalRequests: after }).where(eq(events.id, eventId));
    await writeAudit(tx, actor, {
      entityType: "event", entityId: eventId, action: "update",
      before: { rentalRequests: before }, after: { rentalRequests: after },
    });
  });
  return listRentalRequests(db, actor, eventId);
}
