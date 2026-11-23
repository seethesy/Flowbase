import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  deletePermission,
  type BulkDelete,
  type DeletableEntity,
  type DeleteResult,
  type DeletedRecord,
} from "../../shared/deletions";
import { can } from "../policy";
import type { Db, DbLike } from "../db/client";
import {
  beos,
  contracts,
  deletions,
  events,
  reservations,
  users,
  vendorOrders,
} from "../db/schema";
import { ApiError, forbidden } from "../hono";
import { beoDeleteBlocked, beoDeleteName, setBeoArchived } from "./beo";
import { getClient, setClientArchived } from "./clients";
import { getEvent, setEventArchived } from "./events";
import { findItem, getItem, setItemArchived } from "./inventory-items";
import { findVisibleLead, setLeadArchived } from "./leads";
import { orderListDeleteBlocked, orderListDeleteName, setOrderListArchived } from "./order-lists";
import { getRecipe, recipeDeleteBlocked, setRecipeArchived } from "./recipes";
import { findSop, setSopArchived } from "./sops";
import { setStaffArchived, staffDeleteBlocked, staffDeleteName } from "./staff";
import { getVendor, setVendorArchived } from "./vendors";
import { getVenue, setVenueArchived } from "./venues";

// Bulk delete with Undo (FLOW-260, A1). Deleting runs each record's own archive
// (its visibility, locking, audit and domain events) and opens a deletions row
// that hides it from the Show archived lists. A record with linked data is
// skipped with the reason. Restore re-runs the record's restore and closes the
// row: the person who deleted it can (Undo), and an Admin can (Settings ›
// Archived).

type Entity = {
  // The record's label, read through its visibility rules (404 if hidden).
  name: (db: Db, actor: Actor, id: string) => Promise<string>;
  // Why the record can't be deleted, or null.
  blocked?: (db: DbLike, actor: Actor, id: string) => Promise<string | null>;
  archive: (db: Db, actor: Actor, id: string, archived: boolean) => Promise<unknown>;
};

const exists = async (db: DbLike, query: SQL) => {
  const rows = (await db.execute(sql`select exists (${query}) as found`)) as unknown as { found: boolean }[];
  return Boolean(rows[0]?.found);
};

const entities: Record<DeletableEntity, Entity> = {
  lead: {
    name: async (db, actor, id) => (await findVisibleLead(db, actor, id)).name || "Unnamed lead",
    blocked: async (db, actor, id) => {
      const lead = await findVisibleLead(db, actor, id);
      return lead.status === "closing" || lead.status === "closed" ? "already has a client record" : null;
    },
    archive: setLeadArchived,
  },
  client: {
    name: async (db, actor, id) => (await getClient(db, actor, id)).name,
    blocked: async (db, _actor, id) =>
      (await exists(db, sql`select 1 from ${events} where ${events.clientId} = ${id} and ${events.archivedAt} is null`))
        ? "has events"
        : null,
    archive: setClientArchived,
  },
  venue: {
    name: async (db, actor, id) => (await getVenue(db, actor, id)).name,
    blocked: async (db, _actor, id) =>
      (await exists(db, sql`select 1 from ${events} where ${events.venueId} = ${id} and ${events.archivedAt} is null`))
        ? "is used by events"
        : null,
    archive: setVenueArchived,
  },
  event: {
    name: async (db, actor, id) => (await getEvent(db, actor, id)).title,
    blocked: async (db, _actor, id) => {
      if (await exists(db, sql`select 1 from ${contracts} where ${contracts.eventId} = ${id} and ${contracts.archivedAt} is null`))
        return "has a signed contract";
      if (await exists(db, sql`select 1 from ${beos} where ${beos.eventId} = ${id} and ${beos.status} = 'approved' and ${beos.archivedAt} is null`))
        return "has an approved BEO";
      return null;
    },
    archive: setEventArchived,
  },
  vendor: {
    name: async (db, actor, id) => (await getVendor(db, actor, id)).name,
    blocked: async (db, _actor, id) =>
      (await exists(
        db,
        sql`select 1 from ${vendorOrders} where ${vendorOrders.vendorId} = ${id} and ${vendorOrders.status} in ('ordered', 'partially_received') and ${vendorOrders.archivedAt} is null`,
      ))
        ? "has open orders"
        : null,
    archive: setVendorArchived,
  },
  inventory_item: {
    name: async (db, actor, id) => (await getItem(db, actor, id)).name,
    blocked: async (db, actor, id) => {
      if (await exists(db, sql`select 1 from ${reservations} where ${reservations.itemId} = ${id} and ${reservations.archivedAt} is null`))
        return "is reserved for events";
      // Master inventory archives go through approval (as the item's own Archive does).
      const item = await findItem(db, id);
      if (item.kind !== "consumable" && !can(actor, "rentals.apply_directly"))
        return "needs approval to archive Master inventory";
      return null;
    },
    archive: (db, actor, id, archived) => setItemArchived(db, actor, id, archived),
  },
  recipe: {
    name: async (db, actor, id) => (await getRecipe(db, actor, id)).name,
    // FLOW-301: recipes on upcoming event menus are skipped.
    blocked: recipeDeleteBlocked,
    archive: setRecipeArchived,
  },
  // The staff directory (FLOW-270): your own account and people on upcoming
  // shifts are skipped.
  staff_member: {
    name: staffDeleteName,
    blocked: staffDeleteBlocked,
    archive: setStaffArchived,
  },
  sop: {
    name: async (db, _actor, id) => (await findSop(db, id)).title,
    archive: setSopArchived,
  },
  // The BEOs tab (FLOW-288). The id is the BEO's; the event must be visible.
  beo: {
    name: beoDeleteName,
    blocked: beoDeleteBlocked,
    archive: setBeoArchived,
  },
  // The Purchasing tab (FLOW-300): lists past Draft, Rejected or Cancelled are skipped.
  order_list: {
    name: orderListDeleteName,
    blocked: orderListDeleteBlocked,
    archive: setOrderListArchived,
  },
};

const reasonOf = (error: unknown) => {
  if (error instanceof ApiError) return error.status === 404 ? "was not found" : error.message;
  return error instanceof Error ? error.message : String(error);
};

export async function deleteRecords(db: Db, actor: Actor, input: BulkDelete): Promise<DeleteResult> {
  if (!can(actor, deletePermission[input.entityType])) throw forbidden();
  const entity = entities[input.entityType];
  const result: DeleteResult = { deleted: [], skipped: [] };
  for (const id of [...new Set(input.ids)]) {
    let name = "";
    try {
      name = await entity.name(db, actor, id);
      const reason = await entity.blocked?.(db, actor, id);
      if (reason) {
        result.skipped.push({ id, name, reason });
        continue;
      }
      await entity.archive(db, actor, id, true);
      await db.insert(deletions).values({
        entityType: input.entityType,
        entityId: id,
        name,
        deletedBy: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      result.deleted.push(id);
    } catch (error) {
      result.skipped.push({ id, name, reason: reasonOf(error) });
    }
  }
  return result;
}

const isAdmin = (actor: Actor) => can(actor, "settings.manage");

export async function restoreRecords(db: Db, actor: Actor, input: BulkDelete): Promise<{ restored: string[] }> {
  if (!can(actor, deletePermission[input.entityType])) throw forbidden();
  const entity = entities[input.entityType];
  const open = await db
    .select()
    .from(deletions)
    .where(
      and(
        eq(deletions.entityType, input.entityType),
        inArray(deletions.entityId, input.ids),
        isNull(deletions.restoredAt),
      ),
    );
  // Undo is for the person who deleted it; after that, Admins restore.
  if (!isAdmin(actor) && open.some((row) => row.deletedBy !== actor.userId)) throw forbidden();
  const restored: string[] = [];
  for (const row of open) {
    await entity.archive(db, actor, row.entityId, false);
    await db
      .update(deletions)
      .set({ restoredAt: new Date(), restoredBy: actor.userId, updatedBy: actor.userId })
      .where(eq(deletions.id, row.id));
    restored.push(row.entityId);
  }
  return { restored };
}

// Settings › Archived: every deleted record not yet restored, newest first.
export async function listDeleted(db: DbLike, actor: Actor): Promise<DeletedRecord[]> {
  if (!isAdmin(actor)) throw forbidden();
  const rows = await db
    .select({
      id: deletions.id,
      entityType: deletions.entityType,
      entityId: deletions.entityId,
      name: deletions.name,
      deletedAt: deletions.deletedAt,
      deletedBy: deletions.deletedBy,
      deleterName: users.name,
    })
    .from(deletions)
    .leftJoin(users, eq(users.id, deletions.deletedBy))
    .where(isNull(deletions.restoredAt))
    .orderBy(desc(deletions.deletedAt), desc(deletions.id))
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    name: row.name,
    deletedAt: row.deletedAt.toISOString(),
    deletedBy: row.deletedBy ? { id: row.deletedBy, name: row.deleterName ?? "" } : null,
  }));
}
