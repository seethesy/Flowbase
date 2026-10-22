import { z } from "zod";

// Units of measure (FLOW-51). One helper converts recipe, stock and purchase units
// for costing and ordering. Each standard unit is defined by its size in its
// dimension's base unit (each, gram, millilitre). "case" has no standard size: an
// item's pack count defines it. Count ↔ weight or volume needs the item's "one each
// is about" size; weight ↔ volume never converts. Nothing is ever guessed.
export const unitSchema = z.enum([
  "each",
  "dozen",
  "case",
  "oz",
  "lb",
  "g",
  "kg",
  "tsp",
  "tbsp",
  "cup",
  "fl_oz",
  "qt",
  "gal",
  "ml",
  "l",
]);
export type Unit = z.infer<typeof unitSchema>;
export type Dimension = "count" | "weight" | "volume";

const FL_OZ_ML = 29.5735295625;
const OZ_G = 28.349523125;
export const units: Record<
  Unit,
  { label: string; dimension: Dimension; base: number | null }
> = {
  each: { label: "each", dimension: "count", base: 1 },
  dozen: { label: "dozen", dimension: "count", base: 12 },
  case: { label: "case", dimension: "count", base: null },
  oz: { label: "oz", dimension: "weight", base: OZ_G },
  lb: { label: "lb", dimension: "weight", base: 16 * OZ_G },
  g: { label: "g", dimension: "weight", base: 1 },
  kg: { label: "kg", dimension: "weight", base: 1000 },
  tsp: { label: "tsp", dimension: "volume", base: FL_OZ_ML / 6 },
  tbsp: { label: "tbsp", dimension: "volume", base: FL_OZ_ML / 2 },
  cup: { label: "cup", dimension: "volume", base: 8 * FL_OZ_ML },
  fl_oz: { label: "fl oz", dimension: "volume", base: FL_OZ_ML },
  qt: { label: "qt", dimension: "volume", base: 32 * FL_OZ_ML },
  gal: { label: "gal", dimension: "volume", base: 128 * FL_OZ_ML },
  ml: { label: "ml", dimension: "volume", base: 1 },
  l: { label: "l", dimension: "volume", base: 1000 },
};
export const unitLabel = (unit: Unit) => units[unit].label;

// What an item adds to the standard table: how many "each" are in a case (e.g. 12
// bottles), and what one "each" weighs or holds (750 ml, or a chicken breast ≈ 8 oz).
export type ItemConversions = {
  packCount?: number | null;
  eachSize?: { quantity: number; unit: Unit } | null;
};

export type Conversion =
  | { ok: true; value: number }
  | { ok: false; reason: "cannot_convert"; message: string };

// Six decimal places hides float noise such as 23.999999999999996.
const tidy = (value: number) => Math.round(value * 1e6) / 1e6;

// Size of one `unit` in its dimension's base unit, or null when the item doesn't
// say (a case without a pack count).
function baseSize(unit: Unit, item: ItemConversions): number | null {
  if (unit === "case") return item.packCount ? item.packCount : null;
  return units[unit].base;
}

// How many base units of `dimension` one "each" of the item is, if known.
function eachIn(dimension: Dimension, item: ItemConversions): number | null {
  if (dimension === "count") return 1;
  const size = item.eachSize;
  if (!size || size.quantity <= 0 || units[size.unit].dimension !== dimension)
    return null;
  const base = units[size.unit].base;
  return base === null ? null : size.quantity * base;
}

export function convert(
  quantity: number,
  from: Unit,
  to: Unit,
  item: ItemConversions = {},
): Conversion {
  const cannot = (): Conversion => ({
    ok: false,
    reason: "cannot_convert",
    message: `Can't convert ${unitLabel(from)} to ${unitLabel(to)} for this item.`,
  });
  const fromBase = baseSize(from, item);
  const toBase = baseSize(to, item);
  if (fromBase === null || toBase === null) return cannot();
  const fromDimension = units[from].dimension;
  const toDimension = units[to].dimension;
  let base = quantity * fromBase;
  if (fromDimension !== toDimension) {
    // Bridge through "each": the only per-item link between dimensions.
    const fromEach = eachIn(fromDimension, item);
    const toEach = eachIn(toDimension, item);
    if (fromEach === null || toEach === null) return cannot();
    base = (base / fromEach) * toEach;
  }
  return { ok: true, value: tidy(base / toBase) };
}

// Whole purchase units to order to cover `quantity` (FLOW-51 AC3): always rounds up,
// so 30 oz of something sold by the pound is 2 lb, never 1.
export function orderQuantity(
  quantity: number,
  unit: Unit,
  purchaseUnit: Unit,
  item: ItemConversions = {},
): Conversion {
  const converted = convert(quantity, unit, purchaseUnit, item);
  if (!converted.ok) return converted;
  return { ok: true, value: Math.max(0, Math.ceil(converted.value)) };
}

// Units a quantity of `unit` can be converted to for this item, for pickers.
export const compatibleUnits = (unit: Unit, item: ItemConversions = {}) =>
  unitSchema.options.filter((other) => convert(1, unit, other, item).ok);
