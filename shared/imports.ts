import { z } from "zod";
import { id, text } from "./schema-primitives";

// Data import framework (FLOW-47, ADR-09). The browser parses the CSV or XLSX file,
// maps its columns to the importer's fields and applies the importer's row
// transforms; the API checks rows (dry run) and commits them in batches of at most
// IMPORT_BATCH_SIZE rows, so each request stays within the Worker CPU budget.
// Each module importer (Master Inventory, Kitchen Ingredients, Bar Inventory,
// Recipes, Leads) registers on the Worker and upserts by an external key, so an
// import can be re-run without creating duplicates.
export const IMPORT_BATCH_SIZE = 100;

// Row transforms an importer declares; the browser applies them in order after
// column mapping.
export const importTransformSchema = z.discriminatedUnion("type", [
  // A row whose only filled cell is in the first column is a heading ("DAIRY")
  // and is dropped; the rows under it get that heading as `field`.
  z.object({ type: z.literal("category_headers"), field: z.string() }),
  // Grouped rows leave a field blank under the first row of the group; a blank
  // `field` takes the value of the row above.
  z.object({ type: z.literal("fill_down"), field: z.string() }),
]);
export type ImportTransform = z.infer<typeof importTransformSchema>;

export const importFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  // Other column headings that map to this field automatically.
  aliases: z.array(z.string()),
});
export type ImportField = z.infer<typeof importFieldSchema>;

export const importModuleSchema = z.object({
  key: z.string(),
  label: z.string(),
  fields: z.array(importFieldSchema),
  transforms: z.array(importTransformSchema),
});
export type ImportModuleInfo = z.infer<typeof importModuleSchema>;

// One file row after mapping: values by field key. rowNumber is the row's line in
// the file (the heading is row 1), so reports point at the spreadsheet.
export const importRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  values: z.record(z.string(), z.string().max(10_000)),
});
export type ImportRow = z.infer<typeof importRowSchema>;
const rows = importRowSchema.array().min(1).max(IMPORT_BATCH_SIZE);

export const importDryRunSchema = z.object({
  module: z.string().min(1).max(60),
  rows,
});
export const importStartSchema = z.object({
  module: z.string().min(1).max(60),
  fileName: text(255).min(1, "Choose a file."),
  rowCount: z.number().int().min(0).max(100_000),
});
export const importBatchSchema = z.object({ rows });

export const importPlanActions = ["create", "update", "skip", "error"] as const;
export const importRowPlanSchema = z.object({
  rowNumber: z.number().int(),
  action: z.enum(importPlanActions),
  // The key the row upserts by; null when the row has errors.
  externalKey: z.string().nullable(),
  errors: z.array(z.string()),
  // Existing records this new row may duplicate (same name, not the same key).
  duplicates: z.array(z.object({ id, label: z.string() })),
});
export type ImportRowPlan = z.infer<typeof importRowPlanSchema>;

export const importOutcomes = ["created", "updated", "skipped", "failed"] as const;
export type ImportOutcome = (typeof importOutcomes)[number];
export const importRowResultSchema = z.object({
  rowNumber: z.number().int(),
  outcome: z.enum(importOutcomes),
  recordId: id.nullable(),
  error: z.string().nullable(),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importStatuses = ["running", "completed"] as const;
export const importLogSchema = z.object({
  id,
  module: z.string(),
  fileName: z.string(),
  status: z.enum(importStatuses),
  rowCount: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  createdBy: id.nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type ImportLog = z.infer<typeof importLogSchema>;

export const importBatchResultSchema = z.object({
  log: importLogSchema,
  results: z.array(importRowResultSchema),
});
export type ImportBatchResult = z.infer<typeof importBatchResultSchema>;

// ---- Pure helpers shared by the browser and the tests ----

const blank = (value: string | undefined) => !value || !value.trim();

// Applies an importer's transforms to mapped rows. `cells` is each row's raw
// cells, used to recognise category heading rows.
export function applyTransforms(
  rows: (ImportRow & { cells: string[] })[],
  transforms: ImportTransform[],
): ImportRow[] {
  let current = rows;
  for (const transform of transforms) {
    if (transform.type === "category_headers") {
      let heading = "";
      current = current.flatMap((row) => {
        const filled = row.cells.filter((cell) => !blank(cell));
        if (filled.length === 1 && !blank(row.cells[0])) {
          heading = row.cells[0].trim();
          return [];
        }
        return blank(row.values[transform.field]) && heading
          ? [{ ...row, values: { ...row.values, [transform.field]: heading } }]
          : [row];
      });
    } else {
      let above = "";
      current = current.map((row) => {
        if (!blank(row.values[transform.field])) {
          above = row.values[transform.field];
          return row;
        }
        return above
          ? { ...row, values: { ...row.values, [transform.field]: above } }
          : row;
      });
    }
  }
  return current.map(({ rowNumber, values }) => ({ rowNumber, values }));
}

// The heading row: the sheet's first row with anything in it.
export const headingIndex = (sheet: string[][]) =>
  sheet.findIndex((cells) => !cells.every(blank));

// Maps the rows under the heading to field values. mapping is field key -> column
// index. Blank rows are dropped; row numbers stay the sheet's (row 1 is the top).
export function mapRows(
  sheet: string[][],
  mapping: Record<string, number | null>,
): (ImportRow & { cells: string[] })[] {
  const heading = headingIndex(sheet);
  if (heading === -1) return [];
  return sheet.flatMap((cells, index) => {
    if (index <= heading || cells.every(blank)) return [];
    const values: Record<string, string> = {};
    for (const [field, column] of Object.entries(mapping))
      if (column !== null) values[field] = (cells[column] ?? "").trim();
    return [{ rowNumber: index + 1, values, cells }];
  });
}

const normalise = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

// Picks the column for each field whose heading matches its label, key or an
// alias, ignoring case, spaces and punctuation.
export function autoMap(
  headings: string[],
  fields: ImportField[],
): Record<string, number | null> {
  const columns = headings.map(normalise);
  return Object.fromEntries(
    fields.map((field) => {
      const names = [field.label, field.key, ...field.aliases].map(normalise);
      const index = columns.findIndex(
        (column) => column !== "" && names.includes(column),
      );
      return [field.key, index === -1 ? null : index];
    }),
  );
}

// Splits rows into request-sized batches (FLOW-47 AC3).
export function batches<T>(items: T[], size = IMPORT_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    result.push(items.slice(start, start + size));
  return result;
}
