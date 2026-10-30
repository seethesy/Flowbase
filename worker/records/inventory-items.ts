import {
  canSeeField,
  canSeeRentalCosts,
  redactFieldHistory,
  serializeFields,
} from "../../shared/visibility";
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
import { units, type Unit } from "../../shared/units";
import type { Version } from "../../shared/schema-primitives";
import { fullView, listHistoryPage, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  inventoryBarDetails,
  inventoryConsumableDetails,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryServiceDetails,
  inventoryStock,
  stockMovements,
  vendors,
} from "../db/schema";
import { forbidden, notFound, requireVersion } from "../hono";
import { can } from "../policy";
import { emitDomainEvent } from "../jobs/queue";
import { setArchived } from "./archive";
import { conflict, type ItemRow, round } from "./inventory-common";
import { recordCostChange } from "./inventory-costs";
import { requireStockSection } from "./inventory-sections";
import { findVendor, requireLiveVendor } from "./vendors";
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
  // Two queries per page whatever its size (FLOW-180): the kind-specific details
  // in one left-joined row per item, and the stock it holds.
  const [details, stock] = await Promise.all([
    db
      .select({
        // Only the columns the item shows; each detail's item id keeps it
        // present (not null) whenever its row exists.
        itemId: inventoryItems.id,
        rental: {
          itemId: inventoryRentalDetails.itemId,
          priceCents: inventoryRentalDetails.priceCents,
          internalCostCents: inventoryRentalDetails.internalCostCents,
          replacementCostCents: inventoryRentalDetails.replacementCostCents,
          dimensions: inventoryRentalDetails.dimensions,
          colors: inventoryRentalDetails.colors,
          notes: inventoryRentalDetails.notes,
          assemblyNotes: inventoryRentalDetails.assemblyNotes,
          bufferDaysBefore: inventoryRentalDetails.bufferDaysBefore,
          bufferDaysAfter: inventoryRentalDetails.bufferDaysAfter,
          vendorId: inventoryRentalDetails.vendorId,
          vendorCostCents: inventoryRentalDetails.vendorCostCents,
          leadTimeDays: inventoryRentalDetails.leadTimeDays,
          components: inventoryRentalDetails.components,
        },
        rentalVendorName: vendors.name,
        service: {
          itemId: inventoryServiceDetails.itemId,
          priceCents: inventoryServiceDetails.priceCents,
          priceBasis: inventoryServiceDetails.priceBasis,
          pricedByQuote: inventoryServiceDetails.pricedByQuote,
          includes: inventoryServiceDetails.includes,
          addons: inventoryServiceDetails.addons,
        },
        consumable: {
          itemId: inventoryConsumableDetails.itemId,
          purchaseUnit: inventoryConsumableDetails.purchaseUnit,
          packCount: inventoryConsumableDetails.packCount,
          eachSizeQuantity: inventoryConsumableDetails.eachSizeQuantity,
          eachSizeUnit: inventoryConsumableDetails.eachSizeUnit,
          recipeUnit: inventoryConsumableDetails.recipeUnit,
          unitCostCents: inventoryConsumableDetails.unitCostCents,
          preferredVendor: inventoryConsumableDetails.preferredVendor,
          preferredVendorId: inventoryConsumableDetails.preferredVendorId,
          parLevel: inventoryConsumableDetails.parLevel,
          allergens: inventoryConsumableDetails.allergens,
          storageSectionId: inventoryConsumableDetails.storageSectionId,
          storageOrder: inventoryConsumableDetails.storageOrder,
        },
        storageSectionName: inventorySections.name,
        bar: {
          itemId: inventoryBarDetails.itemId,
          brand: inventoryBarDetails.brand,
          subcategory: inventoryBarDetails.subcategory,
          container: inventoryBarDetails.container,
        },
      })
      .from(inventoryItems)
      .leftJoin(
        inventoryRentalDetails,
        eq(inventoryRentalDetails.itemId, inventoryItems.id),
      )
      .leftJoin(vendors, eq(vendors.id, inventoryRentalDetails.vendorId))
      .leftJoin(
        inventoryServiceDetails,
        eq(inventoryServiceDetails.itemId, inventoryItems.id),
      )
      .leftJoin(
        inventoryConsumableDetails,
        eq(inventoryConsumableDetails.itemId, inventoryItems.id),
      )
      .leftJoin(
        inventorySections,
        eq(inventoryConsumableDetails.storageSectionId, inventorySections.id),
      )
      .leftJoin(
        inventoryBarDetails,
        eq(inventoryBarDetails.itemId, inventoryItems.id),
      )
      .where(inArray(inventoryItems.id, ids)),
    db
      .select({
        itemId: inventoryStock.itemId,
        sectionId: inventoryStock.sectionId,
        sectionName: inventorySections.name,
        quantity: inventoryStock.quantity,
        color: inventoryStock.color,
      })
      .from(inventoryStock)
      .innerJoin(
        inventorySections,
        eq(inventoryStock.sectionId, inventorySections.id),
      )
      .where(
        and(
          inArray(inventoryStock.itemId, ids),
          sql`${inventoryStock.quantity} <> 0`,
        ),
      )
      .orderBy(asc(inventorySections.sortOrder), asc(inventorySections.name)),
  ]);
  const detailsById = indexBy(details, (detail) => detail.itemId);
  const stockByItem = groupBy(stock, (level) => level.itemId);
  return rows.map((row): InventoryItem => {
    const detail = detailsById.get(row.id);
    const rental = detail?.rental;
    const service = detail?.service;
    const levels = (stockByItem.get(row.id) ?? [])
      .filter((level) => level.quantity !== 0)
      .map(({ sectionId, sectionName, quantity, color }) => ({
        sectionId,
        sectionName,
        quantity,
        ...(color && { color }),
      }));
    const totalQuantity = round(
      levels.reduce((sum, level) => sum + level.quantity, 0),
    );
    const c = detail?.consumable;
    const bar = detail?.bar;
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
          ? {
              priceCents: rental?.priceCents ?? null,
              internalCostCents: rental?.internalCostCents ?? null,
              replacementCostCents: rental?.replacementCostCents ?? null,
              dimensions: rental?.dimensions ?? "",
              colors: rental?.colors ?? [],
              notes: rental?.notes ?? "",
              assemblyNotes: rental?.assemblyNotes ?? "",
              bufferDaysBefore: rental?.bufferDaysBefore ?? 1,
              bufferDaysAfter: rental?.bufferDaysAfter ?? 1,
              vendorId: rental?.vendorId ?? null,
              vendorCostCents: rental?.vendorCostCents ?? null,
              leadTimeDays: rental?.leadTimeDays ?? null,
              vendorName: detail?.rentalVendorName ?? null,
              components: rental?.components ?? [],
            }
          : null,
      service:
        row.kind === "service"
          ? {
              priceCents: service?.priceCents ?? null,
              priceBasis: service?.priceBasis ?? "per_event",
              pricedByQuote: service?.pricedByQuote ?? false,
              includes: service?.includes ?? [],
              addons: service?.addons ?? [],
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
            preferredVendorId: c.preferredVendorId,
            parLevel: c.parLevel,
            allergens: c.allergens as Allergen[],
            storageSectionId: c.storageSectionId,
            storageSectionName: detail?.storageSectionName ?? null,
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

// The item as an audit snapshot (FLOW-185): every field, whoever is writing.
// Stock is left out; it changes only through movements, which the ledger audits
// (FLOW-168).
export async function itemSnapshot(db: DbLike, id: string) {
  const snapshot: Record<string, unknown> = { ...(await getItem(db, fullView, id)) };
  delete snapshot.stock;
  delete snapshot.totalQuantity;
  delete snapshot.belowPar;
  return snapshot;
}

// History hides what toItems hides from the caller: consumable costs from users
// who can't see internal costs (F-01-04).
export async function itemHistory(
  db: DbLike,
  actor: Actor,
  id: string,
  page: PageRequest = {},
) {
  await findItem(db, id);
  return listHistoryPage(
    db,
    "inventory_item",
    id,
    (changes) => redactFieldHistory(actor, "inventory_item", changes),
    page,
  );
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

async function validateComponents(
  tx: DbLike,
  input: ItemInputParsed,
  itemId?: string,
) {
  // Serialize catalog graph edits so concurrent changes cannot introduce cycles.
  await tx.execute(sql`select pg_advisory_xact_lock(720798092)`);
  const rentals = await tx.select().from(inventoryRentalDetails);
  const components = input.rental?.components ?? input.service?.includes ?? [];
  const visited = new Set<string>();
  const visit = async (id: string, path: Set<string>): Promise<void> => {
    if (id === itemId || path.has(id))
      throw conflict(
        "KIT_CYCLE",
        "A kit cannot contain itself, even through another kit.",
      );
    if (visited.has(id)) return;
    const row = await findItem(tx, id);
    if (row.kind === "service" || !row.active || row.archivedAt)
      throw conflict(
        "INVALID_COMPONENT",
        `${row.name} must be an active rental or consumable.`,
      );
    for (const line of rentals.find((r) => r.itemId === id)?.components ?? [])
      await visit(line.itemId, new Set(path).add(id));
    visited.add(id);
  };
  for (const line of components) await visit(line.itemId, new Set());
  if (itemId) {
    const held = await tx
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.itemId, itemId));
    if (
      held.some(
        (level) =>
          level.quantity > 0 &&
          level.color &&
          !input.rental?.colors.includes(level.color),
      )
    )
      throw conflict(
        "COLOR_HAS_STOCK",
        "Count or move out a color's stock before removing it.",
      );
  }
}

// Writes the item's kind-specific row. A part-time user can't set a cost; an
// omitted cost keeps the stored one.
async function saveDetails(
  tx: DbLike,
  actor: Actor,
  itemId: string,
  input: ItemInputParsed,
) {
  if (input.kind === "rental") {
    const r = input.rental;
    if (
      (r?.internalCostCents !== undefined ||
        r?.replacementCostCents !== undefined ||
        r?.vendorCostCents !== undefined) &&
      !canSeeRentalCosts(actor)
    )
      throw forbidden();
    const [stored] = await tx
      .select({ vendorId: inventoryRentalDetails.vendorId })
      .from(inventoryRentalDetails)
      .where(eq(inventoryRentalDetails.itemId, itemId));
    const vendorId = r?.vendorId ?? null;
    // Linking to a vendor needs a live one; an existing link may stay after the
    // vendor is archived.
    if (vendorId && vendorId !== (stored?.vendorId ?? null))
      await requireLiveVendor(tx, vendorId);
    const values = {
      priceCents: r?.priceCents ?? null,
      dimensions: r?.dimensions ?? "",
      colors: r?.colors ?? [],
      notes: r?.notes ?? "",
      assemblyNotes: r?.assemblyNotes ?? "",
      bufferDaysBefore: r?.bufferDaysBefore ?? 1,
      bufferDaysAfter: r?.bufferDaysAfter ?? 1,
      components: r?.components ?? [],
      vendorId,
      leadTimeDays: vendorId ? (r?.leadTimeDays ?? null) : null,
      // A rental that's no longer sub-rented has no vendor cost.
      ...(!vendorId
        ? { vendorCostCents: null }
        : r?.vendorCostCents !== undefined && {
            vendorCostCents: r.vendorCostCents,
          }),
      ...(r?.internalCostCents !== undefined && {
        internalCostCents: r.internalCostCents,
      }),
      ...(r?.replacementCostCents !== undefined && {
        replacementCostCents: r.replacementCostCents,
      }),
    };
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
      pricedByQuote: input.service?.pricedByQuote ?? false,
      includes: input.service?.includes ?? [],
      addons: input.service?.addons ?? [],
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
    let storageSectionId = c.storageSectionId;
    if (!storageSectionId && input.subtype === "supply") {
      const [section] = await tx
        .select({ id: inventorySections.id })
        .from(inventorySections)
        .where(
          and(
            eq(inventorySections.kind, "consumable"),
            eq(inventorySections.name, "Supplies"),
            isNull(inventorySections.archivedAt),
          ),
        );
      storageSectionId = section?.id ?? null;
    }
    if (storageSectionId)
      await requireStockSection(tx, storageSectionId, "consumable");
    const [stored] = await tx
      .select({
        unitCostCents: inventoryConsumableDetails.unitCostCents,
        preferredVendorId: inventoryConsumableDetails.preferredVendorId,
      })
      .from(inventoryConsumableDetails)
      .where(eq(inventoryConsumableDetails.itemId, itemId));
    // A directory vendor (FLOW-84) sets the preferred vendor's name.
    let preferredVendor = c.preferredVendor;
    if (c.preferredVendorId) {
      const vendor =
        c.preferredVendorId === (stored?.preferredVendorId ?? null)
          ? await findVendor(tx, c.preferredVendorId)
          : await requireLiveVendor(tx, c.preferredVendorId);
      preferredVendor = vendor.name;
    }
    const values = {
      purchaseUnit: c.purchaseUnit,
      packCount: c.packCount,
      eachSizeQuantity: c.eachSize?.quantity ?? null,
      eachSizeUnit: c.eachSize?.unit ?? null,
      recipeUnit: c.recipeUnit,
      preferredVendor,
      preferredVendorId: c.preferredVendorId,
      parLevel: c.parLevel,
      allergens: c.allergens,
      storageSectionId,
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
    await validateComponents(tx, input);
    const [row] = await tx
      .insert(inventoryItems)
      .values({ ...itemValues(input, actor), createdBy: actor.userId })
      .returning({ id: inventoryItems.id });
    await saveDetails(tx, actor, row.id, input);
    await writeAudit(tx, actor, {
      entityType: "inventory_item",
      entityId: row.id,
      action: "create",
      before: null,
      after: await itemSnapshot(tx, row.id),
    });
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
  input: ItemInputParsed & Partial<Version>,
): Promise<InventoryItem> {
  const current = await findItem(db, id);
  if (current.kind !== input.kind)
    throw conflict(
      "KIND_CHANGE",
      "An item's kind can't change. Archive it and create a new item instead.",
    );
  await requireUniqueCode(db, input.code, id);
  await db.transaction(async (tx) => {
    // Locked before anything is read: recordMovement takes the same lock, so a
    // first stock movement and this save can't interleave (FLOW-198 AC4).
    const [locked] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, id))
      .for("update");
    requireVersion(locked.updatedAt, input.updatedAt, "item");
    if (input.unit !== locked.unit) await requireNoStockHistory(tx, locked);
    const before = await itemSnapshot(tx, id);
    await validateComponents(tx, input, id);
    if (input.kind === "rental") {
      const [stored] = await tx
        .select()
        .from(inventoryRentalDetails)
        .where(eq(inventoryRentalDetails.itemId, id))
        .for("update");
      if (
        !can(actor, "rentals.apply_directly") &&
        (stored?.priceCents ?? null) !== (input.rental?.priceCents ?? null)
      )
        throw conflict(
          "PRICE_APPROVAL_REQUIRED",
          "Client price changes require approval. The approval workflow is not yet available.",
        );
    }
    await tx
      .update(inventoryItems)
      .set(itemValues(input, actor))
      .where(eq(inventoryItems.id, id));
    await saveDetails(tx, actor, id, input);
    await writeAudit(tx, actor, {
      entityType: "inventory_item",
      entityId: id,
      action: "update",
      before,
      after: await itemSnapshot(tx, id),
    });
    await emitDomainEvent(tx, { name: "inventory_item.updated", entityId: id });
  });
  return getItem(db, actor, id);
}

// Stock movements are recorded in the item's unit and keep no unit of their own,
// so once an item has any history its unit can't change: 10 lb would read as
// 10 oz (FLOW-198). A zero balance doesn't erase history. No conversion.
async function requireNoStockHistory(
  tx: DbLike,
  item: { id: string; unit: string },
) {
  const unit = units[item.unit as Unit]?.label ?? item.unit;
  const [moved] = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(eq(stockMovements.itemId, item.id))
    .limit(1);
  if (moved)
    throw conflict(
      "UNIT_LOCKED",
      `This item's stock history is recorded in ${unit}, so its stock unit can't change. Keep ${unit}, or archive this item and create a new one in the new unit.`,
    );
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
    lock: (tx) => tx.select({ id: inventoryItems.id }).from(inventoryItems)
      .where(eq(inventoryItems.id, id)).for("update"),
    update: (tx, values) =>
      tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, id)),
    audit: { entityType: "inventory_item", snapshot: itemSnapshot },
    event: "inventory_item",
  });
  return getItem(db, actor, id);
}
