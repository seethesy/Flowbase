import { Dropdown } from "../../components/ui/Dropdown";
import { Button, FormField } from "../../components/shared";
import { ratioBasisLabels, type RatioBasis } from "../../../shared/inventory";
import { RoundCheck } from "../../components/ui/round-check";
import { T } from "../../app/copy";
import type { ServiceAddon } from "./inventory-item-input";
import { FieldInput, type ItemFieldsProps } from "./inventory-item-form-parts";

// A service's quote or price and its per-person add-ons (FLOW-317). Its
// included items are the shared CatalogIncludes below this section.
export function ItemServiceSection({
  form,
  quoted,
  setQuoted,
  addons,
  setAddons,
}: {
  form: ItemFieldsProps;
  quoted: boolean;
  setQuoted: (quoted: boolean) => void;
  addons: ServiceAddon[];
  setAddons: (addons: ServiceAddon[]) => void;
}) {
  const { fields, set } = form;
  return (
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
            <FieldInput form={form} name="price" type="number" />
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
  );
}
