import { z } from "zod";
import { convert, unitSchema, type ItemConversions, type Unit } from "./units";

// Inventory (FLOW-69 item model, FLOW-70 sections, FLOW-81 ingredient catalog),
// shared by the API and the app. One item model covers rentals, decor, kitchen
// ingredients, bar stock, disposables and non-stock service offerings. Kind-specific
// fields live in typed sub-records so later tickets extend them without touching
// the base item.
const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const timestamp = z.string().datetime();
const quantity = z.number().finite().min(0).max(1_000_000);
const cents = z.number().int().min(0).max(100_000_000);

export const itemKindSchema = z.enum(["rental", "consumable", "service"]);
export type ItemKind = z.infer<typeof itemKindSchema>;
export const rentalSubtypeSchema = z.enum([
  "equipment",
  "furniture",
  "linen",
  "tableware",
  "glassware",
  "bar",
  "decor",
]);
export const consumableSubtypeSchema = z.enum(["ingredient", "bar", "supply"]);
export const subtypesByKind = {
  rental: rentalSubtypeSchema.options,
  consumable: consumableSubtypeSchema.options,
  service: [],
} as const satisfies Record<ItemKind, readonly string[]>;

export const ratioBasisSchema = z.enum(["per_guest", "per_table", "per_event"]);
export type RatioBasis = z.infer<typeof ratioBasisSchema>;
export const ratioBasisLabels: Record<RatioBasis, string> = {
  per_guest: "per guest",
  per_table: "per table",
  per_event: "per event",
};

// Built-in lists until business settings make them configurable (FLOW-45).
export const ingredientCategories = [
  "Dairy",
  "Bread",
  "Produce",
  "Meat",
  "Frozen Food",
  "Dry Goods",
];
// Allergen flags until allergen and dietary tags exist (FLOW-95): the US major
// food allergens.
export const allergenSchema = z.enum([
  "milk",
  "eggs",
  "fish",
  "shellfish",
  "tree_nuts",
  "peanuts",
  "wheat",
  "soy",
  "sesame",
]);
export type Allergen = z.infer<typeof allergenSchema>;
export const allergenLabels: Record<Allergen, string> = {
  milk: "Milk",
  eggs: "Eggs",
  fish: "Fish",
  shellfish: "Shellfish",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  wheat: "Wheat",
  soy: "Soy",
  sesame: "Sesame",
};

const eachSizeSchema = z.object({
  quantity: z.number().finite().positive().max(1_000_000),
  unit: unitSchema,
});
export const rentalDetailsSchema = z.object({
  // Price to the client for one unit, when the item is priced on its own.
  priceCents: cents.nullable().default(null),
});
export const serviceDetailsSchema = z.object({
  priceCents: cents.nullable().default(null),
  priceBasis: ratioBasisSchema.default("per_event"),
});
export const consumableDetailsInputSchema = z.object({
  // How it is bought: a case of packCount × eachSize (12 × 750 ml), a 50 lb bag
  // (purchaseUnit lb), a dozen eggs.
  purchaseUnit: unitSchema,
  packCount: z.number().int().positive().max(10_000).nullable().default(null),
  // What one "each" weighs or holds; also the count ↔ weight conversion
  // (1 chicken breast ≈ 8 oz).
  eachSize: eachSizeSchema.nullable().default(null),
  recipeUnit: unitSchema.nullable().default(null),
  // Cost of one purchase unit. FT+ only (F-01-04): omitted keeps the stored cost.
  unitCostCents: cents.nullable().optional(),
  preferredVendor: text(200).default(""),
  // In the item's stock unit.
  parLevel: quantity.nullable().default(null),
  allergens: z.array(allergenSchema).max(20).default([]),
  // Where it is normally kept (FLOW-70).
  storageSectionId: id.nullable().default(null),
});

const ratioSchema = z.object({
  quantity: z.number().finite().positive().max(10_000),
  basis: ratioBasisSchema,
});

export const itemInputSchema = z
  .object({
    kind: itemKindSchema,
    // Checked against the kind below; services have none.
    subtype: z.string().nullable().default(null),
    code: text(60).default(""),
    name: z.string().trim().min(1, "Name is required.").max(200),
    category: text(100).default(""),
    description: text(5000).default(""),
    // The unit stock is counted in.
    unit: unitSchema.default("each"),
    // Display grouping, e.g. "Table Linens" over Standard, Premium and Platinum.
    group: text(100).default(""),
    color: text(60).default(""),
    tier: text(60).default(""),
    ratio: ratioSchema.nullable().default(null),
    active: z.boolean().default(true),
    rental: rentalDetailsSchema.optional(),
    consumable: consumableDetailsInputSchema.optional(),
    service: serviceDetailsSchema.optional(),
  })
  .superRefine((item, ctx) => {
    const subtypes: readonly string[] = subtypesByKind[item.kind];
    const valid =
      item.kind === "service"
        ? item.subtype === null
        : item.subtype !== null && subtypes.includes(item.subtype);
    if (!valid)
      ctx.addIssue({
        code: "custom",
        path: ["subtype"],
        message:
          item.kind === "service"
            ? "Services have no subtype."
            : `Pick a ${item.kind} subtype.`,
      });
    if (item.kind === "consumable" && !item.consumable)
      ctx.addIssue({
        code: "custom",
        path: ["consumable"],
        message: "Purchase details are required.",
      });
    for (const kind of itemKindSchema.options)
      if (kind !== item.kind && item[kind])
        ctx.addIssue({
          code: "custom",
          path: [kind],
          message: `Only ${kind} items have ${kind} details.`,
        });
    if (item.consumable?.purchaseUnit === "case" && !item.consumable.packCount)
      ctx.addIssue({
        code: "custom",
        path: ["consumable", "packCount"],
        message: "Enter how many are in a case.",
      });
  });
export type ItemInput = z.input<typeof itemInputSchema>;
export type ItemInputParsed = z.output<typeof itemInputSchema>;

export const stockLevelSchema = z.object({
  sectionId: id,
  sectionName: z.string(),
  quantity: z.number(),
});
export const itemSchema = z.object({
  id,
  kind: itemKindSchema,
  subtype: z.string().nullable(),
  code: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  unit: unitSchema,
  group: z.string(),
  color: z.string(),
  tier: z.string(),
  ratio: ratioSchema.nullable(),
  active: z.boolean(),
  rental: rentalDetailsSchema.nullable(),
  consumable: consumableDetailsInputSchema
    .extend({
      // null, with costHidden, when the caller isn't FT+.
      unitCostCents: z.number().int().nullable(),
      costHidden: z.boolean(),
      storageSectionName: z.string().nullable(),
    })
    .nullable(),
  service: serviceDetailsSchema.nullable(),
  // Per-section quantities; services never have stock.
  stock: z.array(stockLevelSchema),
  totalQuantity: z.number(),
  // null without a par level.
  belowPar: z.boolean().nullable(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type InventoryItem = z.infer<typeof itemSchema>;

// Sections (FLOW-70): where stock lives. Rental sections hold rentals (Vendor means
// sub-rented); storage sections hold consumables.
export const sectionKindSchema = z.enum(["rental", "consumable"]);
export type SectionKind = z.infer<typeof sectionKindSchema>;
export const sectionKindLabels: Record<SectionKind, string> = {
  rental: "Rental sections",
  consumable: "Storage sections",
};
export const sectionInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  kind: sectionKindSchema,
});
export const sectionRenameSchema = sectionInputSchema.pick({ name: true });
export const sectionSchema = z.object({
  id,
  name: z.string(),
  kind: sectionKindSchema,
  totalQuantity: z.number(),
  archivedAt: timestamp.nullable(),
});
export type Section = z.infer<typeof sectionSchema>;
export const sectionKindFor = (kind: ItemKind): SectionKind | null =>
  kind === "service" ? null : kind;

export const transferInputSchema = z
  .object({
    fromSectionId: id,
    toSectionId: id,
    quantity: quantity.positive("Enter a quantity above zero."),
    note: text(500).default(""),
  })
  .refine((transfer) => transfer.fromSectionId !== transfer.toSectionId, {
    message: "Pick two different sections.",
    path: ["toSectionId"],
  });
export type TransferInput = z.input<typeof transferInputSchema>;
// Sets a section's counted quantity; the difference is recorded as an adjustment.
export const countInputSchema = z.object({
  sectionId: id,
  quantity,
  note: text(500).default(""),
});
export type CountInput = z.input<typeof countInputSchema>;

// The item's conversions, in the shape the units helper takes.
export const conversionsOf = (
  consumable: Pick<
    NonNullable<InventoryItem["consumable"]>,
    "packCount" | "eachSize"
  > | null,
): ItemConversions => ({
  packCount: consumable?.packCount ?? null,
  eachSize: consumable?.eachSize ?? null,
});

// FLOW-81 AC2: a recipe using an ingredient in a unit its stock or purchase unit
// can't reach is flagged, never silently costed.
export function recipeUnitProblem(
  item: Pick<InventoryItem, "unit"> & {
    consumable: Pick<
      NonNullable<InventoryItem["consumable"]>,
      "packCount" | "eachSize" | "purchaseUnit"
    > | null;
  },
  recipeUnit: Unit,
): string | null {
  if (!item.consumable) return null;
  const conversions = conversionsOf(item.consumable);
  for (const unit of [item.consumable.purchaseUnit, item.unit]) {
    const result = convert(1, recipeUnit, unit, conversions);
    if (!result.ok) return result.message;
  }
  return null;
}
