import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Db } from "../db/client";
import { inventoryCategories, allInventoryItems, inventoryTypes } from "../db/schema";
import { ApiError, notFound } from "../hono";

const duplicate = (name: string) => new ApiError(409, "DUPLICATE_NAME", `${name} already exists.`);
const inUse = () => new ApiError(409, "IN_USE", "Move items first, then archive this entry.");

export async function listInventoryCategories(db: Db) {
  const [categories, types] = await Promise.all([
    db.select().from(inventoryCategories).where(isNull(inventoryCategories.archivedAt))
      .orderBy(asc(inventoryCategories.sortOrder), asc(inventoryCategories.name)),
    db.select().from(inventoryTypes).where(isNull(inventoryTypes.archivedAt))
      .orderBy(asc(inventoryTypes.sortOrder), asc(inventoryTypes.name)),
  ]);
  return { categories: categories.map((row) => ({ id: row.id, kind: row.kind, name: row.name, sortOrder: row.sortOrder, archivedAt: null })),
    types: types.map((row) => ({ id: row.id, categoryId: row.categoryId, name: row.name, sortOrder: row.sortOrder, archivedAt: null })) };
}

export async function createInventoryCategory(db: Db, actor: Actor, kind: string, name: string) {
  return db.transaction(async (tx) => {
    const [old] = await tx.select({ id: inventoryCategories.id }).from(inventoryCategories)
      .where(and(eq(inventoryCategories.kind, kind), ilike(inventoryCategories.name, name), isNull(inventoryCategories.archivedAt)));
    if (old) throw duplicate(name);
    const [last] = await tx.select({ sortOrder: inventoryCategories.sortOrder }).from(inventoryCategories)
      .where(and(eq(inventoryCategories.kind, kind), isNull(inventoryCategories.archivedAt)))
      .orderBy(desc(inventoryCategories.sortOrder)).limit(1);
    const [row] = await tx.insert(inventoryCategories).values({ kind, name, sortOrder: (last?.sortOrder ?? -1) + 1,
      createdBy: actor.userId, updatedBy: actor.userId }).returning();
    return { id: row.id, kind: row.kind, name: row.name, sortOrder: row.sortOrder, archivedAt: null };
  });
}

export async function updateInventoryCategory(db: Db, actor: Actor, id: string, change: { name?: string; sortOrder?: number; archived?: boolean }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(inventoryCategories).where(and(eq(inventoryCategories.id, id), isNull(inventoryCategories.archivedAt))).for("update");
    if (!row) throw notFound("Category");
    if (change.archived) {
      const [used] = await tx.select({ id: allInventoryItems.id }).from(allInventoryItems).where(eq(allInventoryItems.categoryId, id)).limit(1);
      if (used) throw inUse();
      await tx.update(inventoryTypes).set({ archivedAt: new Date(), updatedBy: actor.userId })
        .where(and(eq(inventoryTypes.categoryId, id), isNull(inventoryTypes.archivedAt)));
    }
    if (change.name && change.name !== row.name) {
      const [old] = await tx.select({ id: inventoryCategories.id }).from(inventoryCategories)
        .where(and(eq(inventoryCategories.kind, row.kind), ilike(inventoryCategories.name, change.name), isNull(inventoryCategories.archivedAt))).limit(1);
      if (old) throw duplicate(change.name);
    }
    if (change.sortOrder !== undefined && change.sortOrder !== row.sortOrder) {
      await tx.update(inventoryCategories).set({ sortOrder: row.sortOrder, updatedBy: actor.userId })
        .where(and(eq(inventoryCategories.kind, row.kind), eq(inventoryCategories.sortOrder, change.sortOrder), isNull(inventoryCategories.archivedAt)));
    }
    const [updated] = await tx.update(inventoryCategories).set({
      ...(change.name !== undefined && { name: change.name }),
      ...(change.sortOrder !== undefined && { sortOrder: change.sortOrder }),
      ...(change.archived && { archivedAt: new Date() }),
      updatedBy: actor.userId,
    }).where(eq(inventoryCategories.id, id)).returning();
    return { id: updated.id, kind: updated.kind, name: updated.name, sortOrder: updated.sortOrder, archivedAt: updated.archivedAt?.toISOString() ?? null };
  });
}

export async function createInventoryType(db: Db, actor: Actor, categoryId: string, name: string) {
  return db.transaction(async (tx) => {
    const [category] = await tx.select({ id: inventoryCategories.id }).from(inventoryCategories)
      .where(and(eq(inventoryCategories.id, categoryId), isNull(inventoryCategories.archivedAt)));
    if (!category) throw notFound("Category");
    const [old] = await tx.select({ id: inventoryTypes.id }).from(inventoryTypes)
      .where(and(eq(inventoryTypes.categoryId, categoryId), ilike(inventoryTypes.name, name), isNull(inventoryTypes.archivedAt))).limit(1);
    if (old) throw duplicate(name);
    const [last] = await tx.select({ sortOrder: inventoryTypes.sortOrder }).from(inventoryTypes)
      .where(and(eq(inventoryTypes.categoryId, categoryId), isNull(inventoryTypes.archivedAt)))
      .orderBy(desc(inventoryTypes.sortOrder)).limit(1);
    const [row] = await tx.insert(inventoryTypes).values({ categoryId, name, sortOrder: (last?.sortOrder ?? -1) + 1,
      createdBy: actor.userId, updatedBy: actor.userId }).returning();
    return { id: row.id, categoryId: row.categoryId, name: row.name, sortOrder: row.sortOrder, archivedAt: null };
  });
}

export async function updateInventoryType(db: Db, actor: Actor, id: string, change: { name?: string; sortOrder?: number; archived?: boolean }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(inventoryTypes).where(and(eq(inventoryTypes.id, id), isNull(inventoryTypes.archivedAt))).for("update");
    if (!row) throw notFound("Type");
    if (change.archived) {
      const [used] = await tx.select({ id: allInventoryItems.id }).from(allInventoryItems).where(eq(allInventoryItems.typeId, id)).limit(1);
      if (used) throw inUse();
    }
    if (change.name && change.name !== row.name) {
      const [old] = await tx.select({ id: inventoryTypes.id }).from(inventoryTypes)
        .where(and(eq(inventoryTypes.categoryId, row.categoryId), ilike(inventoryTypes.name, change.name), isNull(inventoryTypes.archivedAt))).limit(1);
      if (old) throw duplicate(change.name);
    }
    if (change.sortOrder !== undefined && change.sortOrder !== row.sortOrder) {
      await tx.update(inventoryTypes).set({ sortOrder: row.sortOrder, updatedBy: actor.userId })
        .where(and(eq(inventoryTypes.categoryId, row.categoryId), eq(inventoryTypes.sortOrder, change.sortOrder), isNull(inventoryTypes.archivedAt)));
    }
    const [updated] = await tx.update(inventoryTypes).set({
      ...(change.name !== undefined && { name: change.name }),
      ...(change.sortOrder !== undefined && { sortOrder: change.sortOrder }),
      ...(change.archived && { archivedAt: new Date() }),
      updatedBy: actor.userId,
    }).where(eq(inventoryTypes.id, id)).returning();
    return { id: updated.id, categoryId: updated.categoryId, name: updated.name, sortOrder: updated.sortOrder, archivedAt: updated.archivedAt?.toISOString() ?? null };
  });
}
