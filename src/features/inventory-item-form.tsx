import { useState } from "react";
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
import { inventoryApi, sectionsApi } from "../services/core";
import { useResource } from "../app/useResource";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { kindLabels, subtypeLabel } from "./inventory-labels";
import { ListSuggestions } from "./list-fields";
import { useBusinessSettings } from "../services/settings";
import { inventoryCategoryList } from "../../shared/settings";

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
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: string;
}) {
  return (
    <FormField label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {optional && <option value="">{optional}</option>}
        {unitSchema.options.map((unit) => (
          <option key={unit} value={unit}>
            {unitLabel(unit)}
          </option>
        ))}
      </select>
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
  | "purchaseUnit"
  | "packCount"
  | "eachSizeQuantity"
  | "eachSizeUnit"
  | "recipeUnit"
  | "unitCost"
  | "preferredVendor"
  | "parLevel"
  | "storageSectionId"
  | "storageOrder"
  | "brand"
  | "subcategory"
  | "container";

export function ItemForm({
  item,
  preset,
  onClose,
  onSaved,
}: {
  item?: InventoryItem;
  preset?: { kind: ItemKind; subtype: string };
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
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
    purchaseUnit: item?.consumable?.purchaseUnit ?? "each",
    packCount: numberText(item?.consumable?.packCount),
    eachSizeQuantity: numberText(item?.consumable?.eachSize?.quantity),
    eachSizeUnit: item?.consumable?.eachSize?.unit ?? "",
    recipeUnit: item?.consumable?.recipeUnit ?? "",
    unitCost: dollars(item?.consumable?.unitCostCents),
    preferredVendor: item?.consumable?.preferredVendor ?? "",
    parLevel: numberText(item?.consumable?.parLevel),
    storageSectionId: item?.consumable?.storageSectionId ?? "",
    storageOrder: numberText(item?.consumable?.storageOrder),
    brand: item?.bar?.brand ?? "",
    subcategory: item?.bar?.subcategory ?? "",
    container: item?.bar?.container ?? "",
  }));
  // A new bar item is kept in Bar Storage unless the user picks another section.
  const [storageTouched, setStorageTouched] = useState(Boolean(item));
  // Allergens are set on dishes, not ingredients (FLOW-95); an item keeps any it
  // already has.
  const allergens = item?.consumable?.allergens ?? [];
  const [active, setActive] = useState(item?.active ?? true);
  // An existing item whose cost came back hidden: the user isn't FT+, so the form
  // leaves the cost alone.
  const costHidden = item?.consumable?.costHidden ?? false;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const storage = useResource(
    () =>
      kind === "consumable"
        ? sectionsApi.list({ kind: "consumable" })
        : Promise.resolve([] as StockSection[]),
    [kind],
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
  const pickCategory = (category: string) =>
    setFields((current) => {
      const ratio = settings.defaults.ratioDefaults.find(
        (row) => row.category.toLowerCase() === category.trim().toLowerCase(),
      );
      // A new item without a ratio takes its category's default.
      return !item && ratio && !current.ratioQuantity
        ? {
            ...current,
            category,
            ratioQuantity: String(ratio.quantity),
            ratioBasis: ratio.basis,
          }
        : { ...current, category };
    });
  const storageSectionId = storageTouched
    ? fields.storageSectionId
    : fields.storageSectionId ||
      (isBar
        ? ((storage.data ?? []).find(
            (section) => section.name === "Bar Storage",
          )?.id ?? "")
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
        rental: { priceCents: toCents(fields.price) },
      }),
      ...(kind === "service" && {
        service: {
          priceCents: toCents(fields.price),
          priceBasis: fields.priceBasis as RatioBasis,
        },
      }),
      ...(kind === "consumable" && {
        consumable: {
          ...consumableDraft,
          recipeUnit: (fields.recipeUnit || null) as Unit | null,
          ...(!costHidden && { unitCostCents: toCents(fields.unitCost) }),
          preferredVendor: fields.preferredVendor,
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
        },
      }),
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        item
          ? await inventoryApi.update(item.id, payload)
          : await inventoryApi.create(payload),
      );
      onClose();
    } catch (e) {
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
          ? "Edit item"
          : preset
            ? `New ${preset.subtype === "bar" ? "bar item" : preset.subtype}`
            : "New item"
      }
      description="Saved to Flowbase."
      wide
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Name *">
            <input
              value={fields.name}
              onChange={(e) => set("name")(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField label="Code / SKU">{input("code")}</FormField>
          {!item && !preset && (
            <FormField label="Kind">
              <select
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
              </select>
            </FormField>
          )}
          {subtypes.length > 0 && !preset && (
            <FormField label="Subtype">
              <select
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
              >
                {subtypes.map((option) => (
                  <option key={option} value={option}>
                    {subtypeLabel(option)}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {isBar ? (
            <>
              <FormField label="Category">
                <select
                  value={fields.category}
                  onChange={(e) => pickCategory(e.target.value)}
                >
                  <option value="">Pick one</option>
                  {barCategories.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </FormField>
              {barSubcategories[fields.category] && (
                <FormField label="Subcategory">
                  <select
                    value={fields.subcategory}
                    onChange={(e) => set("subcategory")(e.target.value)}
                  >
                    <option value="">Not set</option>
                    {barSubcategories[fields.category].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </FormField>
              )}
              <FormField label="Brand / varietal" hint="e.g. Pinot Grigio">
                {input("brand")}
              </FormField>
            </>
          ) : (
            <FormField label="Category">
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
              label="Stock unit"
              value={fields.unit}
              onChange={set("unit")}
            />
          )}
          <FormField label="Group" hint="e.g. Table Linens">
            {input("group")}
          </FormField>
          {isBar ? (
            <>
              <FormField label="Tier">
                <select
                  value={fields.tier}
                  onChange={(e) => set("tier")(e.target.value)}
                >
                  <option value="">Not set</option>
                  {barTierSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {barTierLabels[option]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Container">
                <select
                  value={fields.container}
                  onChange={(e) => set("container")(e.target.value)}
                >
                  <option value="">Not set</option>
                  {barContainerSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {barContainerLabels[option]}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          ) : (
            <FormField label="Tier" hint="e.g. Standard, Premium">
              {input("tier")}
            </FormField>
          )}
          <FormField label="Color / finish">{input("color")}</FormField>
        </div>
        <FormField label="Description">
          <textarea
            rows={2}
            value={fields.description}
            onChange={(e) => set("description")(e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <FormField
            label="Ratio"
            hint="e.g. 2 per guest; leave empty for none"
          >
            {input("ratioQuantity", { type: "number" })}
          </FormField>
          <FormField label="Ratio basis">
            <select
              value={fields.ratioBasis}
              onChange={(e) => set("ratioBasis")(e.target.value)}
            >
              {ratioBasisSchema.options.map((basis) => (
                <option key={basis} value={basis}>
                  {ratioBasisLabels[basis]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {kind === "rental" && (
          <FormField label="Price ($ per unit)">
            {input("price", { type: "number" })}
          </FormField>
        )}
        {kind === "service" && (
          <div className="form-grid">
            <FormField label="Price ($)">
              {input("price", { type: "number" })}
            </FormField>
            <FormField label="Priced">
              <select
                value={fields.priceBasis}
                onChange={(e) => set("priceBasis")(e.target.value)}
              >
                {ratioBasisSchema.options.map((basis) => (
                  <option key={basis} value={basis}>
                    {ratioBasisLabels[basis]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        )}
        {kind === "consumable" && (
          <>
            <h3 className="form-subheading">Purchasing and units</h3>
            <div className="form-grid">
              <UnitSelect
                label="Purchase unit"
                value={fields.purchaseUnit}
                onChange={set("purchaseUnit")}
              />
              {fields.purchaseUnit === "case" && (
                <FormField label="Items per case">
                  {input("packCount", { type: "number" })}
                </FormField>
              )}
              <FormField
                label="One each is about"
                hint="e.g. 750 ml a bottle, or 8 oz a chicken breast"
              >
                {input("eachSizeQuantity", { type: "number" })}
              </FormField>
              <UnitSelect
                label="Each size unit"
                value={fields.eachSizeUnit}
                onChange={set("eachSizeUnit")}
                optional="Not set"
              />
              <UnitSelect
                label="Recipe unit"
                value={fields.recipeUnit}
                onChange={set("recipeUnit")}
                optional="Not set"
              />
              {costHidden ? (
                <p className="muted">
                  Costs are visible to full-time staff only.
                </p>
              ) : (
                <FormField
                  label={`Unit cost ($ per ${unitLabel(fields.purchaseUnit as Unit)})`}
                >
                  {input("unitCost", { type: "number" })}
                </FormField>
              )}
              <FormField label={isBar ? "Distributor" : "Preferred vendor"}>
                {input("preferredVendor")}
              </FormField>
              <FormField
                label={`Par level (${unitLabel(fields.unit as Unit)})`}
              >
                {input("parLevel", { type: "number" })}
              </FormField>
              <FormField label="Storage section">
                <select
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
                </select>
              </FormField>
              <FormField
                label="Shelf order"
                hint="Where it sits in the section; count mode follows this order"
              >
                {input("storageOrder", { type: "number" })}
              </FormField>
            </div>
            {conversionProblem && (
              <p role="status" className="error-message">
                <AlertTriangle size={14} /> {conversionProblem} Add what one
                each weighs or holds.
              </p>
            )}
          </>
        )}
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save item
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
