import { Dropdown } from "../../components/ui/Dropdown";
import {
  barCategories,
  barContainerLabels,
  barContainerSchema,
  barSubcategories,
  barTierLabels,
  barTierSchema,
  classificationKind,
  kindForTracking,
  stockTrackingLabels,
  stockTrackingOf,
  stockTrackingSchema,
  subtypesByKind,
  type ItemKind,
  type StockTracking,
} from "../../../shared/inventory";
import { inventoryCategoriesApi } from "../../services/inventory-categories";
import { useResource } from "../../app/useResource";
import { FormField } from "../../components/shared";
import { subtypeLabel } from "./inventory-labels";
import { ListSuggestions } from "../common/list-fields";
import { inventoryCategoryList } from "../../../shared/settings";
import { usePermissions } from "../../app/permissions";
import { RoundCheck } from "../../components/ui/round-check";
import { T } from "../../app/copy";
import { FieldInput, UnitSelect, type ItemFieldsProps } from "./inventory-item-form-parts";

// The item form's identity and classification fields (FLOW-317): name, code,
// kind and stock tracking, subtype, Category and Type, the legacy or bar
// category, unit, group, tier (with the bar's container and house pick) and color.
export function ItemClassificationSection({
  form,
  editing,
  preset,
  shows,
  kind,
  setKind,
  subtype,
  setSubtype,
  categoryId,
  setCategoryId,
  typeId,
  setTypeId,
  housePick,
  setHousePick,
}: {
  form: ItemFieldsProps;
  editing: boolean;
  preset: boolean;
  shows: (field: string) => boolean;
  kind: ItemKind;
  setKind: (kind: ItemKind) => void;
  subtype: string;
  setSubtype: (subtype: string) => void;
  categoryId: string;
  setCategoryId: (id: string) => void;
  typeId: string;
  setTypeId: (id: string) => void;
  housePick: boolean;
  setHousePick: (housePick: boolean) => void;
}) {
  const { fields, set } = form;
  const { can } = usePermissions();
  const classification = useResource(["inventory-categories"], inventoryCategoriesApi.list, { reference: true });
  const catalogKind = classificationKind({ kind, subtype: kind === "service" ? null : subtype });
  const categories = (classification.data?.categories ?? []).filter((entry) => entry.kind === catalogKind);
  const types = (classification.data?.types ?? []).filter((entry) => entry.categoryId === categoryId);
  const isBar = kind === "consumable" && subtype === "bar";
  // Category suggestions (FLOW-45).
  const categoryList = inventoryCategoryList({
    kind,
    subtype: kind === "service" ? null : subtype,
  });
  const pickCategory = set("category");
  const subtypes: readonly string[] = subtypesByKind[kind];
  // A Master inventory item (FLOW-289): not a bar item or an ingredient.
  const master = !preset && !(kind === "consumable" && subtype !== "supply");
  return (
    <div className="form-grid">
      <FormField label={<T id="inventory-item-form.item-form-fields.name">Name *</T>}>
        <input
          value={fields.name}
          onChange={(e) => set("name")(e.target.value)}
          autoFocus
        />
      </FormField>
      {shows("code") && (<FormField label={<T id="inventory-item-form.item-form-fields.code-sku">Code / SKU</T>}><FieldInput form={form} name="code" /></FormField>)}
      {master && (
        <FormField label={<T id="inventory-item-form.item-form-fields.kind">Kind</T>}>
          {/* Every Master item reads "Rental" (FLOW-289). */}
          <p><T id="inventory-item-form.item-form-fields.rental">Rental</T></p>
        </FormField>
      )}
      {/* What happens to its stock, which only an Admin picks for a new Master
          item: returned (rental), used up (supply) or not stocked (service). */}
      {master && can("inventory.sections") && (
        <FormField label={<T id="inventory-item-form.item-form-fields.stock-tracking">Stock tracking</T>}>
          <Dropdown
            value={stockTrackingOf(kind)}
            disabled={editing}
            onChange={(e) => {
              const next = kindForTracking[e.target.value as StockTracking];
              setKind(next);
              // A used-up Master item is a supply (FLOW-289).
              setSubtype(next === "consumable" ? "supply" : (subtypesByKind[next] as readonly string[])[0] ?? "");
              setCategoryId("");
              setTypeId("");
            }}
          >
            {stockTrackingSchema.options.map((option) => (
              <option key={option} value={option}>
                {stockTrackingLabels[option]}
              </option>
            ))}
          </Dropdown>
        </FormField>
      )}
      {subtypes.length > 0 && !preset && kind !== "consumable" && (
        <FormField label={<T id="inventory-item-form.item-form-fields.subtype">Subtype</T>}>
          <Dropdown
            value={subtype}
            onChange={(e) => { setSubtype(e.target.value); setCategoryId(""); setTypeId(""); }}
          >
            {subtypes.map((option) => (
              <option key={option} value={option}>
                {subtypeLabel(option)}
              </option>
            ))}
          </Dropdown>
        </FormField>
      )}
      <FormField label={<T id="inventory-item-form.item-form-fields.classification-category">Category</T>}>
        <Dropdown value={categoryId} onValueChange={(next) => { setCategoryId(next); setTypeId(""); }}
          creatable={can("inventory.sections") ? {
            label: <T id="inventory-item-form.item-form-fields.new-category">New category</T>,
            onCreate: async (name) => {
              const created = await inventoryCategoriesApi.createCategory(catalogKind, name);
              await classification.refresh();
              setCategoryId(created.id);
              setTypeId("");
              return created.id;
            },
          } : undefined}>
          <option value="">None</option>
          {categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </Dropdown>
      </FormField>
      <FormField label={<T id="inventory-item-form.item-form-fields.classification-type">Type</T>}>
        <Dropdown value={typeId} disabled={!categoryId} onValueChange={setTypeId}
          creatable={categoryId && can("inventory.sections") ? {
            label: <T id="inventory-item-form.item-form-fields.new-type">New type</T>,
            onCreate: async (name) => {
              const created = await inventoryCategoriesApi.createType(categoryId, name);
              await classification.refresh();
              setTypeId(created.id);
              return created.id;
            },
          } : undefined}>
          <option value="">None</option>
          {types.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </Dropdown>
      </FormField>
      {isBar ? (
        <>
          <FormField label={<T id="inventory-item-form.item-form-fields.bar-category">Bar category</T>}>
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
            <FieldInput form={form} name="brand" />
          </FormField>
        </>
      ) : (
        <FormField label={<T id="inventory-item-form.item-form-fields.legacy-category">Legacy category</T>}>
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
        <FieldInput form={form} name="group" />
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
          <FieldInput form={form} name="tier" />
        </FormField>
      )}
      <FormField label={<T id="inventory-item-form.item-form-fields.color-finish">Color / finish</T>}><FieldInput form={form} name="color" /></FormField>
    </div>
  );
}
