import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import { isFtPlus, type Actor } from "../../shared/access";
import {
  barCountStep,
  countDifference,
  fitsCountStep,
  movementDirection,
  sectionKindFor,
  type Allergen,
  type BarContainer,
  type CostChange,
  type InventoryItem,
  type ItemInputParsed,
  type MovementType,
  type Section,
  type SectionKind,
  type StockCount,
  type StockCountSummary,
  type StockMovement,
  type correctionInputSchema,
  type countInputSchema,
  type countLineInputSchema,
  type movementInputSchema,
  type sectionInputSchema,
  type transferInputSchema,
} from "../../shared/inventory";
import type { Unit } from "../../shared/units";
import type { Db, DbLike } from "../db/client";
import {
  events,
  inventoryBarDetails,
  inventoryConsumableDetails,
  inventoryCostHistory,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryServiceDetails,
  inventoryStock,
  stockCountLines,
  stockCounts,
  stockMovements,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { canCountItem, canMoveItem } from "../policy";

// Inventory items (FLOW-69), sections and per-section stock (FLOW-70), the
// ingredient catalog fields (FLOW-81), the stock ledger (FLOW-71), count mode
// (FLOW-82), cost history (FLOW-83) and bar stock (FLOW-90). Every signed-in user
// can read inventory; consumable costs are FT+ only (F-01-04). Stock changes only
// through recordMovement, which writes the movements and the cached quantities
// together; nothing sets a quantity directly.
type ItemRow = typeof inventoryItems.$inferSelect;
type SectionRow = typeof inventorySections.$inferSelect;
type TransferInput = z.output<typeof transferInputSchema>;
type CountInput = z.output<typeof countInputSchema>;
type CountLineInput = z.output<typeof countLineInputSchema>;
type MovementInput = z.output<typeof movementInputSchema>;
type CorrectionInput = z.output<typeof correctionInputSchema>;
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
  const [rentals, services, consumables, stock, bars] = await Promise.all([
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
    db
      .select()
      .from(inventoryBarDetails)
      .where(inArray(inventoryBarDetails.itemId, ids)),
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
    const bar = bars.find((detail) => detail.itemId === row.id);
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
            storageOrder: c.storageOrder,
          }
        : null,
      bar:
        row.kind === "consumable" && row.subtype === "bar"
          ? {
              brand: bar?.brand ?? "",
              subcategory: bar?.subcategory ?? "",
              container: (bar?.container as BarContainer | null) ?? null,
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
  tier?: string;
  // Bar stock (FLOW-90).
  subcategory?: string;
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
        filter.tier ? eq(inventoryItems.tier, filter.tier) : undefined,
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
      (!filter.belowPar || item.belowPar === true) &&
      (!filter.subcategory || item.bar?.subcategory === filter.subcategory),
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
    const [stored] = await tx
      .select({ unitCostCents: inventoryConsumableDetails.unitCostCents })
      .from(inventoryConsumableDetails)
      .where(eq(inventoryConsumableDetails.itemId, itemId));
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
      storageOrder: c.storageOrder,
      ...(c.unitCostCents !== undefined && { unitCostCents: c.unitCostCents }),
    };
    await tx
      .insert(inventoryConsumableDetails)
      .values({ itemId, ...values })
      .onConflictDoUpdate({
        target: inventoryConsumableDetails.itemId,
        set: values,
      });
    const previousCents = stored?.unitCostCents ?? null;
    if (c.unitCostCents !== undefined && c.unitCostCents !== previousCents)
      await recordCostChange(tx, actor, {
        itemId,
        previousCents,
        unitCostCents: c.unitCostCents,
        source: "manual",
      });
  }
  if (input.kind === "consumable" && input.subtype === "bar") {
    const values = {
      brand: input.bar?.brand ?? "",
      subcategory: input.bar?.subcategory ?? "",
      container: input.bar?.container ?? null,
    };
    await tx
      .insert(inventoryBarDetails)
      .values({ itemId, ...values })
      .onConflictDoUpdate({ target: inventoryBarDetails.itemId, set: values });
  }
}

// ---- Costs (FLOW-83) ----

// Logs a unit-cost change and emits inventory_item.cost_changed in the caller's
// transaction, after the new cost is stored. Recipe costing (FLOW-94) recalculates
// every recipe using the item on that event. Receiving (FLOW-88) calls this with
// source "receiving".
export async function recordCostChange(
  tx: DbLike,
  actor: Actor,
  change: {
    itemId: string;
    previousCents: number | null;
    unitCostCents: number | null;
    source: CostChange["source"];
  },
) {
  const [row] = await tx
    .insert(inventoryCostHistory)
    .values({ ...change, createdBy: actor.userId, updatedBy: actor.userId })
    .returning({ id: inventoryCostHistory.id });
  await emitDomainEvent(tx, {
    name: "inventory_item.cost_changed",
    entityId: change.itemId,
    data: {
      costChangeId: row.id,
      previousCents: change.previousCents,
      unitCostCents: change.unitCostCents,
      source: change.source,
    },
  });
}

export async function listCostHistory(
  db: Db,
  actor: Actor,
  itemId: string,
): Promise<CostChange[]> {
  if (!isFtPlus(actor)) throw forbidden();
  await findItem(db, itemId);
  const rows = await db
    .select()
    .from(inventoryCostHistory)
    .where(eq(inventoryCostHistory.itemId, itemId))
    .orderBy(desc(inventoryCostHistory.createdAt))
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    previousCents: row.previousCents,
    unitCostCents: row.unitCostCents,
    source: row.source,
    changedBy: row.createdBy,
    changedAt: row.createdAt.toISOString(),
  }));
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

// ---- Stock ledger (FLOW-71) ----

export type Movement = {
  type: MovementType;
  // One signed change per section; a transfer has two.
  changes: { sectionId: string; quantity: number }[];
  reason: string;
  correctsId?: string | null;
  link?: { type: "event" | "order" | "import"; id: string } | null;
};

// The only way stock changes: appends the movements and updates every section's
// cached on-hand in the caller's transaction, so the cache always equals the sum of
// movements. Services never have stock (FLOW-69 AC2), and no section may go below
// zero. Returns the new movement ids, in the order of the changes.
export async function recordMovement(
  tx: DbLike,
  actor: Actor,
  item: Pick<ItemRow, "id" | "kind" | "archivedAt">,
  movement: Movement,
): Promise<string[]> {
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
  const sectionIds = movement.changes.map((change) => change.sectionId);
  await tx
    .insert(inventoryStock)
    .values(sectionIds.map((sectionId) => ({ itemId: item.id, sectionId })))
    .onConflictDoNothing();
  const levels = await tx
    .select()
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, item.id),
        inArray(inventoryStock.sectionId, sectionIds),
      ),
    )
    .for("update");
  for (const [index, change] of movement.changes.entries()) {
    const level = levels.find((row) => row.sectionId === change.sectionId);
    const next = round((level?.quantity ?? 0) + change.quantity);
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
  const transferId = movement.type === "transfer" ? crypto.randomUUID() : null;
  const rows = await tx
    .insert(stockMovements)
    .values(
      movement.changes.map((change) => ({
        itemId: item.id,
        sectionId: change.sectionId,
        type: movement.type,
        quantity: round(change.quantity),
        reason: movement.reason,
        transferId,
        correctsId: movement.correctsId ?? null,
        linkType: movement.link?.type ?? null,
        linkId: movement.link?.id ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    )
    .returning({ id: stockMovements.id });
  const ids = rows.map((row) => row.id);
  await emitDomainEvent(tx, {
    name: "stock.moved",
    entityId: item.id,
    data: { movementIds: ids, type: movement.type },
  });
  return ids;
}

export async function listMovements(
  db: Db,
  itemId: string,
): Promise<StockMovement[]> {
  await findItem(db, itemId);
  const rows = await db
    .select({ movement: stockMovements, sectionName: inventorySections.name })
    .from(stockMovements)
    .innerJoin(
      inventorySections,
      eq(stockMovements.sectionId, inventorySections.id),
    )
    .where(eq(stockMovements.itemId, itemId))
    .orderBy(desc(stockMovements.createdAt), asc(stockMovements.quantity))
    .limit(1000);
  return rows.map(({ movement: m, sectionName }) => ({
    id: m.id,
    itemId: m.itemId,
    sectionId: m.sectionId,
    sectionName,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    transferId: m.transferId,
    correctsId: m.correctsId,
    correctedBy: rows
      .filter((other) => other.movement.correctsId === m.id)
      .sort(
        (a, b) =>
          a.movement.createdAt.getTime() - b.movement.createdAt.getTime(),
      )
      .map((other) => other.movement.id),
    link: m.linkType && m.linkId ? { type: m.linkType, id: m.linkId } : null,
    createdBy: m.createdBy,
    createdAt: m.createdAt.toISOString(),
  }));
}

// FLOW-70 AC2: one transfer, both sections updated.
export async function transferStock(
  db: Db,
  actor: Actor,
  itemId: string,
  input: TransferInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  if (!canMoveItem(actor, item)) throw forbidden();
  await db.transaction((tx) =>
    recordMovement(tx, actor, item, {
      type: "transfer",
      changes: [
        { sectionId: input.fromSectionId, quantity: -input.quantity },
        { sectionId: input.toSectionId, quantity: input.quantity },
      ],
      reason: input.reason,
    }),
  );
  return getItem(db, actor, itemId);
}

// Records a counted quantity as a count movement for the difference (FLOW-82 AC1:
// counting 12 where the section holds 15 writes -3). A count that matches still
// writes a zero movement, so the ledger shows when it was counted.
async function recordCount(
  tx: DbLike,
  actor: Actor,
  item: ItemRow,
  sectionId: string,
  counted: number,
  reason: string,
) {
  if (!canCountItem(actor, item)) throw forbidden();
  const step =
    item.kind === "consumable" && item.subtype === "bar"
      ? barCountStep(item.category)
      : null;
  if (!fitsCountStep(counted, step))
    throw new ApiError(
      400,
      "COUNT_STEP",
      step === 0.5
        ? "Count beer and wine to the nearest 0.5."
        : "Count liquor to the nearest 0.25.",
    );
  const [level] = await tx
    .select({ quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, item.id),
        eq(inventoryStock.sectionId, sectionId),
      ),
    )
    .for("update");
  const difference = countDifference(counted, level?.quantity ?? 0);
  const [movementId] = await recordMovement(tx, actor, item, {
    type: "count",
    changes: [{ sectionId, quantity: difference }],
    reason,
  });
  return { movementId, difference };
}

export async function countStock(
  db: Db,
  actor: Actor,
  itemId: string,
  input: CountInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  await db.transaction((tx) =>
    recordCount(tx, actor, item, input.sectionId, input.quantity, input.reason),
  );
  return getItem(db, actor, itemId);
}

// Receipts, adjustments, damage or loss, usage, pulls and returns entered by hand.
export async function addMovement(
  db: Db,
  actor: Actor,
  itemId: string,
  input: MovementInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  if (!canMoveItem(actor, item)) throw forbidden();
  if (input.eventId) {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, input.eventId));
    if (!event) throw notFound("Event");
  }
  const direction = movementDirection[input.type];
  await db.transaction((tx) =>
    recordMovement(tx, actor, item, {
      type: input.type,
      changes: [
        {
          sectionId: input.sectionId,
          quantity:
            direction === 0 ? input.quantity : direction * input.quantity,
        },
      ],
      reason: input.reason,
      link: input.eventId ? { type: "event", id: input.eventId } : null,
    }),
  );
  return getItem(db, actor, itemId);
}

// FLOW-71 AC3: a correction is a new movement of the difference, linked to the
// original, which stays untouched. Corrections always point at the original, and
// a transfer is corrected by transferring back.
export async function correctMovement(
  db: Db,
  actor: Actor,
  movementId: string,
  input: CorrectionInput,
): Promise<StockMovement[]> {
  const [original] = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.id, movementId));
  if (!original) throw notFound("Movement");
  if (original.correctsId)
    throw conflict(
      "CORRECTS_A_CORRECTION",
      "Correct the original movement instead.",
    );
  if (original.type === "transfer")
    throw conflict(
      "TRANSFER_CORRECTION",
      "A transfer can't be corrected. Transfer the stock back instead.",
    );
  const direction = movementDirection[original.type];
  if (direction * input.quantity < 0)
    throw conflict(
      "WRONG_DIRECTION",
      direction > 0
        ? "This movement adds stock; enter what it should have added."
        : "This movement removes stock; enter what it should have removed as a negative number.",
    );
  const item = await findItem(db, original.itemId);
  if (!canMoveItem(actor, item)) throw forbidden();
  await db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({
        total: sql<string>`coalesce(sum(${stockMovements.quantity}), 0)`,
      })
      .from(stockMovements)
      .where(
        or(
          eq(stockMovements.id, original.id),
          eq(stockMovements.correctsId, original.id),
        ),
      );
    const difference = round(input.quantity - Number(total));
    if (difference === 0)
      throw conflict(
        "NO_CHANGE",
        "That's already what the movement adds up to.",
      );
    await recordMovement(tx, actor, item, {
      type: original.type,
      changes: [{ sectionId: original.sectionId, quantity: difference }],
      reason: input.reason,
      correctsId: original.id,
      link:
        original.linkType && original.linkId
          ? { type: original.linkType, id: original.linkId }
          : null,
    });
  });
  return listMovements(db, original.itemId);
}

// ---- Count mode (FLOW-82) ----

type CountRow = typeof stockCounts.$inferSelect;

async function countedItems(db: DbLike, countIds: string[]) {
  if (!countIds.length) return new Map<string, number>();
  const rows = await db
    .select({
      countId: stockCountLines.countId,
      total: sql<number>`count(*)::int`,
    })
    .from(stockCountLines)
    .where(inArray(stockCountLines.countId, countIds))
    .groupBy(stockCountLines.countId);
  return new Map(rows.map((row) => [row.countId, row.total]));
}

async function toCountSummaries(
  db: DbLike,
  rows: { count: CountRow; sectionName: string }[],
): Promise<StockCountSummary[]> {
  const counted = await countedItems(
    db,
    rows.map(({ count }) => count.id),
  );
  return rows.map(({ count, sectionName }) => ({
    id: count.id,
    sectionId: count.sectionId,
    sectionName,
    status: count.status,
    countedItems: counted.get(count.id) ?? 0,
    startedBy: count.createdBy,
    startedAt: count.createdAt.toISOString(),
    completedAt: count.completedAt?.toISOString() ?? null,
  }));
}

const countQuery = (db: DbLike) =>
  db
    .select({ count: stockCounts, sectionName: inventorySections.name })
    .from(stockCounts)
    .innerJoin(
      inventorySections,
      eq(stockCounts.sectionId, inventorySections.id),
    );

export async function listCounts(
  db: Db,
  filter: { status?: CountRow["status"] },
): Promise<StockCountSummary[]> {
  const rows = await countQuery(db)
    .where(filter.status ? eq(stockCounts.status, filter.status) : undefined)
    .orderBy(desc(stockCounts.createdAt))
    .limit(200);
  return toCountSummaries(db, rows);
}

// Everything count mode shows: the section's consumables (kept there, holding
// stock there, or already counted) in storage order, with what the section holds
// and any count already saved, so a partial count resumes where it left off.
export async function getCount(
  db: DbLike,
  actor: Actor,
  id: string,
): Promise<StockCount> {
  const [row] = await countQuery(db).where(eq(stockCounts.id, id));
  if (!row) throw notFound("Count");
  const { count } = row;
  const [[summary], held, kept, lines] = await Promise.all([
    toCountSummaries(db, [row]),
    db
      .select({ itemId: inventoryStock.itemId })
      .from(inventoryStock)
      .where(
        and(
          eq(inventoryStock.sectionId, count.sectionId),
          ne(inventoryStock.quantity, 0),
        ),
      ),
    db
      .select({ itemId: inventoryConsumableDetails.itemId })
      .from(inventoryConsumableDetails)
      .where(eq(inventoryConsumableDetails.storageSectionId, count.sectionId)),
    db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, count.id)),
  ]);
  const ids = [
    ...new Set([...held, ...kept, ...lines].map((line) => line.itemId)),
  ];
  const items = ids.length
    ? await toItems(
        db,
        actor,
        await db
          .select()
          .from(inventoryItems)
          .where(
            and(
              inArray(inventoryItems.id, ids),
              eq(inventoryItems.kind, "consumable"),
              isNull(inventoryItems.archivedAt),
            ),
          ),
      )
    : [];
  const movementIds = lines.map((line) => line.movementId);
  const differences = movementIds.length
    ? await db
        .select({ id: stockMovements.id, quantity: stockMovements.quantity })
        .from(stockMovements)
        .where(inArray(stockMovements.id, movementIds))
    : [];
  const order = (item: InventoryItem) =>
    item.consumable?.storageOrder ?? Number.MAX_SAFE_INTEGER;
  return {
    ...summary,
    lines: items
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
      .map((item) => {
        const line = lines.find((other) => other.itemId === item.id);
        return {
          itemId: item.id,
          name: item.name,
          code: item.code,
          subtype: item.subtype,
          category: item.category,
          unit: item.unit,
          storageOrder: item.consumable?.storageOrder ?? null,
          parLevel: item.consumable?.parLevel ?? null,
          belowPar: item.belowPar,
          systemQuantity:
            item.stock.find((level) => level.sectionId === count.sectionId)
              ?.quantity ?? 0,
          canCount: canCountItem(actor, item),
          counted: line
            ? {
                quantity: line.quantity,
                difference:
                  differences.find((other) => other.id === line.movementId)
                    ?.quantity ?? 0,
                reason: line.reason,
                countedBy: line.updatedBy,
                countedAt: line.updatedAt.toISOString(),
              }
            : null,
        };
      }),
  };
}

// Starts a count of a storage section, or returns the one already open there so it
// can be resumed.
export async function startCount(
  db: Db,
  actor: Actor,
  sectionId: string,
): Promise<{ count: StockCount; created: boolean }> {
  await requireStockSection(db, sectionId, "consumable");
  const [open] = await db
    .select({ id: stockCounts.id })
    .from(stockCounts)
    .where(
      and(eq(stockCounts.sectionId, sectionId), eq(stockCounts.status, "open")),
    );
  if (open)
    return { count: await getCount(db, actor, open.id), created: false };
  const [row] = await db
    .insert(stockCounts)
    .values({ sectionId, createdBy: actor.userId, updatedBy: actor.userId })
    .onConflictDoNothing()
    .returning({ id: stockCounts.id });
  // Someone else started one at the same moment: resume theirs.
  if (!row) return startCount(db, actor, sectionId);
  return { count: await getCount(db, actor, row.id), created: true };
}

async function findOpenCount(db: DbLike, id: string) {
  const [count] = await db
    .select()
    .from(stockCounts)
    .where(eq(stockCounts.id, id));
  if (!count) throw notFound("Count");
  if (count.status !== "open")
    throw conflict("COUNT_COMPLETED", "This count is already complete.");
  return count;
}

// Saves one item's counted quantity: a count movement for the difference, and the
// count's line for the item (a recount replaces the line and writes another
// movement).
export async function recordCountLine(
  db: Db,
  actor: Actor,
  countId: string,
  input: CountLineInput,
): Promise<StockCount> {
  const count = await findOpenCount(db, countId);
  const item = await findItem(db, input.itemId);
  if (item.kind !== "consumable")
    throw conflict(
      "NOT_CONSUMABLE",
      "Count mode is for consumables. Count rentals from the item page.",
    );
  await db.transaction(async (tx) => {
    const { movementId } = await recordCount(
      tx,
      actor,
      item,
      count.sectionId,
      input.quantity,
      input.reason,
    );
    const values = {
      quantity: round(input.quantity),
      reason: input.reason,
      movementId,
      updatedBy: actor.userId,
    };
    await tx
      .insert(stockCountLines)
      .values({ countId, itemId: item.id, createdBy: actor.userId, ...values })
      .onConflictDoUpdate({
        target: [stockCountLines.countId, stockCountLines.itemId],
        set: { ...values, updatedAt: new Date() },
      });
  });
  return getCount(db, actor, countId);
}

export async function completeCount(
  db: Db,
  actor: Actor,
  countId: string,
): Promise<StockCount> {
  await findOpenCount(db, countId);
  await db
    .update(stockCounts)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(eq(stockCounts.id, countId));
  return getCount(db, actor, countId);
}
