import { and, eq, inArray, isNull } from "drizzle-orm";
import { isFtPlus, type Actor } from "../../shared/access";
import { inventoryChangeSchema, type InventoryChange } from "../../shared/inventory-changes";
import { itemInputSchema } from "../../shared/inventory";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { approvalRequests, inventoryItems, inventoryRentalDetails,
  inventorySections, inventoryServiceDetails, inventoryStock, users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can } from "../policy";
import { registerApprovalSubject, requestApproval } from "./approvals";
import { createItem, findItem, itemSnapshot, setItemArchived, updateItem } from "./inventory-items";
import { recordCount } from "./inventory-ledger";

const subjectType = "inventory_batch";
const keyOf = (change: InventoryChange, index: number) =>
  [index, change.type, "itemId" in change ? change.itemId : "", change.type === "field"
    ? change.field : change.type === "quantity" ? change.sectionId : ""].join("|");
const parts = (key: string) => {
  const [index, type, itemId, extra] = key.split("|");
  if (!/^\d+$/.test(index) || !["create", "replace", "field", "archive", "quantity"].includes(type))
    throw new ApiError(400, "INVALID_REQUEST", "Invalid inventory change.");
  return { type, itemId, extra };
};

const subject = {
  approverRole: "admin" as const,
  async readFields(tx: DbLike, _subjectId: string, fields: string[]) {
    const ids = [...new Set(fields.map((field) => parts(field).itemId).filter(Boolean))].sort();
    const rows = ids.length ? await tx.select().from(inventoryItems)
      .where(inArray(inventoryItems.id, ids)).orderBy(inventoryItems.id).for("update") : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (rows.length !== ids.length) return null;
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      const { type, itemId, extra } = parts(field);
      const item = byId.get(itemId);
      if (type === "create") { result[field] = null; continue; }
      if (!item) return null;
      if (type === "replace") { result[field] = item.updatedAt.toISOString(); continue; }
      if (type === "archive") result[field] = !!item.archivedAt;
      else if (type === "field" && extra === "priceCents") {
        if (item.kind === "consumable") return null;
        if (item.kind === "rental") {
          const [detail] = await tx.select({ price: inventoryRentalDetails.priceCents }).from(inventoryRentalDetails)
            .where(eq(inventoryRentalDetails.itemId, itemId));
          result[field] = detail?.price ?? null;
        } else {
          const [detail] = await tx.select({ price: inventoryServiceDetails.priceCents }).from(inventoryServiceDetails)
            .where(eq(inventoryServiceDetails.itemId, itemId));
          result[field] = detail?.price ?? null;
        }
      } else if (type === "field" && ["name", "description", "category", "group"].includes(extra))
        result[field] = item[extra as "name" | "description" | "category" | "group"];
      else if (type === "quantity") {
        const [level] = await tx.select({ quantity: inventoryStock.quantity }).from(inventoryStock)
          .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.sectionId, extra), eq(inventoryStock.color, "")));
        result[field] = level?.quantity ?? 0;
      } else return null;
    }
    return result;
  },
  async applyChange(tx: DbLike, actor: Actor, _subjectId: string, values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) {
      const { type, itemId, extra } = parts(key);
      if (type === "create") {
        const item = itemInputSchema.parse(value);
        if (item.kind === "consumable") throw new ApiError(400, "INVALID_REQUEST", "Consumables do not use Master approvals.");
        await createItem(tx as Db, actor, item);
        continue;
      }
      const item = await findItem(tx, itemId);
      if (item.kind === "consumable") throw new ApiError(400, "INVALID_REQUEST", "Consumables do not use Master approvals.");
      if (type === "replace") {
        const input = itemInputSchema.parse(value);
        await updateItem(tx as Db, actor, itemId, input);
        continue;
      }
      if (type === "quantity") {
        if (item.kind !== "rental" || typeof value !== "number") throw new ApiError(400, "INVALID_REQUEST", "Only rentals have a stock quantity.");
        await recordCount(tx, actor, item, extra, value, "Approved Master inventory adjustment");
        continue;
      }
      if (type === "archive") {
        if (typeof value !== "boolean") throw new ApiError(400, "INVALID_REQUEST", "Invalid archive change.");
        await setItemArchived(tx as Db, actor, itemId, value);
        continue;
      }
      const before = await itemSnapshot(tx, itemId);
      if (type === "field" && extra === "priceCents") {
        if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 0))
          throw new ApiError(400, "INVALID_REQUEST", "Invalid price.");
        if (item.kind === "rental")
          await tx.update(inventoryRentalDetails).set({ priceCents: value as number | null, updatedBy: actor.userId,
            updatedAt: new Date() }).where(eq(inventoryRentalDetails.itemId, itemId));
        else {
          const [service] = await tx.select({ pricedByQuote: inventoryServiceDetails.pricedByQuote })
            .from(inventoryServiceDetails).where(eq(inventoryServiceDetails.itemId, itemId));
          if (service?.pricedByQuote && value !== null)
            throw new ApiError(400, "INVALID_REQUEST", "A quoted service has no fixed price.");
          await tx.update(inventoryServiceDetails).set({ priceCents: value as number | null, updatedBy: actor.userId,
            updatedAt: new Date() }).where(eq(inventoryServiceDetails.itemId, itemId));
        }
        await tx.update(inventoryItems).set({ updatedAt: new Date(), updatedBy: actor.userId })
          .where(eq(inventoryItems.id, itemId));
      } else if (type === "field" && ["name", "description", "category", "group"].includes(extra)) {
        if (typeof value !== "string") throw new ApiError(400, "INVALID_REQUEST", "Invalid item field.");
        await tx.update(inventoryItems).set({ [extra]: value, updatedBy: actor.userId,
          updatedAt: new Date() }).where(eq(inventoryItems.id, itemId));
      } else throw new ApiError(400, "INVALID_REQUEST", "Invalid inventory change.");
      await writeAudit(tx, actor, { entityType: "inventory_item", entityId: itemId,
        action: "update",
        before, after: await itemSnapshot(tx, itemId) });
      await emitDomainEvent(tx, { name: "inventory_item.updated", entityId: itemId });
    }
  },
};
registerApprovalSubject(subjectType, subject);

export async function submitInventoryChanges(db: Db, actor: Actor, changes: InventoryChange[]) {
  if (!isFtPlus(actor)) throw forbidden();
  const direct = can(actor, "rentals.apply_directly");
  return db.transaction(async (tx) => {
    const keys = changes.map(keyOf);
    if (new Set(keys.map((key) => key.slice(key.indexOf("|") + 1))).size !== keys.length)
      throw new ApiError(400, "INVALID_REQUEST", "Edit each item field only once per batch.");
    for (const change of changes) {
      inventoryChangeSchema.parse(change);
      if (change.type === "create") {
        if (change.item.kind === "consumable") throw new ApiError(400, "INVALID_REQUEST", "Consumables do not use Master approvals.");
      } else {
        const item = await findItem(tx, change.itemId);
        if (item.kind === "consumable") throw new ApiError(400, "INVALID_REQUEST", "Consumables do not use Master approvals.");
        if (change.type === "field") {
          const price = change.field === "priceCents";
          if (price && (change.value !== null && (typeof change.value !== "number" || !Number.isInteger(change.value))))
            throw new ApiError(400, "INVALID_REQUEST", "Invalid price.");
          if (!price && (typeof change.value !== "string" ||
            (change.field === "name" && !change.value.trim())))
            throw new ApiError(400, "INVALID_REQUEST", "Invalid item field.");
        }
        if (change.type === "quantity" && item.kind !== "rental")
          throw new ApiError(400, "INVALID_REQUEST", "Only rentals have stock quantity.");
        if (change.type === "quantity") {
          const [section] = await tx.select({ kind: inventorySections.kind }).from(inventorySections)
            .where(and(eq(inventorySections.id, change.sectionId), isNull(inventorySections.archivedAt)));
          if (!section || section.kind !== "rental") throw notFound("Rental section");
        }
      }
    }
    const current = await subject.readFields(tx, "", keys);
    if (!current) throw notFound("Item");
    const proposedChange = Object.fromEntries(changes.map((change, index) => [keys[index], {
      from: current[keys[index]], to: change.type === "create" || change.type === "replace" ? change.item : change.type === "field" ? change.value
        : change.type === "archive" ? change.archived : change.quantity,
    }]));
    if (direct) {
      await subject.applyChange(tx, actor, "", Object.fromEntries(Object.entries(proposedChange).map(([key, v]) => [key, v.to])));
      return { applied: true, approvalId: null };
    }
    const approvalId = await requestApproval(tx, actor, { subjectType,
      subjectId: changes.find((change): change is Extract<InventoryChange, { itemId: string }> => "itemId" in change)?.itemId ?? crypto.randomUUID(),
      summary: `${changes.length} Master inventory change${changes.length === 1 ? "" : "s"}`,
      link: "/inventory", proposedChange });
    return { applied: false, approvalId };
  });
}

export async function pendingInventoryChanges(db: DbLike, itemIds: string[]) {
  if (!itemIds.length) return [];
  const rows = await db.select({ request: approvalRequests, requesterName: users.name })
    .from(approvalRequests).leftJoin(users, eq(users.id, approvalRequests.requesterId))
    .where(and(eq(approvalRequests.subjectType, subjectType), eq(approvalRequests.status, "pending")));
  return rows.flatMap(({ request, requesterName }) => Object.keys(request.proposedChange ?? {})
    .filter((key) => itemIds.includes(parts(key).itemId))
    .map((key) => ({ itemId: parts(key).itemId, field: parts(key).extra || parts(key).type,
      approvalId: request.id, proposedBy: requesterName ?? "", proposedAt: request.createdAt.toISOString() })));
}
