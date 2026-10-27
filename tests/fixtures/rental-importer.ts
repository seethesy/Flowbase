import { and, eq, isNull, sql } from "drizzle-orm";
import { itemInputSchema } from "../../shared/inventory";
import type { Db, DbLike } from "../../worker/db/client";
import {
  inventoryItems,
  inventorySections,
  inventoryStock,
} from "../../worker/db/schema";
import { defineImportModule } from "../../worker/records/imports";
import {
  createItem,
  findItem,
  recordImportedStock,
  updateItem,
} from "../../worker/records/inventory";

// A test-only module importer for the import framework (FLOW-47) and imported
// stock (FLOW-168): rental items keyed by code, with a quantity in a named
// section. The real Master Inventory importer is FLOW-78.
type RentalRow = {
  code: string;
  name: string;
  category: string;
  section: string;
  // Blank leaves the section's stock as it is.
  quantity: number | null;
};

const sectionNamed = async (db: DbLike, name: string) => {
  const [section] = await db
    .select({ id: inventorySections.id })
    .from(inventorySections)
    .where(
      and(
        sql`lower(${inventorySections.name}) = lower(${name})`,
        eq(inventorySections.kind, "rental"),
        isNull(inventorySections.archivedAt),
      ),
    );
  return section;
};
const input = (row: RentalRow) =>
  itemInputSchema.parse({
    kind: "rental",
    subtype: "furniture",
    code: row.code,
    name: row.name,
    category: row.category,
  });
const sectionStock = async (tx: DbLike, itemId: string, sectionId: string) => {
  const [level] = await tx
    .select({ quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, itemId),
        eq(inventoryStock.sectionId, sectionId),
      ),
    );
  return level?.quantity ?? 0;
};
const importedStock = async (
  tx: DbLike,
  actor: Parameters<typeof recordImportedStock>[1],
  itemId: string,
  row: RentalRow,
  context: { importId: string; fileName: string },
) => {
  if (!row.section || row.quantity === null) return;
  const section = await sectionNamed(tx, row.section);
  await recordImportedStock(tx, actor, await findItem(tx, itemId), {
    sectionId: section.id,
    quantity: row.quantity,
    ...context,
  });
};

export const rentalImporter = defineImportModule<RentalRow>({
  key: "test_rentals",
  label: "Test rentals",
  permission: "inventory.write",
  fields: [
    { key: "code", label: "Code", required: true, aliases: ["SKU"] },
    { key: "name", label: "Name", required: true, aliases: ["Item"] },
    { key: "category", label: "Category", required: false, aliases: [] },
    { key: "section", label: "Section", required: false, aliases: [] },
    { key: "quantity", label: "Quantity", required: false, aliases: ["Qty"] },
  ],
  transforms: [{ type: "category_headers", field: "category" }],
  parse: (values) => {
    const errors: string[] = [];
    const code = values.code?.trim() ?? "";
    const name = values.name?.trim() ?? "";
    const given = values.quantity?.trim() ?? "";
    const quantity = given === "" ? null : Number(given);
    if (!code) errors.push("Code is required.");
    if (!name) errors.push("Name is required.");
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0))
      errors.push("Quantity must be a number of 0 or more.");
    if (errors.length) return { errors };
    return {
      row: {
        code,
        name,
        category: values.category?.trim() ?? "",
        section: values.section?.trim() ?? "",
        quantity,
      },
    };
  },
  externalKey: (row) => row.code,
  check: async (db, _actor, row) =>
    row.section && !(await sectionNamed(db, row.section))
      ? [`There's no rental section named ${row.section}.`]
      : [],
  findDuplicates: async (db, _actor, row) => {
    const matches = await db
      .select({ id: inventoryItems.id, name: inventoryItems.name })
      .from(inventoryItems)
      .where(
        and(
          sql`lower(${inventoryItems.name}) = lower(${row.name})`,
          isNull(inventoryItems.archivedAt),
        ),
      );
    return matches.map((match) => ({ id: match.id, label: match.name }));
  },
  wouldChange: async (db, _actor, recordId, row) => {
    const item = await findItem(db, recordId);
    if (item.name !== row.name || item.category !== row.category) return true;
    if (!row.section || row.quantity === null) return false;
    const section = await sectionNamed(db, row.section);
    return (await sectionStock(db, recordId, section.id)) !== row.quantity;
  },
  create: async (tx, actor, row, context) => {
    const item = await createItem(tx as unknown as Db, actor, input(row));
    await importedStock(tx, actor, item.id, row, context);
    return item.id;
  },
  update: async (tx, actor, recordId, row, context) => {
    await updateItem(tx as unknown as Db, actor, recordId, input(row));
    await importedStock(tx, actor, recordId, row, context);
  },
});
