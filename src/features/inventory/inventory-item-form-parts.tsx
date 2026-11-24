import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Dropdown } from "../../components/ui/Dropdown";
import { FormField } from "../../components/shared";
import { unitLabel, unitSchema } from "../../../shared/units";
import type { FieldName, ItemFields } from "./inventory-item-input";

// What every section of the inventory item form gets (FLOW-317): the text
// fields' values and setters. The state itself stays in ItemFormFields.
export type ItemFieldsProps = {
  fields: ItemFields;
  set: (key: FieldName) => (value: string) => void;
  setFields: Dispatch<SetStateAction<ItemFields>>;
};

export function FieldInput({
  form,
  name,
  type = "text",
}: {
  form: ItemFieldsProps;
  name: FieldName;
  type?: string;
}) {
  return (
    <input
      type={type}
      step={type === "number" ? "any" : undefined}
      value={form.fields[name]}
      onChange={(e) => form.set(name)(e.target.value)}
    />
  );
}

export function UnitSelect({
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
