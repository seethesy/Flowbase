import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Section, SectionKind } from "../../shared/inventory";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { inventoryLocations, inventoryStock } from "../db/schema";
import { notFound } from "../hono";
import { setArchived } from "./archive";
import {
  conflict,
  round,
  type SectionInput,
  type SectionRow,
} from "./inventory-common";

// ---- Locations (FLOW-289; the FLOW-70 sections) ----

async function sectionTotals(db: DbLike, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db
    .select({
      sectionId: inventoryStock.sectionId,
      total: sql<string>`coalesce(sum(${inventoryStock.quantity}), 0)`,
    })
    .from(inventoryStock)
    .where(inArray(inventoryStock.sectionId, ids))
    .groupBy(inventoryStock.sectionId);
  return new Map(rows.map((row) => [row.sectionId, round(Number(row.total))]));
}

async function toSections(db: DbLike, rows: SectionRow[]): Promise<Section[]> {
  const totals = await sectionTotals(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    sortOrder: row.sortOrder,
    totalQuantity: totals.get(row.id) ?? 0,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  }));
}

export async function listSections(
  db: Db,
  filter: { archived?: boolean; kind?: SectionKind },
): Promise<Section[]> {
  const rows = await db
    .select()
    .from(inventoryLocations)
    .where(
      and(
        filter.archived
          ? isNotNull(inventoryLocations.archivedAt)
          : isNull(inventoryLocations.archivedAt),
        filter.kind ? eq(inventoryLocations.kind, filter.kind) : undefined,
      ),
    )
    .orderBy(
      asc(inventoryLocations.kind),
      asc(inventoryLocations.sortOrder),
      asc(inventoryLocations.name),
    );
  return toSections(db, rows);
}

async function findSection(db: DbLike, id: string) {
  const [row] = await db
    .select()
    .from(inventoryLocations)
    .where(eq(inventoryLocations.id, id));
  if (!row) throw notFound("Location");
  return row;
}

async function getSection(db: DbLike, id: string) {
  const [section] = await toSections(db, [await findSection(db, id)]);
  return section;
}

// The section as an audit snapshot (FLOW-185). Its stock total is left out: it
// changes only through movements.
async function sectionSnapshot(db: DbLike, id: string) {
  const row = await findSection(db, id);
  return {
    name: row.name,
    kind: row.kind,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

async function requireUniqueSectionName(
  db: DbLike,
  name: string,
  exceptId?: string,
) {
  const [clash] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        isNull(inventoryLocations.archivedAt),
        sql`lower(${inventoryLocations.name}) = lower(${name})`,
        exceptId ? sql`${inventoryLocations.id} <> ${exceptId}` : undefined,
      ),
    );
  if (clash)
    throw conflict(
      "DUPLICATE_SECTION",
      `A location named ${name} already exists.`,
    );
}

export async function createSection(
  db: Db,
  actor: Actor,
  input: SectionInput,
): Promise<Section> {
  await requireUniqueSectionName(db, input.name);
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${inventoryLocations.sortOrder}) + 1, 0)::int`,
    })
    .from(inventoryLocations)
    .where(eq(inventoryLocations.kind, input.kind));
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inventoryLocations)
      .values({
        name: input.name,
        kind: input.kind,
        sortOrder: next,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: inventoryLocations.id });
    await writeAudit(tx, actor, {
      entityType: "inventory_section",
      entityId: row.id,
      action: "create",
      before: null,
      after: await sectionSnapshot(tx, row.id),
    });
    return row.id;
  });
  return getSection(db, id);
}

export async function renameSection(
  db: Db,
  actor: Actor,
  id: string,
  name: string,
): Promise<Section> {
  await findSection(db, id);
  await requireUniqueSectionName(db, name, id);
  await db.transaction(async (tx) => {
    const before = await sectionSnapshot(tx, id);
    await tx
      .update(inventoryLocations)
      .set({ name, updatedBy: actor.userId })
      .where(eq(inventoryLocations.id, id));
    await writeAudit(tx, actor, {
      entityType: "inventory_section",
      entityId: id,
      action: "update",
      before,
      after: await sectionSnapshot(tx, id),
    });
  });
  return getSection(db, id);
}

// Admin's order for one list (FLOW-289 AC4): ids in the new order. Locations left
// out keep their place after the listed ones.
export async function reorderSections(
  db: Db,
  actor: Actor,
  kind: SectionKind,
  ids: string[],
): Promise<Section[]> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(inventoryLocations)
      .where(eq(inventoryLocations.kind, kind))
      .orderBy(asc(inventoryLocations.sortOrder), asc(inventoryLocations.name))
      .for("update");
    const known = new Set(rows.map((row) => row.id));
    if (ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length)
      throw notFound("Location");
    const order = [...ids, ...rows.map((row) => row.id).filter((id) => !ids.includes(id))];
    for (const [index, id] of order.entries()) {
      const row = rows.find((candidate) => candidate.id === id)!;
      if (row.sortOrder === index) continue;
      await tx
        .update(inventoryLocations)
        .set({ sortOrder: index, updatedBy: actor.userId })
        .where(eq(inventoryLocations.id, id));
      await writeAudit(tx, actor, {
        entityType: "inventory_section",
        entityId: id,
        action: "update",
        before: { sortOrder: row.sortOrder },
        after: { sortOrder: index },
      });
    }
  });
  return listSections(db, { kind });
}

// A location that still holds stock can't be archived (FLOW-70 AC3, FLOW-289).
export async function setSectionArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Section> {
  const section = await findSection(db, id);
  if (!archived) await requireUniqueSectionName(db, section.name, id);
  // Sections have no lifecycle events.
  await setArchived(db, actor, id, archived, {
    lock: async (tx) => {
      await tx.select({ id: inventoryLocations.id }).from(inventoryLocations)
        .where(eq(inventoryLocations.id, id)).for("update");
      if (archived) {
        const total = (await sectionTotals(tx, [id])).get(id) ?? 0;
        if (total > 0)
          throw conflict("SECTION_HAS_STOCK", `${section.name} still holds stock. Move or count it out before archiving the location.`);
      }
    },
    update: (tx, values) =>
      tx.update(inventoryLocations).set(values).where(eq(inventoryLocations.id, id)),
    audit: { entityType: "inventory_section", snapshot: sectionSnapshot },
  });
  return getSection(db, id);
}

// A live location or kitchen storage area, locked.
export async function requireLiveSection(db: DbLike, id: string) {
  const [section] = await db.select().from(inventoryLocations)
    .where(eq(inventoryLocations.id, id)).for("update");
  if (!section) throw notFound("Location");
  if (section.archivedAt)
    throw conflict("SECTION_ARCHIVED", `${section.name} is archived.`);
  return section;
}

// A live location (or kitchen storage) that can hold this kind of item.
export async function requireStockSection(db: DbLike, id: string, kind: SectionKind) {
  const [section] = await db.select().from(inventoryLocations)
    .where(eq(inventoryLocations.id, id)).for("update");
  if (!section) throw notFound("Location");
  if (section.archivedAt)
    throw conflict("SECTION_ARCHIVED", `${section.name} is archived.`);
  if (section.kind !== kind)
    throw conflict(
      "WRONG_SECTION_KIND",
      kind === "location"
        ? `${section.name} is kitchen storage; this item is kept at a location.`
        : `${section.name} is a location; kitchen ingredients are kept in kitchen storage.`,
    );
  return section;
}
