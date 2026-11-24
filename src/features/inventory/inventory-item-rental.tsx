import { Dropdown } from "../../components/ui/Dropdown";
import { FormField } from "../../components/shared";
import { T } from "../../app/copy";
import type { Vendor } from "../../../shared/vendors";
import { numberText } from "./inventory-item-input";
import { FieldInput, type ItemFieldsProps } from "./inventory-item-form-parts";

// A rental's price, costs, sub-rental vendor, buffers, notes and colors
// (FLOW-317).
export function ItemRentalSection({
  form,
  priceNeedsApproval,
  rentalCostsVisible,
  vendorOptions,
}: {
  form: ItemFieldsProps;
  priceNeedsApproval: boolean;
  rentalCostsVisible: boolean;
  vendorOptions: Vendor[];
}) {
  const { fields, set, setFields } = form;
  return (
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
              <FieldInput form={form} name="internalCost" type="number" />
            </FormField>
            <FormField label={<T id="inventory-item-form.item-form-fields.replacement-cost">Replacement cost ($)</T>}>
              <FieldInput form={form} name="replacementCost" type="number" />
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
                <FieldInput form={form} name="vendorCost" type="number" />
              </FormField>
            )}
            <FormField label={<T id="inventory-item-form.item-form-fields.lead-time-days">Lead time (days)</T>}>
              <FieldInput form={form} name="leadTimeDays" type="number" />
            </FormField>
          </>
        )}
        <FormField label={<T id="inventory-item-form.item-form-fields.dimensions">Dimensions</T>}><FieldInput form={form} name="dimensions" /></FormField>
        <FormField label={<T id="inventory-item-form.item-form-fields.buffer-days-before">Buffer days before</T>}>
          <FieldInput form={form} name="bufferDaysBefore" type="number" />
        </FormField>
        <FormField label={<T id="inventory-item-form.item-form-fields.buffer-days-after">Buffer days after</T>}>
          <FieldInput form={form} name="bufferDaysAfter" type="number" />
        </FormField>
        <FormField label={<T id="inventory-item-form.item-form-fields.assembly-notes">Assembly notes</T>}>
          <FieldInput form={form} name="assemblyNotes" />
        </FormField>
        <FormField label={<T id="inventory-item-form.item-form-fields.notes">Notes</T>}><FieldInput form={form} name="notes" /></FormField>
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
  );
}
