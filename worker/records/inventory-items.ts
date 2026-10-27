import { canSeeField, serializeFields } from "../../shared/visibility";
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
import type { Actor } from "../../shared/access";
import type {
  Allergen,
  BarContainer,
  InventoryItem,
  ItemInputParsed,
} from "../../shared/inventory";
import type { Unit } from "../../shared/units";
import type { Db, DbLike } from "../db/client";
import {
  inventoryBarDetails,
  inventoryConsumableDetails,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryServiceDetails,
  inventoryStock,
} from "../db/schema";
import { forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { setArchived } from "./archive";
import { conflict, type ItemRow, round } from "./inventory-common";
import { recordCostChange } from "./inventory-costs";
import { requireStockSection } from "./inventory-sections";
import {
  groupBy,
  indexBy,
  keyset,
  type Page,
  type PageRequest,
} from "./paging";

// ---- Items ----

export async function toItems(
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
  const rentalById = indexBy(rentals, (detail) => detail.itemId);
  const serviceById = indexBy(services, (detail) => detail.itemId);
  const consumableById = indexBy(consumables, (detail) => detail.details.itemId);
  const barById = indexBy(bars, (detail) => detail.itemId);
  const stockByItem = groupBy(stock, (level) => level.itemId);
  return rows.map((row): InventoryItem => {
    const rental = rentalById.get(row.id);
    const service = serviceById.get(row.id);
    const consumable = consumableById.get(row.id);
    const levels = (stockByItem.get(row.id) ?? [])
      .filter((level) => level.quantity !== 0)
      .map(({ sectionId, sectionName, quantity }) => ({
        sectionId,
        sectionName,
        quantity,
      }));
    const totalQuantity = round(
      levels.reduce((sum, level) => sum + level.quantity, 0),
    );
    const c = consumable?.details;
    const bar = barById.get(row.id);
    const par = c?.parLevel ?? null;
    return serializeFields<InventoryItem>(actor, "inventory_item", {
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
            unitCostCents: c.unitCostCents,
            costHidden: false,
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
    });
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
  page: PageRequest = {},
): Promise<Page<InventoryItem>> {
  const paging = keyset<ItemRow>(
    [
      { column: inventoryItems.group, type: "text", of: (row) => row.group },
      { column: inventoryItems.name, type: "text", of: (row) => row.name },
      { column: inventoryItems.id, type: "uuid", of: (row) => row.id },
    ],
    page,
  );
  // Every filter runs in SQL (FLOW-180), so a page is exactly the next matching
  // rows. Each mirrors what the item shows: a section filter matches stock held
  // there or the storage section, below par compares total stock with par.
  const term = filter.search ? `%${filter.search}%` : undefined;
  const item = inventoryItems.id;
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
        term
          ? or(
              ilike(inventoryItems.name, term),
              ilike(inventoryItems.code, term),
              ilike(inventoryItems.group, term),
              sql`exists (select 1 from ${inventoryBarDetails} where ${inventoryBarDetails.itemId} = ${item} and ${inventoryBarDetails.brand} ilike ${term})`,
            )
          : undefined,
        filter.sectionId
          ? or(
              sql`exists (select 1 from ${inventoryStock} where ${inventoryStock.itemId} = ${item} and ${inventoryStock.sectionId} = ${filter.sectionId} and ${inventoryStock.quantity} <> 0)`,
              sql`exists (select 1 from ${inventoryConsumableDetails} where ${inventoryConsumableDetails.itemId} = ${item} and ${inventoryConsumableDetails.storageSectionId} = ${filter.sectionId})`,
            )
          : undefined,
        filter.vendor
          ? sql`exists (select 1 from ${inventoryConsumableDetails} where ${inventoryConsumableDetails.itemId} = ${item} and ${inventoryConsumableDetails.preferredVendor} ilike ${`%${filter.vendor}%`})`
          : undefined,
        filter.belowPar
          ? sql`exists (select 1 from ${inventoryConsumableDetails} where ${inventoryConsumableDetails.itemId} = ${item} and ${inventoryConsumableDetails.parLevel} is not null and coalesce((select sum(${inventoryStock.quantity}) from ${inventoryStock} where ${inventoryStock.itemId} = ${item}), 0) < ${inventoryConsumableDetails.parLevel})`
          : undefined,
        filter.subcategory
          ? and(
              eq(inventoryItems.kind, "consumable"),
              eq(inventoryItems.subtype, "bar"),
              sql`exists (select 1 from ${inventoryBarDetails} where ${inventoryBarDetails.itemId} = ${item} and ${inventoryBarDetails.subcategory} = ${filter.subcategory})`,
            )
          : undefined,
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => toItems(db, actor, kept));
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
    if (c.unitCostCents !== undefined && !canSeeField(actor, "internal_cost"))
      throw forbidden();
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
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, id)),
    event: "inventory_item",
  });
  return getItem(db, actor, id);
}
