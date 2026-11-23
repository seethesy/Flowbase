import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { ZodError } from "zod";
import type { Actor } from "../../shared/access";
import {
  barExternalKey,
  barInventoryFields,
  describeBarRow,
  describeMasterRow,
  masterExternalKey,
  masterInventoryFields,
  parseBarRow,
  parseMasterRow,
  type BarRow,
  type MasterRow,
  type ParseResult,
} from "../../shared/import-inventory";
import type { ImportField, ImportTransform } from "../../shared/imports";
import {
  itemInputSchema,
  type InventoryItem,
  type ItemInputParsed,
} from "../../shared/inventory";
import type { VendorType } from "../../shared/vendors";
import { canSeeField, canSeeRentalCosts } from "../../shared/visibility";
import { fullView } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  allInventoryItems,
  inventoryCategories,
  inventoryTypes,
  inventoryLocations,
  inventoryStock,
  vendors,
} from "../db/schema";
import { ApiError } from "../hono";
import {
  createItem,
  createSection,
  findItem,
  getItem,
  recordImportedStock,
  updateItem,
} from "./inventory";
import { defineImportModule, type ImportModule } from "./imports";
import { ensureVendor } from "./vendors";

// The Master Inventory (FLOW-78) and Bar Inventory (FLOW-91) importers. Each
// sheet row becomes an item keyed by its sheet identity, so re-running a file
// updates what it imported before and, when nothing in the file changed, nothing
// at all. The file is authoritative for what it carries: category, subcategory,
// notes, pull owner, flags, supplier and the opening quantity. Everything it does
// not carry (price, colors, kit components…) is kept from the stored item.

type SectionKind = "location" | "storage";
// The Master sheet's Location column, as the default locations name them.
const sheetLocations: Record<string, string> = {
  Warehouse: "Warehouse",
  "Jamie's": "Jamie's - Main Floor",
  "Storage Box": "Storage Box",
};
type Targets = { vendorId: string | null; sectionId: string | null; categoryId: string | null; typeId: string | null; typeError?: string };
type StockTarget = { name: string; kind: SectionKind };
type Draft = Record<string, unknown>;

const without = (value: object, keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const merge = (stored: unknown, imported: unknown) => ({
  ...((stored as object | null | undefined) ?? {}),
  ...((imported as object | null | undefined) ?? {}),
});

async function findSection(db: DbLike, name: string, kind: SectionKind) {
  const [section] = await db
    .select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(
      and(
        sql`lower(${inventoryLocations.name}) = lower(${name})`,
        eq(inventoryLocations.kind, kind),
        isNull(inventoryLocations.archivedAt),
      ),
    );
  return section?.id ?? null;
}

async function ensureSection(
  tx: DbLike,
  actor: Actor,
  { name, kind }: StockTarget,
) {
  return (
    (await findSection(tx, name, kind)) ??
    (await createSection(tx as unknown as Db, actor, { name, kind })).id
  );
}

async function findVendorId(db: DbLike, name: string) {
  const [vendor] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        sql`lower(${vendors.name}) = lower(${name})`,
        isNull(vendors.archivedAt),
      ),
    );
  return vendor?.id ?? null;
}

async function stockAt(db: DbLike, itemId: string, sectionId: string) {
  const [level] = await db
    .select({ quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, itemId),
        eq(inventoryStock.sectionId, sectionId),
        eq(inventoryStock.color, ""),
      ),
    );
  return level?.quantity ?? 0;
}

// What an item already holds that the file does not carry, as item input. Costs
// are left out; compose adds them where the file or a comparison needs them.
const carry = (stored: InventoryItem): Draft => ({
  kind: stored.kind,
  subtype: stored.subtype,
  code: stored.code,
  name: stored.name,
  category: stored.category,
  categoryId: stored.categoryId,
  typeId: stored.typeId,
  description: stored.description,
  unit: stored.unit,
  group: stored.group,
  subcategory: stored.subcategory,
  pullOwner: stored.pullOwner,
  flags: stored.flags,
  color: stored.color,
  tier: stored.tier,
  ratio: stored.ratio,
  active: stored.active,
  rental:
    stored.rental &&
    without(stored.rental, [
      "vendorName",
      "supplierName",
      "internalCostCents",
      "replacementCostCents",
      "vendorCostCents",
    ]),
  consumable:
    stored.consumable &&
    without(stored.consumable, ["unitCostCents", "costHidden", "storageSectionName"]),
  service: stored.service,
  bar: stored.bar,
});

type Drafted = { item: Draft; costCents: number | null };

// The item input a row produces on top of what the item already holds. "save"
// sends a cost only when the file has one that differs from the stored cost (a
// part-time user can't send costs at all); "compare" always includes the stored
// cost, so an unchanged row compares equal.
function compose(
  stored: InventoryItem | null,
  drafted: Drafted | null,
  mode: "save" | "compare",
): Draft {
  const base = stored ? carry(stored) : {};
  const item: Draft = { ...base, ...drafted?.item };
  // Kind-specific details exist only where the item has them (null is not input).
  for (const part of ["rental", "consumable", "bar", "service"]) {
    if (base[part] || drafted?.item[part])
      item[part] = merge(base[part], drafted?.item[part]);
    else delete item[part];
  }
  const costKey =
    item.kind === "rental" ? "rental" : item.kind === "consumable" ? "consumable" : null;
  if (costKey && item.subtype !== "bar") {
    const field = costKey === "rental" ? "internalCostCents" : "unitCostCents";
    const detail = stored?.[costKey] as Record<string, unknown> | null | undefined;
    const current = detail ? (detail[field] as number | null | undefined) : undefined;
    const given = drafted?.costCents ?? null;
    const cost = given ?? current;
    if (mode === "compare" ? cost !== undefined : given !== null && given !== current)
      item[costKey] = { ...(item[costKey] as object), [field]: cost };
  }
  return item;
}

function parseInput(draft: Draft): ItemInputParsed {
  try {
    return itemInputSchema.parse(draft);
  } catch (error) {
    if (error instanceof ZodError)
      throw new ApiError(
        400,
        "INVALID_ROW",
        error.issues.map((issue) => issue.message).join(" "),
      );
    throw error;
  }
}

type Config<Row extends { name: string; quantity: number; distributor: string; typeName: string }> = {
  key: string;
  label: string;
  fields: ImportField[];
  transforms: ImportTransform[];
  parse: (values: Record<string, string>) => ParseResult<Row>;
  externalKey: (row: Row) => string;
  describe: (row: Row) => { summary: string; notes: string[] };
  vendorType: VendorType;
  // The section the imported quantity lands in; null for rows with no stock.
  stock: (row: Row) => StockTarget | null;
  classification: (row: Row) => { kind: string; category: string };
  draft: (row: Row, targets: Targets) => Drafted;
  costError?: (actor: Actor, row: Row) => string | null;
  duplicateFilter?: (row: Row) => SQL | undefined;
};

function inventoryImporter<
  Row extends { name: string; quantity: number; distributor: string; typeName: string },
>(config: Config<Row>) {
  const draft = (row: Row, found: Targets): Drafted => {
    const original = config.draft(row, found);
    return { ...original, item: { ...original.item, categoryId: found.categoryId, typeId: found.typeId } };
  };
  // Reads only (dry run and comparison) or also creates the vendor and section
  // the row names (commit).
  const targets = async (
    db: DbLike,
    actor: Actor,
    row: Row,
    write: boolean,
  ): Promise<Targets> => {
    const stock = config.stock(row);
    const classKey = config.classification(row);
    const [category] = await db.select({ id: inventoryCategories.id }).from(inventoryCategories)
      .where(and(eq(inventoryCategories.kind, classKey.kind), sql`lower(${inventoryCategories.name}) = lower(${classKey.category})`, isNull(inventoryCategories.archivedAt))).limit(1);
    const [type] = row.typeName && category ? await db.select({ id: inventoryTypes.id }).from(inventoryTypes)
      .where(and(eq(inventoryTypes.categoryId, category.id), sql`lower(${inventoryTypes.name}) = lower(${row.typeName})`, isNull(inventoryTypes.archivedAt))).limit(1) : [];
    return {
      categoryId: category?.id ?? null,
      typeId: type?.id ?? null,
      typeError: row.typeName && !type ? `Unknown Type "${row.typeName}" for ${classKey.category}.` : undefined,
      vendorId: row.distributor
        ? write
          ? await ensureVendor(db, actor, { name: row.distributor, type: config.vendorType })
          : await findVendorId(db, row.distributor)
        : null,
      sectionId: stock
        ? write
          ? await ensureSection(db, actor, stock)
          : await findSection(db, stock.name, stock.kind)
        : null,
    };
  };
  const importStock = async (
    tx: DbLike,
    actor: Actor,
    itemId: string,
    row: Row,
    sectionId: string | null,
    context: { importId: string; fileName: string },
  ) => {
    if (!sectionId) return;
    await recordImportedStock(tx, actor, await findItem(tx, itemId), {
      sectionId,
      quantity: row.quantity,
      ...context,
    });
  };

  return defineImportModule<Row>({
    key: config.key,
    label: config.label,
    permission: "inventory.write",
    fields: config.fields,
    transforms: config.transforms,
    parse: config.parse,
    externalKey: config.externalKey,
    describe: config.describe,
    check: async (db, actor, row) => {
      const errors: string[] = [];
      const found = await targets(db, actor, row, false);
      if (!found.categoryId) errors.push("Inventory category is missing; ask an Admin to create it.");
      if (found.typeError) errors.push(found.typeError);
      const cost = config.costError?.(actor, row);
      if (cost) errors.push(cost);
      const checked = itemInputSchema.safeParse(
        compose(null, draft(row, found), "save"),
      );
      if (!checked.success) errors.push(...checked.error.issues.map((issue) => issue.message));
      return errors;
    },
    findDuplicates: async (db, _actor, row) => {
      const matches = await db
        .select({ id: allInventoryItems.id, name: allInventoryItems.name })
        .from(allInventoryItems)
        .where(
          and(
            sql`lower(${allInventoryItems.name}) = lower(${row.name})`,
            isNull(allInventoryItems.archivedAt),
            config.duplicateFilter?.(row),
          ),
        );
      return matches.map((match) => ({ id: match.id, label: match.name }));
    },
    wouldChange: async (db, actor, recordId, row) => {
      const found = await targets(db, actor, row, false);
      if (row.distributor && !found.vendorId) return true;
      if (config.stock(row) && !found.sectionId) return true;
      const stored = await getItem(db, fullView, recordId);
      const unchanged =
        JSON.stringify(parseInput(compose(stored, null, "compare"))) ===
        JSON.stringify(parseInput(compose(stored, draft(row, found), "compare")));
      if (!unchanged) return true;
      return found.sectionId
        ? (await stockAt(db, recordId, found.sectionId)) !== row.quantity
        : false;
    },
    create: async (tx, actor, row, context) => {
      const found = await targets(tx, actor, row, true);
      if (!found.categoryId || found.typeError) throw new ApiError(400, "INVALID_TYPE", found.typeError ?? "Inventory category is missing.");
      const item = await createItem(
        tx as unknown as Db,
        actor,
        parseInput(compose(null, draft(row, found), "save")),
      );
      await importStock(tx, actor, item.id, row, found.sectionId, context);
      return item.id;
    },
    update: async (tx, actor, recordId, row, context) => {
      const found = await targets(tx, actor, row, true);
      if (!found.categoryId || found.typeError) throw new ApiError(400, "INVALID_TYPE", found.typeError ?? "Inventory category is missing.");
      const stored = await getItem(tx, fullView, recordId);
      await updateItem(
        tx as unknown as Db,
        actor,
        recordId,
        parseInput(compose(stored, draft(row, found), "save")),
      );
      await importStock(tx, actor, recordId, row, found.sectionId, context);
    },
  });
}

const sortedFlags = (flags: string[]) => [...flags].sort();

export const masterInventoryImporter = inventoryImporter<MasterRow>({
  key: "master_inventory",
  label: "Master Inventory",
  fields: masterInventoryFields,
  transforms: [{ type: "inventory_rows", layout: "master" }],
  parse: parseMasterRow,
  externalKey: masterExternalKey,
  describe: describeMasterRow,
  // The sheet lists gear bought from a store or distributor, not food or drink.
  vendorType: "food_distributor",
  // Rentals and supplies are Master items (FLOW-289) and count in their sheet
  // location; a location the list lacks is added. The sheet's "Jamie's" is
  // Jamie's - Main Floor (Ash, 2026-11-23).
  stock: (row) =>
    row.kind === "service" ? null : { name: sheetLocations[row.location], kind: "location" },
  classification: (row) => ({ kind: row.kind === "consumable" ? "supply" : row.kind, category: row.kind === "service" ? "Services" : row.subtype ?? "Supply" }),
  costError: (actor, row) =>
    row.costCents === null
      ? null
      : row.kind === "rental"
        ? canSeeRentalCosts(actor)
          ? null
          : "Only full-time staff can import costs."
        : canSeeField(actor, "internal_cost")
          ? null
          : "Only full-time staff can import costs.",
  draft: (row, targets) => ({
    costCents: row.costCents,
    item: {
      kind: row.kind,
      subtype: row.subtype,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      description: row.description,
      pullOwner: row.pullOwner,
      flags: sortedFlags(row.flags),
      ...(row.kind === "rental" && { rental: { supplierId: targets.vendorId } }),
      ...(row.kind === "consumable" && {
        consumable: {
          purchaseUnit: "each",
          preferredVendorId: targets.vendorId,
          storageSectionId: targets.sectionId,
        },
      }),
      ...(row.kind === "service" && { service: {} }),
    },
  }),
});

export const barInventoryImporter = inventoryImporter<BarRow>({
  key: "bar_inventory",
  label: "Bar Inventory",
  fields: barInventoryFields,
  transforms: [{ type: "inventory_rows", layout: "bar" }],
  parse: parseBarRow,
  externalKey: barExternalKey,
  describe: describeBarRow,
  vendorType: "beverage_distributor",
  // Bar stock is kept per location but no bar screen shows it yet (FLOW-289).
  stock: () => ({ name: "Warehouse", kind: "location" }),
  classification: () => ({ kind: "bar", category: "Bar" }),
  duplicateFilter: (row) => eq(allInventoryItems.category, row.category),
  draft: (row, targets) => ({
    costCents: null,
    item: {
      kind: "consumable",
      subtype: "bar",
      name: row.name,
      category: row.category,
      description: row.notes,
      unit: row.purchaseUnit,
      tier: row.tier,
      flags: sortedFlags(row.flags),
      bar: { brand: row.name, subcategory: row.subcategory },
      consumable: {
        purchaseUnit: row.purchaseUnit,
        packCount: row.packCount,
        eachSize: row.eachSize,
        preferredVendorId: targets.vendorId,
        storageSectionId: targets.sectionId,
      },
    },
  }),
});

// Registered importers (FLOW-78, FLOW-91; FLOW-89, FLOW-99 and FLOW-101 add theirs).
export const registeredImportModules: ImportModule[] = [
  masterInventoryImporter,
  barInventoryImporter,
];
