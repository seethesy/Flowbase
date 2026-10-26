import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Section, SectionKind } from "../../shared/inventory";
import type { Db, DbLike } from "../db/client";
import { inventorySections, inventoryStock } from "../db/schema";
import { notFound } from "../hono";
import { setArchived } from "./archive";
import {
  conflict,
  round,
  type SectionInput,
  type SectionRow,
} from "./inventory-common";

// ---- Sections ----

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
    .from(inventorySections)
    .where(
      and(
        filter.archived
          ? isNotNull(inventorySections.archivedAt)
          : isNull(inventorySections.archivedAt),
        filter.kind ? eq(inventorySections.kind, filter.kind) : undefined,
      ),
    )
    .orderBy(
      asc(inventorySections.kind),
      asc(inventorySections.sortOrder),
      asc(inventorySections.name),
    );
  return toSections(db, rows);
}

async function findSection(db: DbLike, id: string) {
  const [row] = await db
    .select()
    .from(inventorySections)
    .where(eq(inventorySections.id, id));
  if (!row) throw notFound("Section");
  return row;
}

async function getSection(db: DbLike, id: string) {
  const [section] = await toSections(db, [await findSection(db, id)]);
  return section;
}

async function requireUniqueSectionName(
  db: DbLike,
  name: string,
  exceptId?: string,
) {
  const [clash] = await db
    .select({ id: inventorySections.id })
    .from(inventorySections)
    .where(
      and(
        isNull(inventorySections.archivedAt),
        sql`lower(${inventorySections.name}) = lower(${name})`,
        exceptId ? sql`${inventorySections.id} <> ${exceptId}` : undefined,
      ),
    );
  if (clash)
    throw conflict(
      "DUPLICATE_SECTION",
      `A section named ${name} already exists.`,
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
      next: sql<number>`coalesce(max(${inventorySections.sortOrder}) + 1, 0)::int`,
    })
    .from(inventorySections)
    .where(eq(inventorySections.kind, input.kind));
  const [row] = await db
    .insert(inventorySections)
    .values({
      name: input.name,
      kind: input.kind,
      sortOrder: next,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: inventorySections.id });
  return getSection(db, row.id);
}

export async function renameSection(
  db: Db,
  actor: Actor,
  id: string,
  name: string,
): Promise<Section> {
  await findSection(db, id);
  await requireUniqueSectionName(db, name, id);
  await db
    .update(inventorySections)
    .set({ name, updatedBy: actor.userId })
    .where(eq(inventorySections.id, id));
  return getSection(db, id);
}

// A section that still holds stock can't be archived (FLOW-70 AC3).
export async function setSectionArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Section> {
  const section = await findSection(db, id);
  if (archived) {
    const total = (await sectionTotals(db, [id])).get(id) ?? 0;
    if (total > 0)
      throw conflict(
        "SECTION_HAS_STOCK",
        `${section.name} still holds stock. Move or count it out before archiving the section.`,
      );
  } else await requireUniqueSectionName(db, section.name, id);
  // Sections aren't audited and have no lifecycle events.
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(inventorySections).set(values).where(eq(inventorySections.id, id)),
  });
  return getSection(db, id);
}

// A live section that can hold this kind of item.
export async function requireStockSection(db: DbLike, id: string, kind: SectionKind) {
  const section = await findSection(db, id);
  if (section.archivedAt)
    throw conflict("SECTION_ARCHIVED", `${section.name} is archived.`);
  if (section.kind !== kind)
    throw conflict(
      "WRONG_SECTION_KIND",
      kind === "rental"
        ? `${section.name} is a storage section; rentals live in rental sections.`
        : `${section.name} is a rental section; consumables live in storage sections.`,
    );
  return section;
}
