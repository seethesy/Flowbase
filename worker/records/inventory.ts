import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import { isFtPlus, type Actor } from "../../shared/access";
import {
  sectionKindFor,
  type Allergen,
  type InventoryItem,
  type ItemInputParsed,
  type Section,
  type SectionKind,
  type countInputSchema,
  type sectionInputSchema,
  type transferInputSchema,
} from "../../shared/inventory";
import type { Unit } from "../../shared/units";
import type { Db, DbLike } from "../db/client";
import {
  inventoryConsumableDetails,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryServiceDetails,
  inventoryStock,
  stockMovements,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";

// Inventory items (FLOW-69), sections and per-section stock (FLOW-70) and the
// ingredient catalog fields (FLOW-81). Every signed-in user can read inventory;
// ingredient costs are FT+ only (F-01-04). Stock changes only through
// recordMovement, which writes the movement and the new quantities together.
type ItemRow = typeof inventoryItems.$inferSelect;
type SectionRow = typeof inventorySections.$inferSelect;
type TransferInput = z.output<typeof transferInputSchema>;
type CountInput = z.output<typeof countInputSchema>;
type SectionInput = z.output<typeof sectionInputSchema>;

// Four decimal places, as stored; keeps 0.1 + 0.2 from drifting.
const round = (value: number) => Math.round(value * 10_000) / 10_000;

const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);

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
  await db
    .update(inventorySections)
    .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId })
    .where(eq(inventorySections.id, id));
  return getSection(db, id);
}

// A live section that can hold this kind of item.
async function requireStockSection(db: DbLike, id: string, kind: SectionKind) {
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

// ---- Items ----

async function toItems(
  db: DbLike,
  actor: Actor,
  rows: ItemRow[],
): Promise<InventoryItem[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [rentals, services, consumables, stock] = await Promise.all([
    db
      .select()
      .from(inventoryRentalDetails)
      .where(inArray(inventoryRentalDetails.itemId, ids)),
    db
      .select()
      .from(inventoryServiceDetails)
      .where(inArray(inventoryServiceDetails.itemId, ids)),
    db
      .select({
        details: inventoryConsumableDetails,
        storageSectionName: inventorySections.name,
      })
      .from(inventoryConsumableDetails)
      .leftJoin(
        inventorySections,
        eq(inventoryConsumableDetails.storageSectionId, inventorySections.id),
      )
      .where(inArray(inventoryConsumableDetails.itemId, ids)),
    db
      .select({
        itemId: inventoryStock.itemId,
        sectionId: inventoryStock.sectionId,
        sectionName: inventorySections.name,
        quantity: inventoryStock.quantity,
      })
      .from(inventoryStock)
      .innerJoin(
        inventorySections,
        eq(inventoryStock.sectionId, inventorySections.id),
      )
      .where(inArray(inventoryStock.itemId, ids))
      .orderBy(asc(inventorySections.sortOrder), asc(inventorySections.name)),
  ]);
  const showCost = isFtPlus(actor);
  return rows.map((row): InventoryItem => {
    const rental = rentals.find((detail) => detail.itemId === row.id);
    const service = services.find((detail) => detail.itemId === row.id);
    const consumable = consumables.find(
      (detail) => detail.details.itemId === row.id,
    );
    const levels = stock
      .filter((level) => level.itemId === row.id && level.quantity !== 0)
      .map(({ sectionId, sectionName, quantity }) => ({
        sectionId,
        sectionName,
        quantity,
      }));
    const totalQuantity = round(
      levels.reduce((sum, level) => sum + level.quantity, 0),
    );
    const c = consumable?.details;
    const par = c?.parLevel ?? null;
    return {
      id: row.id,
      kind: row.kind,
      subtype: row.subtype,
      code: row.code,
      name: row.name,
      category: row.category,
      description: row.description,
      unit: row.unit as Unit,
      group: row.group,
      color: row.color,
      tier: row.tier,
      ratio:
        row.ratioQuantity !== null && row.ratioBasis
          ? { quantity: row.ratioQuantity, basis: row.ratioBasis }
          : null,
      active: row.active,
      rental:
        row.kind === "rental"
          ? { priceCents: rental?.priceCents ?? null }
          : null,
      service:
        row.kind === "service"
          ? {
              priceCents: service?.priceCents ?? null,
              priceBasis: service?.priceBasis ?? "per_event",
            }
          : null,
      consumable: c
        ? {
            purchaseUnit: c.purchaseUnit as Unit,
            packCount: c.packCount,
            eachSize:
              c.eachSizeQuantity !== null && c.eachSizeUnit
                ? { quantity: c.eachSizeQuantity, unit: c.eachSizeUnit as Unit }
                : null,
            recipeUnit: (c.recipeUnit as Unit | null) ?? null,
            unitCostCents: showCost ? c.unitCostCents : null,
            costHidden: !showCost,
            preferredVendor: c.preferredVendor,
            parLevel: c.parLevel,
            allergens: c.allergens as Allergen[],
            storageSectionId: c.storageSectionId,
            storageSectionName: consumable.storageSectionName,
          }
        : null,
      stock: levels,
      totalQuantity,
      belowPar: par === null ? null : totalQuantity < par,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export type ItemFilter = {
  archived?: boolean;
  kind?: InventoryItem["kind"];
  subtype?: string;
  category?: string;
  sectionId?: string;
  vendor?: string;
  belowPar?: boolean;
  search?: string;
};

export async function listItems(
  db: Db,
  actor: Actor,
  filter: ItemFilter,
): Promise<InventoryItem[]> {
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(
      and(
        filter.archived
          ? isNotNull(inventoryItems.archivedAt)
          : isNull(inventoryItems.archivedAt),
        filter.kind ? eq(inventoryItems.kind, filter.kind) : undefined,
        filter.subtype ? eq(inventoryItems.subtype, filter.subtype) : undefined,
        filter.category
          ? eq(inventoryItems.category, filter.category)
          : undefined,
        filter.search
          ? or(
              ilike(inventoryItems.name, `%${filter.search}%`),
              ilike(inventoryItems.code, `%${filter.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(inventoryItems.group), asc(inventoryItems.name))
    .limit(2000);
  const vendor = filter.vendor?.toLowerCase();
  return (await toItems(db, actor, rows)).filter(
    (item) =>
      (!filter.sectionId ||
        item.stock.some((level) => level.sectionId === filter.sectionId) ||
        item.consumable?.storageSectionId === filter.sectionId) &&
      (!vendor ||
        item.consumable?.preferredVendor.toLowerCase().includes(vendor)) &&
      (!filter.belowPar || item.belowPar === true),
  );
}

export async function findItem(db: DbLike, id: string) {
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, id));
  if (!row) throw notFound("Item");
  return row;
}

export async function getItem(db: DbLike, actor: Actor, id: string) {
  const [item] = await toItems(db, actor, [await findItem(db, id)]);
  return item;
}

async function requireUniqueCode(db: DbLike, code: string, exceptId?: string) {
  if (!code) return;
  const [clash] = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.code, code),
        isNull(inventoryItems.archivedAt),
        exceptId ? sql`${inventoryItems.id} <> ${exceptId}` : undefined,
      ),
    );
  if (clash)
    throw conflict(
      "DUPLICATE_CODE",
      `Code ${code} is already used by ${clash.name}.`,
    );
}

const itemValues = (input: ItemInputParsed, actor: Actor) => ({
  kind: input.kind,
  subtype: input.subtype,
  code: input.code,
  name: input.name,
  category: input.category,
  description: input.description,
  unit: input.unit,
  group: input.group,
  color: input.color,
  tier: input.tier,
  ratioQuantity: input.ratio?.quantity ?? null,
  ratioBasis: input.ratio?.basis ?? null,
  active: input.active,
  updatedBy: actor.userId,
});

// Writes the item's kind-specific row. A part-time user can't set a cost; an
// omitted cost keeps the stored one.
async function saveDetails(
  tx: DbLike,
  actor: Actor,
  itemId: string,
  input: ItemInputParsed,
) {
  if (input.kind === "rental") {
    const values = { priceCents: input.rental?.priceCents ?? null };
    await tx
      .insert(inventoryRentalDetails)
      .values({ itemId, ...values })
      .onConflictDoUpdate({
        target: inventoryRentalDetails.itemId,
        set: values,
      });
  }
  if (input.kind === "service") {
    const values = {
      priceCents: input.service?.priceCents ?? null,
      priceBasis: input.service?.priceBasis ?? "per_event",
    };
    await tx
      .insert(inventoryServiceDetails)
      .values({ itemId, ...values })
      .onConflictDoUpdate({
        target: inventoryServiceDetails.itemId,
        set: values,
      });
  }
  const c = input.consumable;
  if (input.kind === "consumable" && c) {
    if (c.unitCostCents !== undefined && !isFtPlus(actor)) throw forbidden();
    if (c.storageSectionId)
      await requireStockSection(tx, c.storageSectionId, "consumable");
    const values = {
      purchaseUnit: c.purchaseUnit,
      packCount: c.packCount,
      eachSizeQuantity: c.eachSize?.quantity ?? null,
      eachSizeUnit: c.eachSize?.unit ?? null,
      recipeUnit: c.recipeUnit,
      preferredVendor: c.preferredVendor,
      parLevel: c.parLevel,
      allergens: c.allergens,
      storageSectionId: c.storageSectionId,
      ...(c.unitCostCents !== undefined && { unitCostCents: c.unitCostCents }),
    };
    await tx
      .insert(inventoryConsumableDetails)
      .values({ itemId, ...values })
      .onConflictDoUpdate({
        target: inventoryConsumableDetails.itemId,
        set: values,
      });
  }
}

export async function createItem(
  db: Db,
  actor: Actor,
  input: ItemInputParsed,
): Promise<InventoryItem> {
  await requireUniqueCode(db, input.code);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inventoryItems)
      .values({ ...itemValues(input, actor), createdBy: actor.userId })
      .returning({ id: inventoryItems.id });
    await saveDetails(tx, actor, row.id, input);
    await emitDomainEvent(tx, {
      name: "inventory_item.created",
      entityId: row.id,
    });
    return row.id;
  });
  return getItem(db, actor, id);
}

export async function updateItem(
  db: Db,
  actor: Actor,
  id: string,
  input: ItemInputParsed,
): Promise<InventoryItem> {
  const current = await findItem(db, id);
  if (current.kind !== input.kind)
    throw conflict(
      "KIND_CHANGE",
      "An item's kind can't change. Archive it and create a new item instead.",
    );
  await requireUniqueCode(db, input.code, id);
  await db.transaction(async (tx) => {
    await tx
      .update(inventoryItems)
      .set(itemValues(input, actor))
      .where(eq(inventoryItems.id, id));
    await saveDetails(tx, actor, id, input);
    await emitDomainEvent(tx, { name: "inventory_item.updated", entityId: id });
  });
  return getItem(db, actor, id);
}

export async function setItemArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<InventoryItem> {
  const current = await findItem(db, id);
  if (!archived) await requireUniqueCode(db, current.code, id);
  await db.transaction(async (tx) => {
    await tx
      .update(inventoryItems)
      .set({
        archivedAt: archived ? new Date() : null,
        updatedBy: actor.userId,
      })
      .where(eq(inventoryItems.id, id));
    await emitDomainEvent(tx, {
      name: archived ? "inventory_item.archived" : "inventory_item.restored",
      entityId: id,
    });
  });
  return getItem(db, actor, id);
}

// ---- Stock ----

type Movement = {
  type: "transfer" | "adjustment";
  // Per-section changes; a transfer has two, an adjustment one.
  changes: { sectionId: string; delta: number }[];
  quantity: number;
  fromSectionId: string | null;
  toSectionId: string | null;
  note: string;
};

// The only way stock changes: writes the movement and every section's new
// quantity in the caller's transaction. Services never have stock (FLOW-69 AC2),
// and no section may go below zero.
export async function recordMovement(
  tx: DbLike,
  actor: Actor,
  item: Pick<ItemRow, "id" | "kind" | "archivedAt">,
  movement: Movement,
) {
  const sectionKind = sectionKindFor(item.kind);
  if (!sectionKind)
    throw conflict(
      "SERVICE_HAS_NO_STOCK",
      "Service items don't have stock, so they can't be moved or counted.",
    );
  if (item.archivedAt)
    throw conflict(
      "ITEM_ARCHIVED",
      "Restore the item before changing its stock.",
    );
  const sections = await Promise.all(
    movement.changes.map((change) =>
      requireStockSection(tx, change.sectionId, sectionKind),
    ),
  );
  await tx
    .insert(inventoryStock)
    .values(
      movement.changes.map((change) => ({
        itemId: item.id,
        sectionId: change.sectionId,
      })),
    )
    .onConflictDoNothing();
  const levels = await tx
    .select()
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, item.id),
        inArray(
          inventoryStock.sectionId,
          movement.changes.map((change) => change.sectionId),
        ),
      ),
    )
    .for("update");
  for (const [index, change] of movement.changes.entries()) {
    const level = levels.find((row) => row.sectionId === change.sectionId);
    const next = round((level?.quantity ?? 0) + change.delta);
    if (next < 0)
      throw conflict(
        "INSUFFICIENT_STOCK",
        `${sections[index].name} only has ${level?.quantity ?? 0}.`,
      );
    await tx
      .update(inventoryStock)
      .set({ quantity: next, updatedBy: actor.userId })
      .where(
        and(
          eq(inventoryStock.itemId, item.id),
          eq(inventoryStock.sectionId, change.sectionId),
        ),
      );
  }
  const [row] = await tx
    .insert(stockMovements)
    .values({
      itemId: item.id,
      type: movement.type,
      quantity: round(movement.quantity),
      fromSectionId: movement.fromSectionId,
      toSectionId: movement.toSectionId,
      note: movement.note,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: stockMovements.id });
  await emitDomainEvent(tx, {
    name: movement.type === "transfer" ? "stock.transferred" : "stock.adjusted",
    entityId: item.id,
    data: { movementId: row.id },
  });
}

// FLOW-70 AC2: one transfer movement, both sections updated.
export async function transferStock(
  db: Db,
  actor: Actor,
  itemId: string,
  input: TransferInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  await db.transaction((tx) =>
    recordMovement(tx, actor, item, {
      type: "transfer",
      changes: [
        { sectionId: input.fromSectionId, delta: -input.quantity },
        { sectionId: input.toSectionId, delta: input.quantity },
      ],
      quantity: input.quantity,
      fromSectionId: input.fromSectionId,
      toSectionId: input.toSectionId,
      note: input.note,
    }),
  );
  return getItem(db, actor, itemId);
}

// Sets a section's counted quantity; the difference is an adjustment movement.
export async function countStock(
  db: Db,
  actor: Actor,
  itemId: string,
  input: CountInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  await db.transaction(async (tx) => {
    const [level] = await tx
      .select({ quantity: inventoryStock.quantity })
      .from(inventoryStock)
      .where(
        and(
          eq(inventoryStock.itemId, itemId),
          eq(inventoryStock.sectionId, input.sectionId),
        ),
      )
      .for("update");
    const delta = round(input.quantity - (level?.quantity ?? 0));
    await recordMovement(tx, actor, item, {
      type: "adjustment",
      changes: [{ sectionId: input.sectionId, delta }],
      quantity: delta,
      fromSectionId: null,
      toSectionId: input.sectionId,
      note: input.note,
    });
  });
  return getItem(db, actor, itemId);
}
