import { Dropdown } from "../components/ui/Dropdown";
import { useState, type ReactNode } from "react";
import { isFtPlus } from "../../shared/access";
import { AlertTriangle } from "lucide-react";
import {
  barCategories,
  barContainerLabels,
  barContainerSchema,
  barSubcategories,
  barTierLabels,
  barTierSchema,
  itemKindSchema,
  ratioBasisLabels,
  ratioBasisSchema,
  recipeUnitProblem,
  subtypesByKind,
  type BarContainer,
  type InventoryItem,
  type ItemInput,
  type ItemKind,
  type RatioBasis,
  type Section as StockSection,
} from "../../shared/inventory";
import { unitLabel, unitSchema, type Unit } from "../../shared/units";
import { allPages, inventoryApi, inventoryChangesApi, sectionsApi } from "../services/core";
import { StaleReload, isStale } from "../components/stale-reload";
import { vendorsApi } from "../services/vendors";
import { useResource } from "../app/useResource";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { useShownFields } from "../app/field-card";
import { kindLabels, subtypeLabel } from "./inventory-labels";
import { ListSuggestions } from "./list-fields";
import { useBusinessSettings } from "../services/settings";
import { inventoryCategoryList } from "../../shared/settings";
import { usePermissions } from "../app/permissions";
import { canSeeRentalCosts } from "../../shared/visibility";
import { CatalogIncludes } from "./inventory-includes";
import { RoundCheck } from "../components/ui/round-check";
import { T, LabelT } from "../app/copy";

const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
const toCents = (value: string) =>
  value.trim() === "" ? null : Math.round(Number(value) * 100);
export const toNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);
const numberText = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

function UnitSelect({
  label,
  value,
  onChange,
  optional,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  optional?: string;
}) {
  return (
    <FormField label={label}>
      <Dropdown value={value} onChange={(e) => onChange(e.target.value)}>
        {optional && <option value="">{optional}</option>}
        {unitSchema.options.map((unit) => (
          <option key={unit} value={unit}>
            {unitLabel(unit)}
          </option>
        ))}
      </Dropdown>
    </FormField>
  );
}

type FieldName =
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

type ItemFormProps = {
  item?: InventoryItem;
  preset?: { kind: ItemKind; subtype: string };
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
};

// Edits reload the current version when the save was made from a stale copy
// (FLOW-186).
export function ItemForm(props: ItemFormProps) {
  return (
    <StaleReload
      record={props.item}
      load={(id) => inventoryApi.get(id)}
      what="item"
    >
      {({ record, conflict, onStale }) => (
        <ItemFormFields
          key={record?.updatedAt ?? "new"}
          {...props}
          item={record}
          conflict={conflict}
          onStale={onStale}
        />
      )}
    </StaleReload>
  );
}

function ItemFormFields({
  item,
  preset,
  onClose,
  onSaved,
  conflict,
  onStale,
}: ItemFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const shownFacts = useShownFields("inventory.detail", "item-facts");
  const shows = (field: string) => !item || shownFacts(field);
  const [kind, setKind] = useState<ItemKind>(
    item?.kind ?? preset?.kind ?? "rental",
  );
  const [subtype, setSubtype] = useState(
    item?.subtype ?? preset?.subtype ?? "equipment",
  );
  const [fields, setFields] = useState<Record<FieldName, string>>(() => ({
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
  }));
  // The item reordered when its tier runs short (FLOW-170).
  const [housePick, setHousePick] = useState(item?.bar?.housePick ?? false);
  // A new bar item is kept in Bar Storage unless the user picks another section.
  const [storageTouched, setStorageTouched] = useState(Boolean(item));
  // Allergens are set on dishes, not ingredients (FLOW-95); an item keeps any it
  // already has.
  const allergens = item?.consumable?.allergens ?? [];
  const [active, setActive] = useState(item?.active ?? true);
  const [quoted, setQuoted] = useState(item?.service?.pricedByQuote ?? false);
  const [includes, setIncludes] = useState(
    item?.service?.includes ??
      item?.rental?.components.map((line) => ({
        ...line,
        basis: "per_event" as const,
      })) ??
      [],
  );
  const [addons, setAddons] = useState(item?.service?.addons ?? []);
  const { actor, can } = usePermissions();
  const rentalCostsVisible = actor !== null && canSeeRentalCosts(actor);
  const priceNeedsApproval =
    Boolean(item) && !can("rentals.apply_directly");
  // An existing item whose cost came back hidden: the user isn't FT+, so the form
  // leaves the cost alone.
  const costHidden = item?.consumable?.costHidden ?? false;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const storage = useResource(
    ["sections", kind === "consumable" ? { kind: "consumable" } : "none"],
    () =>
      kind === "consumable"
        ? sectionsApi.list({ kind: "consumable" })
        : Promise.resolve([] as StockSection[]),
    { reference: true },
  );
  // The vendor directory (FLOW-84), for sub-rentals and preferred vendors.
  const vendors = useResource(
    ["vendors", "options"],
    () => allPages((cursor) => vendorsApi.list({}, cursor)),
    { reference: true },
  );
  const vendorOptions = (vendors.data ?? []).filter(
    (vendor) =>
      vendor.id === fields.rentalVendorId ||
      vendor.id === fields.preferredVendorId ||
      !vendor.archivedAt,
  );
  const set = (key: FieldName) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const isBar = kind === "consumable" && subtype === "bar";
  // Category suggestions and per-category ratio defaults (FLOW-45).
  const settings = useBusinessSettings();
  const categoryList = inventoryCategoryList({
    kind,
    subtype: kind === "service" ? null : subtype,
  });
  const pickCategory = set("category");
  const defaultRatio = settings.defaults.ratioDefaults.find(
    (row) =>
      row.category.toLowerCase() === fields.category.trim().toLowerCase(),
  );
  const storageSectionId = storageTouched
    ? fields.storageSectionId
    : fields.storageSectionId ||
      (isBar
        ? ((storage.data ?? []).find(
            (section) => section.name === "Bar Storage",
          )?.id ?? "")
        : subtype === "supply"
          ? ((storage.data ?? []).find((section) => section.name === "Supplies")
              ?.id ?? "")
          : "");
  const input = (key: FieldName, props: { type?: string } = {}) => (
    <input
      type={props.type ?? "text"}
      step={props.type === "number" ? "any" : undefined}
      value={fields[key]}
      onChange={(e) => set(key)(e.target.value)}
    />
  );
  const eachSize =
    fields.eachSizeQuantity && fields.eachSizeUnit
      ? {
          quantity: Number(fields.eachSizeQuantity),
          unit: fields.eachSizeUnit as Unit,
        }
      : null;
  const consumableDraft = {
    purchaseUnit: fields.purchaseUnit as Unit,
    packCount: toNumber(fields.packCount),
    eachSize,
  };
  // FLOW-81 AC2: flag a recipe unit this ingredient can't be converted to.
  const conversionProblem =
    kind === "consumable" && fields.recipeUnit
      ? recipeUnitProblem(
          { unit: fields.unit as Unit, consumable: consumableDraft },
          fields.recipeUnit as Unit,
        )
      : null;
  const save = async () => {
    if (!fields.name.trim()) return setError("Name is required.");
    const ratioQuantity = toNumber(fields.ratioQuantity);
    const payload: ItemInput = {
      kind,
      subtype: kind === "service" ? null : subtype,
      code: fields.code,
      name: fields.name,
      category: fields.category,
      description: fields.description,
      unit: fields.unit as Unit,
      group: fields.group,
      color: fields.color,
      tier: fields.tier,
      ratio: ratioQuantity
        ? { quantity: ratioQuantity, basis: fields.ratioBasis as RatioBasis }
        : null,
      active,
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
          ...consumableDraft,
          recipeUnit: (fields.recipeUnit || null) as Unit | null,
          ...(!costHidden && { unitCostCents: toCents(fields.unitCost) }),
          preferredVendor: fields.preferredVendor,
          preferredVendorId: fields.preferredVendorId || null,
          parLevel: toNumber(fields.parLevel),
          allergens,
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
          housePick,
        },
      }),
    };
    setSaving(true);
    setError("");
    try {
      if (kind !== "consumable" && !can("rentals.apply_directly")) {
        if (!actor || !isFtPlus(actor)) throw new Error("Only full-time staff can propose Master inventory changes.");
        await inventoryChangesApi.submit(item
          ? [{ type: "replace", itemId: item.id, item: payload }]
          : [{ type: "create", item: payload }]);
        setNotice("Submitted for Admin approval. The published item is unchanged until approval.");
        return;
      }
      onSaved(
        item
          ? await inventoryApi.update(item.id, {
              ...payload,
              updatedAt: item.updatedAt,
            })
          : await inventoryApi.create(payload),
      );
      onClose();
    } catch (e) {
      if (item && isStale(e)) {
        await onStale();
        return;
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const subtypes: readonly string[] = subtypesByKind[kind];
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={
        item
          ? <T id="inventory-item-form.item-form-fields.edit-item">Edit item</T>
          : preset
            ? `New ${preset.subtype === "bar" ? "bar item" : preset.subtype}`
            : <T id="inventory-item-form.item-form-fields.new-item">New item</T>
      }
      description={<T id="inventory-item-form.item-form-fields.saved-to-flowbase">Saved to Flowbase.</T>}
      wide
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {conflict && (
          <p role="alert" className="error-message">
            {conflict}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {notice && <p role="status" className="success-message">{notice}</p>}
        <div className="form-grid">
          <FormField label={<T id="inventory-item-form.item-form-fields.name">Name *</T>}>
            <input
              value={fields.name}
              onChange={(e) => set("name")(e.target.value)}
              autoFocus
            />
          </FormField>
          {shows("code") && (<FormField label={<T id="inventory-item-form.item-form-fields.code-sku">Code / SKU</T>}>{input("code")}</FormField>)}
          {!item && !preset && (
            <FormField label={<T id="inventory-item-form.item-form-fields.kind">Kind</T>}>
              <Dropdown
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as ItemKind;
                  setKind(next);
                  const options: readonly string[] = subtypesByKind[next];
                  setSubtype(options[0] ?? "");
                }}
              >
                {itemKindSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {kindLabels[option]}
                  </option>
                ))}
              </Dropdown>
            </FormField>
          )}
          {subtypes.length > 0 && !preset && (
            <FormField label={<T id="inventory-item-form.item-form-fields.subtype">Subtype</T>}>
              <Dropdown
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
              >
                {subtypes.map((option) => (
                  <option key={option} value={option}>
                    {subtypeLabel(option)}
                  </option>
                ))}
              </Dropdown>
            </FormField>
          )}
          {isBar ? (
            <>
              <FormField label={<T id="inventory-item-form.item-form-fields.category">Category</T>}>
                <Dropdown
                  value={fields.category}
                  onChange={(e) => pickCategory(e.target.value)}
                >
                  <option value="">Pick one</option>
                  {barCategories.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </Dropdown>
              </FormField>
              {barSubcategories[fields.category] && (
                <FormField label={<T id="inventory-item-form.item-form-fields.subcategory">Subcategory</T>}>
                  <Dropdown
                    value={fields.subcategory}
                    onChange={(e) => set("subcategory")(e.target.value)}
                  >
                    <option value="">Not set</option>
                    {barSubcategories[fields.category].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </Dropdown>
                </FormField>
              )}
              <FormField label={<T id="inventory-item-form.item-form-fields.brand-varietal">Brand / varietal</T>} hint={<T id="inventory-item-form.item-form-fields.e-g-pinot-grigio">e.g. Pinot Grigio</T>}>
                {input("brand")}
              </FormField>
            </>
          ) : (
            <FormField label={<T id="inventory-item-form.item-form-fields.category">Category</T>}>
              <input
                list="item-categories"
                value={fields.category}
                onChange={(e) => pickCategory(e.target.value)}
              />
              {categoryList && (
                <ListSuggestions id="item-categories" list={categoryList} />
              )}
            </FormField>
          )}
          {kind !== "service" && (
            <UnitSelect
              label={<T id="inventory-item-form.item-form-fields.stock-unit">Stock unit</T>}
              value={fields.unit}
              onChange={set("unit")}
            />
          )}
          {shows("group") && (<FormField label={<T id="inventory-item-form.item-form-fields.group">Group</T>} hint={<T id="inventory-item-form.item-form-fields.e-g-table-linens">e.g. Table Linens</T>}>
            {input("group")}
          </FormField>)}
          {isBar ? (
            <>
              <FormField label={<T id="inventory-item-form.item-form-fields.tier">Tier</T>}>
                <Dropdown
                  value={fields.tier}
                  onChange={(e) => set("tier")(e.target.value)}
                >
                  <option value="">Not set</option>
                  {barTierSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {barTierLabels[option]}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              <FormField label={<T id="inventory-item-form.item-form-fields.container">Container</T>}>
                <Dropdown
                  value={fields.container}
                  onChange={(e) => set("container")(e.target.value)}
                >
                  <option value="">Not set</option>
                  {barContainerSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {barContainerLabels[option]}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              <FormField
                label={<T id="inventory-item-form.item-form-fields.house-pick">House pick</T>}
                hint={<T id="inventory-item-form.item-form-fields.reordered-when-an-event-s">{"Reordered when an event's tier runs short"}</T>}
              >
                <RoundCheck
                  aria-label="House pick for its tier"
                  checked={housePick}
                  onChange={(e) => setHousePick(e.target.checked)}
                />
              </FormField>
            </>
          ) : (
            <FormField label={<T id="inventory-item-form.item-form-fields.tier">Tier</T>} hint={<T id="inventory-item-form.item-form-fields.e-g-standard-premium">e.g. Standard, Premium</T>}>
              {input("tier")}
            </FormField>
          )}
          <FormField label={<T id="inventory-item-form.item-form-fields.color-finish">Color / finish</T>}>{input("color")}</FormField>
        </div>
        {shows("description") && (<FormField label={<T id="inventory-item-form.item-form-fields.description">Description</T>}>
          <textarea
            rows={2}
            value={fields.description}
            onChange={(e) => set("description")(e.target.value)}
          />
        </FormField>)}
        <div className="form-grid">
          <FormField
            label={<T id="inventory-item-form.item-form-fields.ratio">Ratio</T>}
            hint={
              defaultRatio
                ? <T id="inventory-item-form.item-form-fields.leave-empty-to-use-category" values={{ quantity: defaultRatio.quantity, ratioBasisLabels: <LabelT id="labels.ratio-basis" value={defaultRatio.basis}>{ratioBasisLabels[defaultRatio.basis]}</LabelT> }}>{"Leave empty to use category default: {quantity} {ratioBasisLabels}"}</T>
                : <T id="inventory-item-form.item-form-fields.e-g-2-per-guest">e.g. 2 per guest; leave empty for category default</T>
            }
          >
            {input("ratioQuantity", { type: "number" })}
          </FormField>
          <FormField label={<T id="inventory-item-form.item-form-fields.ratio-basis">Ratio basis</T>}>
            <Dropdown
              value={fields.ratioBasis}
              onChange={(e) => set("ratioBasis")(e.target.value)}
            >
              {ratioBasisSchema.options.map((basis) => (
                <option key={basis} value={basis}>
                  {ratioBasisLabels[basis]}
                </option>
              ))}
            </Dropdown>
          </FormField>
        </div>
        {kind === "rental" && (
          <>
            <FormField
              label={<T id="inventory-item-form.item-form-fields.price-per-unit">Price ($ per unit)</T>}
              hint={
                priceNeedsApproval
                  ? <T id="inventory-item-form.item-form-fields.price-changes-will-be-submitted">Price changes will be submitted for Admin approval.</T>
                  : undefined
              }
            >
              <input
                type="number"
                step="0.01"
                value={fields.price}
                onChange={(e) => set("price")(e.target.value)}
              />
            </FormField>
            <div className="form-grid">
              {rentalCostsVisible && (
                <>
                  <FormField label={<T id="inventory-item-form.item-form-fields.internal-cost">Internal cost ($)</T>}>
                    {input("internalCost", { type: "number" })}
                  </FormField>
                  <FormField label={<T id="inventory-item-form.item-form-fields.replacement-cost">Replacement cost ($)</T>}>
                    {input("replacementCost", { type: "number" })}
                  </FormField>
                </>
              )}
              <FormField
                label={<T id="inventory-item-form.item-form-fields.rented-from">Rented from</T>}
                hint={<T id="inventory-item-form.item-form-fields.a-sub-rented-item-is">A sub-rented item is available on request, never owned stock.</T>}
              >
                <Dropdown
                  value={fields.rentalVendorId}
                  onChange={(e) => {
                    const vendor = vendorOptions.find(
                      (option) => option.id === e.target.value,
                    );
                    setFields((current) => ({
                      ...current,
                      rentalVendorId: e.target.value,
                      leadTimeDays:
                        current.leadTimeDays ||
                        numberText(vendor?.leadTimeDays),
                    }));
                  }}
                >
                  <option value="">Owned (not sub-rented)</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              {fields.rentalVendorId && (
                <>
                  {rentalCostsVisible && (
                    <FormField label={<T id="inventory-item-form.item-form-fields.vendor-cost-per-unit">Vendor cost ($ per unit)</T>}>
                      {input("vendorCost", { type: "number" })}
                    </FormField>
                  )}
                  <FormField label={<T id="inventory-item-form.item-form-fields.lead-time-days">Lead time (days)</T>}>
                    {input("leadTimeDays", { type: "number" })}
                  </FormField>
                </>
              )}
              <FormField label={<T id="inventory-item-form.item-form-fields.dimensions">Dimensions</T>}>{input("dimensions")}</FormField>
              <FormField label={<T id="inventory-item-form.item-form-fields.buffer-days-before">Buffer days before</T>}>
                {input("bufferDaysBefore", { type: "number" })}
              </FormField>
              <FormField label={<T id="inventory-item-form.item-form-fields.buffer-days-after">Buffer days after</T>}>
                {input("bufferDaysAfter", { type: "number" })}
              </FormField>
              <FormField label={<T id="inventory-item-form.item-form-fields.assembly-notes">Assembly notes</T>}>
                {input("assemblyNotes")}
              </FormField>
              <FormField label={<T id="inventory-item-form.item-form-fields.notes">Notes</T>}>{input("notes")}</FormField>
              <FormField
                label={<T id="inventory-item-form.item-form-fields.colors">Colors</T>}
                hint={<T id="inventory-item-form.item-form-fields.one-color-per-line-stock">One color per line. Stock is tracked separately for each color.</T>}
              >
                <textarea
                  value={fields.colors}
                  onChange={(e) => set("colors")(e.target.value)}
                  rows={3}
                />
              </FormField>
            </div>
          </>
        )}
        {kind === "service" && (
          <>
            <label className="checkbox-filter">
              <RoundCheck
                checked={quoted}
                onChange={(e) => setQuoted(e.target.checked)}
              />
              <T id="inventory-item-form.item-form-fields.priced-by-quote">Priced by quote</T>
            </label>
            {!quoted && (
              <div className="form-grid">
                <FormField label={<T id="inventory-item-form.item-form-fields.price">Price ($)</T>}>
                  {input("price", { type: "number" })}
                </FormField>
                <FormField label={<T id="inventory-item-form.item-form-fields.priced">Priced</T>}>
                  <Dropdown
                    value={fields.priceBasis}
                    onChange={(e) => set("priceBasis")(e.target.value)}
                  >
                    {["per_event", "per_guest"].map((basis) => (
                      <option key={basis} value={basis}>
                        {ratioBasisLabels[basis as RatioBasis]}
                      </option>
                    ))}
                  </Dropdown>
                </FormField>
              </div>
            )}
            <h3 className="form-subheading"><T id="inventory-item-form.item-form-fields.per-person-add-ons">Per-person add-ons</T></h3>
            {addons.map((addon, index) => (
              <div className="form-grid" key={index}>
                <FormField label={<T id="inventory-item-form.item-form-fields.add-on-name" values={{ value: index + 1 }}>{"Add-on {value} name"}</T>}>
                  <input
                    value={addon.name}
                    onChange={(e) =>
                      setAddons(
                        addons.map((row, i) =>
                          i === index ? { ...row, name: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <FormField label={<T id="inventory-item-form.item-form-fields.add-on-price-per-guest" values={{ value: index + 1 }}>{"Add-on {value} price ($ per guest)"}</T>}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={addon.priceCents / 100}
                    onChange={(e) =>
                      setAddons(
                        addons.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                priceCents: Math.round(
                                  Number(e.target.value) * 100,
                                ),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                </FormField>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setAddons(addons.filter((_, i) => i !== index))
                  }
                >
                  <T id="inventory-item-form.item-form-fields.remove-add-on" values={{ value: index + 1 }}>{"Remove add-on {value}"}</T>
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setAddons([...addons, { name: "", priceCents: 0 }])
              }
            >
              <T id="inventory-item-form.item-form-fields.add-per-person-add-on">Add per-person add-on</T>
            </Button>
          </>
        )}
        {(kind === "service" || (kind === "rental" && subtype === "decor")) && (
          <CatalogIncludes
            itemId={item?.id}
            service={kind === "service"}
            value={includes}
            onChange={setIncludes}
          />
        )}
        {kind === "consumable" && (
          <>
            <h3 className="form-subheading"><T id="inventory-item-form.item-form-fields.purchasing-and-units">Purchasing and units</T></h3>
            <div className="form-grid">
              <UnitSelect
                label={<T id="inventory-item-form.item-form-fields.purchase-unit">Purchase unit</T>}
                value={fields.purchaseUnit}
                onChange={set("purchaseUnit")}
              />
              {fields.purchaseUnit === "case" && (
                <FormField label={<T id="inventory-item-form.item-form-fields.items-per-case">Items per case</T>}>
                  {input("packCount", { type: "number" })}
                </FormField>
              )}
              <FormField
                label={<T id="inventory-item-form.item-form-fields.one-each-is-about">One each is about</T>}
                hint={<T id="inventory-item-form.item-form-fields.e-g-750-ml-a">e.g. 750 ml a bottle, or 8 oz a chicken breast</T>}
              >
                {input("eachSizeQuantity", { type: "number" })}
              </FormField>
              <UnitSelect
                label={<T id="inventory-item-form.item-form-fields.each-size-unit">Each size unit</T>}
                value={fields.eachSizeUnit}
                onChange={set("eachSizeUnit")}
                optional="Not set"
              />
              <UnitSelect
                label={<T id="inventory-item-form.item-form-fields.recipe-unit">Recipe unit</T>}
                value={fields.recipeUnit}
                onChange={set("recipeUnit")}
                optional="Not set"
              />
              {costHidden ? (
                <p className="muted">
                  <T id="inventory-item-form.item-form-fields.costs-are-visible-to-full">Costs are visible to full-time staff only.</T>
                </p>
              ) : (
                <FormField
                  label={<T id="inventory-item-form.item-form-fields.unit-cost-per" values={{ unitLabel: unitLabel(fields.purchaseUnit as Unit) }}>{"Unit cost ($ per {unitLabel})"}</T>}
                >
                  {input("unitCost", { type: "number" })}
                </FormField>
              )}
              <FormField label={<T id="inventory-item-form.item-form-fields.vendor-directory">Vendor directory</T>}>
                <Dropdown
                  value={fields.preferredVendorId}
                  onChange={(e) => set("preferredVendorId")(e.target.value)}
                >
                  <option value="">Not in the directory</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              {!fields.preferredVendorId && (
                <FormField label={isBar ? <T id="inventory-item-form.item-form-fields.distributor">Distributor</T> : <T id="inventory-item-form.item-form-fields.preferred-vendor">Preferred vendor</T>}>
                  {input("preferredVendor")}
                </FormField>
              )}
              <FormField
                label={<T id="inventory-item-form.item-form-fields.par-level" values={{ unitLabel: unitLabel(fields.unit as Unit) }}>{"Par level ({unitLabel})"}</T>}
              >
                {input("parLevel", { type: "number" })}
              </FormField>
              <FormField label={<T id="inventory-item-form.item-form-fields.storage-section">Storage section</T>}>
                <Dropdown
                  value={storageSectionId}
                  onChange={(e) => {
                    setStorageTouched(true);
                    set("storageSectionId")(e.target.value);
                  }}
                >
                  <option value="">Not set</option>
                  {(storage.data ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              <FormField
                label={<T id="inventory-item-form.item-form-fields.shelf-order">Shelf order</T>}
                hint={<T id="inventory-item-form.item-form-fields.where-it-sits-in-the">Where it sits in the section; count mode follows this order</T>}
              >
                {input("storageOrder", { type: "number" })}
              </FormField>
            </div>
            {conversionProblem && (
              <p role="status" className="error-message">
                <AlertTriangle size={14} /><T id="inventory-item-form.item-form-fields.add-what-one-each-weighs" values={{ conversionProblem }}>{" {conversionProblem} Add what one each weighs or holds."}</T>
              </p>
            )}
          </>
        )}
        <label className="checkbox-filter">
          <RoundCheck
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <T id="inventory-item-form.item-form-fields.active">Active</T>
        </label>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="inventory-item-form.item-form-fields.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            {kind !== "consumable" && !can("rentals.apply_directly") ? <T id="inventory-item-form.item-form-fields.submit-for-approval">Submit for approval</T> : <T id="inventory-item-form.item-form-fields.save-item">Save item</T>}
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
