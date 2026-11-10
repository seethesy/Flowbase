import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  closeoutLineProblem,
  type Closeout,
  type CloseoutInput,
} from "../../shared/closeout";
import { sectionKindFor } from "../../shared/inventory";
import { can } from "../../shared/policy";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  closeoutLines,
  eventCloseouts,
  events,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryStock,
  pullListLines,
  pullLists,
  users,
} from "../db/schema";
import { ApiError, forbidden } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { advanceEventStatus, findVisibleEvent, lockVisibleEvent } from "./events";
import { recordMovement } from "./inventory-ledger";
import { listRentalRequests } from "./rental-requests";

// Post-event closeout and returns (FLOW-157).
//
// Technical decision (A2): pull-list status changes don't create stock movements,
// so stock was never taken out when an item was pulled. Closeout reconciles the
// ledger for what came back: for each stocked item it records a `pull` of the
// quantity that returned, then the `return` of it (net zero, the visible
// check-in), and a `damage_loss` for the damaged and the missing units, which
// leave stock for good. Consumables record a `consume` for what was used and
// return the leftover the same way. Items sub-rented from a vendor never held our
// stock, so they get no movements. Movements link to the event.

const num = (value: number | string | null) => (value === null ? null : Number(value));

const requireEdit = (actor: Actor) => {
  if (!can(actor, "events.write")) throw forbidden();
};

async function readLines(db: DbLike, eventId: string) {
  return db
    .select({ line: pullListLines, sub: inventoryRentalDetails.vendorId, kind: inventoryItems.kind })
    .from(pullListLines)
    .innerJoin(pullLists, eq(pullLists.id, pullListLines.pullListId))
    .leftJoin(inventoryItems, eq(inventoryItems.id, pullListLines.itemId))
    .leftJoin(inventoryRentalDetails, eq(inventoryRentalDetails.itemId, pullListLines.itemId))
    .where(
      and(eq(pullLists.eventId, eventId), isNull(pullListLines.archivedAt), isNull(pullLists.archivedAt)),
    )
    .orderBy(asc(pullListLines.group), asc(pullListLines.name), asc(pullListLines.id));
}

export async function getCloseout(db: DbLike, actor: Actor, eventId: string): Promise<Closeout> {
  const event = await findVisibleEvent(db, actor, eventId);
  const [closeout] = await db.select().from(eventCloseouts).where(eq(eventCloseouts.eventId, eventId));
  const rows = await readLines(db, eventId);
  const done = closeout
    ? await db.select().from(closeoutLines).where(eq(closeoutLines.closeoutId, closeout.id))
    : [];
  const by = new Map(done.map((row) => [row.pullLineId, row]));
  const requests = await listRentalRequests(db as unknown as Db, actor, eventId);
  const notes = new Map((closeout?.subRentals ?? []).map((row) => [row.vendorId, row.notes]));
  const closer = closeout?.createdBy
    ? (await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, closeout.createdBy)))[0]
    : undefined;
  return {
    eventId,
    closedOut: !!closeout,
    closedAt: closeout?.createdAt.toISOString() ?? null,
    closedByName: closer ? closer.name || closer.email : null,
    notes: closeout?.notes ?? "",
    lines: rows.map(({ line, kind }) => {
      const result = by.get(line.id);
      return {
        lineId: line.id,
        itemId: line.itemId,
        name: line.name,
        group: line.group,
        consumable: kind === "consumable" || line.group === "supplies",
        pulled: num(line.quantity),
        returned: result ? num(result.returned) : null,
        damaged: result ? num(result.damaged) : null,
        missing: result ? num(result.missing) : null,
        used: result ? num(result.used) : null,
        leftover: result ? num(result.leftover) : null,
      };
    }),
    subRentals: requests.map((request) => ({
      vendorId: request.vendorId,
      vendorName: request.vendorName,
      status: request.status,
      notes: notes.get(request.vendorId) ?? "",
    })),
    canClose: can(actor, "events.write") && !closeout && event.status === "preparation",
  };
}

// The section a returning item goes back to: the line's own section, otherwise the
// section holding most of it, otherwise the first section of the right kind.
async function returnSection(
  tx: DbLike,
  item: { id: string; kind: Parameters<typeof sectionKindFor>[0] },
  preferred: string | null,
) {
  if (preferred) return preferred;
  const [stocked] = await tx
    .select({ sectionId: inventoryStock.sectionId })
    .from(inventoryStock)
    .where(eq(inventoryStock.itemId, item.id))
    .orderBy(desc(inventoryStock.quantity), asc(inventoryStock.sectionId))
    .limit(1);
  if (stocked) return stocked.sectionId;
  const kind = sectionKindFor(item.kind);
  const [section] = kind
    ? await tx
        .select({ id: inventorySections.id })
        .from(inventorySections)
        .where(and(eq(inventorySections.kind, kind), isNull(inventorySections.archivedAt)))
        .orderBy(asc(inventorySections.sortOrder), asc(inventorySections.id))
        .limit(1)
    : [];
  if (!section)
    throw new ApiError(409, "NO_SECTION", "Add a storage section before closing out this event.");
  return section.id;
}

// Closes the event out: checks items back in, records consumables, marks
// sub-rentals returned, stores the closeout, finishes the event and emits
// `event.completed`. All or nothing.
export async function closeOutEvent(
  db: Db,
  actor: Actor,
  eventId: string,
  input: CloseoutInput & { lines: NonNullable<CloseoutInput["lines"]> },
): Promise<Closeout> {
  requireEdit(actor);
  await db.transaction(async (tx) => {
    const event = await lockVisibleEvent(tx, actor, eventId);
    const [existing] = await tx.select({ id: eventCloseouts.id }).from(eventCloseouts).where(eq(eventCloseouts.eventId, eventId));
    if (existing) throw new ApiError(409, "ALREADY_CLOSED_OUT", "This event is already closed out.");
    if (event.status !== "preparation")
      throw new ApiError(409, "NOT_READY", "Only an event in Preparation can be closed out.");

    const rows = await readLines(tx, eventId);
    const given = new Map<string, (typeof input.lines)[number]>();
    for (const line of input.lines) {
      if (given.has(line.lineId))
        throw new ApiError(400, "INVALID_REQUEST", "A line appears twice.");
      given.set(line.lineId, line);
    }
    for (const lineId of given.keys())
      if (!rows.some(({ line }) => line.id === lineId))
        throw new ApiError(400, "INVALID_REQUEST", "A line isn't on this event's pull list.");
    for (const { line } of rows)
      if (!given.has(line.id))
        throw new ApiError(409, "LINES_OPEN", `Enter what came back of ${line.name || "every line"}.`);

    // Sub-rentals still out must be marked returned now.
    const requests = await listRentalRequests(tx as unknown as Db, actor, eventId);
    const returnedNow = new Map((input.subRentals ?? []).map((row) => [row.vendorId, row.notes ?? ""]));
    for (const vendorId of returnedNow.keys())
      if (!requests.some((request) => request.vendorId === vendorId))
        throw new ApiError(400, "INVALID_REQUEST", "That vendor has no sub-rental on this event.");
    const open = requests.filter((request) => request.status !== "returned" && !returnedNow.has(request.vendorId));
    if (open.length)
      throw new ApiError(
        409,
        "SUB_RENTALS_OPEN",
        `Mark the sub-rented items returned to ${open.map((request) => request.vendorName).join(", ")}.`,
      );

    const [closeout] = await tx
      .insert(eventCloseouts)
      .values({
        eventId,
        notes: input.notes ?? "",
        subRentals: [...returnedNow].map(([vendorId, notes]) => ({ vendorId, notes })),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();

    const link = { type: "event" as const, id: eventId };
    for (const { line, sub, kind } of rows) {
      const entry = given.get(line.id)!;
      const consumable = kind === "consumable" || line.group === "supplies";
      const c = {
        returned: entry.returned ?? 0,
        damaged: entry.damaged ?? 0,
        missing: entry.missing ?? 0,
        used: entry.used ?? 0,
      };
      const problem = closeoutLineProblem({ consumable, pulled: line.quantity === null ? null : Number(line.quantity), name: line.name }, c);
      if (problem) throw new ApiError(400, "INVALID_REQUEST", problem);
      const pulled = Number(line.quantity);
      const leftover = consumable ? pulled - c.used : 0;
      // Counts that aren't stock: a name-only line, or an item sub-rented from a vendor.
      if (line.itemId && !sub) {
        const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, line.itemId));
        if (item && !item.archivedAt) {
          const sectionId = await returnSection(tx, item, line.sectionId);
          const back = consumable ? leftover : c.returned;
          const name = line.name || item.name;
          if (back > 0) {
            await recordMovement(tx, actor, item, {
              type: "pull", changes: [{ sectionId, quantity: -back }], link,
              reason: `Closeout: pulled for ${event.title}`,
            });
            await recordMovement(tx, actor, item, {
              type: "return", changes: [{ sectionId, quantity: back }], link,
              reason: `Closeout: ${name} returned from ${event.title}`,
            });
          }
          if (c.damaged > 0)
            await recordMovement(tx, actor, item, {
              type: "damage_loss", changes: [{ sectionId, quantity: -c.damaged }], link,
              reason: `Closeout: ${name} damaged at ${event.title}`,
            });
          if (c.missing > 0)
            await recordMovement(tx, actor, item, {
              type: "damage_loss", changes: [{ sectionId, quantity: -c.missing }], link,
              reason: `Closeout: ${name} missing after ${event.title}`,
            });
          if (consumable && c.used > 0)
            await recordMovement(tx, actor, item, {
              type: "consume", changes: [{ sectionId, quantity: -c.used }], link,
              reason: `Closeout: ${name} used at ${event.title}`,
            });
        }
      }
      await tx.insert(closeoutLines).values({
        closeoutId: closeout.id,
        pullLineId: line.id,
        itemId: line.itemId,
        name: line.name,
        pulled,
        returned: consumable ? 0 : c.returned,
        damaged: consumable ? 0 : c.damaged,
        missing: consumable ? 0 : c.missing,
        used: consumable ? c.used : 0,
        leftover,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx
        .update(pullListLines)
        .set({ status: "returned", statusBy: actor.userId, statusAt: new Date(), updatedBy: actor.userId })
        .where(eq(pullListLines.id, line.id));
    }

    // Vendor returns: the request's status moves to returned.
    if (returnedNow.size) {
      const before = event.rentalRequests;
      const after = requests
        .filter((request) => returnedNow.has(request.vendorId) || before.some((row) => row.vendorId === request.vendorId))
        .map((request) => ({
          vendorId: request.vendorId,
          status: returnedNow.has(request.vendorId) ? ("returned" as const) : request.status,
          method: request.method,
          details: request.details,
        }));
      await tx.update(events).set({ rentalRequests: after, updatedBy: actor.userId }).where(eq(events.id, eventId));
      await writeAudit(tx, actor, {
        entityType: "event", entityId: eventId, action: "update",
        before: { rentalRequests: before }, after: { rentalRequests: after },
      });
    }

    await advanceEventStatus(tx, eventId, "finished", "Closed out");
    await emitDomainEvent(tx, { name: "event.completed", entityId: eventId });
  });
  return getCloseout(db, actor, eventId);
}

