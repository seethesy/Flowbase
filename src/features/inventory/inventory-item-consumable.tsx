import { Dropdown } from "../../components/ui/Dropdown";
import { AlertTriangle } from "lucide-react";
import { FormField } from "../../components/shared";
import { recipeUnitProblem, type Section as StockSection } from "../../../shared/inventory";
import { unitLabel, type Unit } from "../../../shared/units";
import type { Vendor } from "../../../shared/vendors";
import { T } from "../../app/copy";
import { consumableDraft } from "./inventory-item-input";
import { FieldInput, UnitSelect, type ItemFieldsProps } from "./inventory-item-form-parts";

// A supply, ingredient or bar item's purchasing, units, cost, vendor, par level
// and storage (FLOW-317).
export function ItemConsumableSection({
  form,
  subtype,
  costHidden,
  vendorOptions,
  storage,
}: {
  form: ItemFieldsProps;
  subtype: string;
  costHidden: boolean;
  vendorOptions: Vendor[];
  storage: StockSection[];
}) {
  const { fields, set } = form;
  const isBar = subtype === "bar";
  // Bar stock has no storage on screen (FLOW-291).
  const storageSectionId = isBar ? "" : fields.storageSectionId;
  // FLOW-81 AC2: flag a recipe unit this ingredient can't be converted to.
  const conversionProblem = fields.recipeUnit
    ? recipeUnitProblem(
        { unit: fields.unit as Unit, consumable: consumableDraft(fields) },
        fields.recipeUnit as Unit,
      )
    : null;
  return (
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
            <FieldInput form={form} name="packCount" type="number" />
          </FormField>
        )}
        <FormField
          label={<T id="inventory-item-form.item-form-fields.one-each-is-about">One each is about</T>}
          hint={<T id="inventory-item-form.item-form-fields.e-g-750-ml-a">e.g. 750 ml a bottle, or 8 oz a chicken breast</T>}
        >
          <FieldInput form={form} name="eachSizeQuantity" type="number" />
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
            <FieldInput form={form} name="unitCost" type="number" />
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
            <FieldInput form={form} name="preferredVendor" />
          </FormField>
        )}
        <FormField
          label={<T id="inventory-item-form.item-form-fields.par-level" values={{ unitLabel: unitLabel(fields.unit as Unit) }}>{"Par level ({unitLabel})"}</T>}
        >
          <FieldInput form={form} name="parLevel" type="number" />
        </FormField>
        {!isBar && <>
        <FormField label={subtype === "ingredient" ? <T id="inventory-item-form.item-form-fields.storage-area">Storage area</T> : <T id="inventory-item-form.item-form-fields.location">Location</T>}>
          <Dropdown
            value={storageSectionId}
            onChange={(e) => set("storageSectionId")(e.target.value)}
          >
            <option value="">Not set</option>
            {storage.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </Dropdown>
        </FormField>
        <FormField
          label={<T id="inventory-item-form.item-form-fields.shelf-order">Shelf order</T>}
          hint={<T id="inventory-item-form.item-form-fields.where-it-sits-at-the">Where it sits there; count mode follows this order</T>}
        >
          <FieldInput form={form} name="storageOrder" type="number" />
        </FormField>
        </>}
      </div>
      {conversionProblem && (
        <p role="status" className="error-message">
          <AlertTriangle size={14} /><T id="inventory-item-form.item-form-fields.add-what-one-each-weighs" values={{ conversionProblem }}>{" {conversionProblem} Add what one each weighs or holds."}</T>
        </p>
      )}
    </>
  );
}
