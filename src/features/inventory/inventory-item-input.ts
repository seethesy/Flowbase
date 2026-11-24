import {
  barSubcategories,
  type BarContainer,
  type InventoryItem,
  type ItemInput,
  type ItemKind,
  type RatioBasis,
} from "../../../shared/inventory";
import type { Unit } from "../../../shared/units";

// The inventory item form's state and the pure builder that turns it into the
// API input (FLOW-317), kept apart from the form so each item kind's input can be
// unit-tested.

const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
const toCents = (value: string) =>
  value.trim() === "" ? null : Math.round(Number(value) * 100);
export const toNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);
export const numberText = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

export type FieldName =
  | "code"
  | "name"
  | "category"
  | "description"
  | "unit"
  | "group"
  | "color"
  | "tier"
  | "ratioQuantity"
  | "ratioBasis"
  | "price"
  | "priceBasis"
  | "internalCost"
  | "replacementCost"
  | "rentalVendorId"
  | "vendorCost"
  | "leadTimeDays"
  | "dimensions"
  | "notes"
  | "assemblyNotes"
  | "bufferDaysBefore"
  | "bufferDaysAfter"
  | "colors"
  | "purchaseUnit"
  | "packCount"
  | "eachSizeQuantity"
  | "eachSizeUnit"
  | "recipeUnit"
  | "unitCost"
  | "preferredVendor"
  | "preferredVendorId"
  | "parLevel"
  | "storageSectionId"
  | "storageOrder"
  | "brand"
  | "subcategory"
  | "container";

export type ItemFields = Record<FieldName, string>;
type ServiceDetails = NonNullable<InventoryItem["service"]>;
export type IncludedLine = ServiceDetails["includes"][number];
export type ServiceAddon = ServiceDetails["addons"][number];

export const initialItemFields = (item: InventoryItem | undefined): ItemFields => ({
  code: item?.code ?? "",
  name: item?.name ?? "",
  category: item?.category ?? "",
  description: item?.description ?? "",
  unit: item?.unit ?? "each",
  group: item?.group ?? "",
  color: item?.color ?? "",
  tier: item?.tier ?? "",
  ratioQuantity: numberText(item?.ratio?.quantity),
  ratioBasis: item?.ratio?.basis ?? "per_guest",
  price: dollars(item?.rental?.priceCents ?? item?.service?.priceCents),
  priceBasis: item?.service?.priceBasis ?? "per_event",
  internalCost: dollars(item?.rental?.internalCostCents),
  replacementCost: dollars(item?.rental?.replacementCostCents),
  rentalVendorId: item?.rental?.vendorId ?? "",
  vendorCost: dollars(item?.rental?.vendorCostCents),
  leadTimeDays: numberText(item?.rental?.leadTimeDays),
  dimensions: item?.rental?.dimensions ?? "",
  notes: item?.rental?.notes ?? "",
  assemblyNotes: item?.rental?.assemblyNotes ?? "",
  bufferDaysBefore: String(item?.rental?.bufferDaysBefore ?? 1),
  bufferDaysAfter: String(item?.rental?.bufferDaysAfter ?? 1),
  colors: item?.rental?.colors.join("\n") ?? "",
  purchaseUnit: item?.consumable?.purchaseUnit ?? "each",
  packCount: numberText(item?.consumable?.packCount),
  eachSizeQuantity: numberText(item?.consumable?.eachSize?.quantity),
  eachSizeUnit: item?.consumable?.eachSize?.unit ?? "",
  recipeUnit: item?.consumable?.recipeUnit ?? "",
  unitCost: dollars(item?.consumable?.unitCostCents),
  preferredVendor: item?.consumable?.preferredVendor ?? "",
  preferredVendorId: item?.consumable?.preferredVendorId ?? "",
  parLevel: numberText(item?.consumable?.parLevel),
  storageSectionId: item?.consumable?.storageSectionId ?? "",
  storageOrder: numberText(item?.consumable?.storageOrder),
  brand: item?.bar?.brand ?? "",
  subcategory: item?.bar?.subcategory ?? "",
  container: item?.bar?.container ?? "",
});

// What a consumable's purchase unit, pack and each size are, for the recipe-unit
// check (FLOW-81) and the saved input.
export const consumableDraft = (fields: ItemFields) => ({
  purchaseUnit: fields.purchaseUnit as Unit,
  packCount: toNumber(fields.packCount),
  eachSize:
    fields.eachSizeQuantity && fields.eachSizeUnit
      ? {
          quantity: Number(fields.eachSizeQuantity),
          unit: fields.eachSizeUnit as Unit,
        }
      : null,
});

export type ItemFormState = {
  kind: ItemKind;
  subtype: string;
  fields: ItemFields;
  categoryId: string;
  typeId: string;
  active: boolean;
  quoted: boolean;
  includes: IncludedLine[];
  addons: ServiceAddon[];
  housePick: boolean;
  // Allergens are set on dishes, not ingredients (FLOW-95); an item keeps any it
  // already has.
  allergens: NonNullable<InventoryItem["consumable"]>["allergens"];
  // Who is saving: rental costs are sent only when the user can see them, and a
  // consumable's hidden cost is left alone.
  rentalCostsVisible: boolean;
  costHidden: boolean;
};

export function buildItemInput(state: ItemFormState): ItemInput {
  const { kind, subtype, fields, includes, addons, quoted, rentalCostsVisible } = state;
  const isBar = kind === "consumable" && subtype === "bar";
  // Bar stock has no storage on screen (FLOW-291).
  const storageSectionId = isBar ? "" : fields.storageSectionId;
  const ratioQuantity = toNumber(fields.ratioQuantity);
  return {
    kind,
    subtype: kind === "service" ? null : subtype,
    code: fields.code,
    name: fields.name,
    category: fields.category,
    categoryId: state.categoryId || null,
    typeId: state.typeId || null,
    description: fields.description,
    unit: fields.unit as Unit,
    group: fields.group,
    color: fields.color,
    tier: fields.tier,
    ratio: ratioQuantity
      ? { quantity: ratioQuantity, basis: fields.ratioBasis as RatioBasis }
      : null,
    active: state.active,
    ...(kind === "rental" && {
      rental: {
        priceCents: toCents(fields.price),
        ...(rentalCostsVisible && {
          internalCostCents: toCents(fields.internalCost),
          replacementCostCents: toCents(fields.replacementCost),
        }),
        dimensions: fields.dimensions,
        notes: fields.notes,
        assemblyNotes: fields.assemblyNotes,
        bufferDaysBefore: Number(fields.bufferDaysBefore),
        bufferDaysAfter: Number(fields.bufferDaysAfter),
        // Sub-rental (FLOW-75).
        vendorId: fields.rentalVendorId || null,
        leadTimeDays: fields.rentalVendorId
          ? toNumber(fields.leadTimeDays)
          : null,
        ...(rentalCostsVisible && {
          vendorCostCents: fields.rentalVendorId
            ? toCents(fields.vendorCost)
            : null,
        }),
        colors: fields.colors
          .split("\n")
          .map((color) => color.trim())
          .filter(Boolean),
        components:
          subtype === "decor"
            ? includes.map(({ itemId, quantity }) => ({ itemId, quantity }))
            : [],
      },
    }),
    ...(kind === "service" && {
      service: {
        priceCents: quoted ? null : toCents(fields.price),
        priceBasis: fields.priceBasis as RatioBasis,
        pricedByQuote: quoted,
        includes,
        addons,
      },
    }),
    ...(kind === "consumable" && {
      consumable: {
        ...consumableDraft(fields),
        recipeUnit: (fields.recipeUnit || null) as Unit | null,
        ...(!state.costHidden && { unitCostCents: toCents(fields.unitCost) }),
        preferredVendor: fields.preferredVendor,
        preferredVendorId: fields.preferredVendorId || null,
        parLevel: toNumber(fields.parLevel),
        allergens: state.allergens,
        storageSectionId: storageSectionId || null,
        storageOrder: toNumber(fields.storageOrder),
      },
    }),
    ...(isBar && {
      bar: {
        brand: fields.brand,
        subcategory: barSubcategories[fields.category]?.includes(
          fields.subcategory,
        )
          ? fields.subcategory
          : "",
        container: (fields.container || null) as BarContainer | null,
        housePick: state.housePick,
      },
    }),
  };
}
