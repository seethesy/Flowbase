import { listOptions, type ListKey } from "../../shared/settings";
import { useBusinessSettings } from "../services/settings";

// Form controls fed by the configurable lists (FLOW-45). Only active values can be
// picked; a record's archived (or pre-list) value stays selected and is marked.
export function ListSelect({
  list,
  value,
  onChange,
  empty = "—",
  label,
}: {
  list: ListKey;
  value: string;
  onChange: (value: string) => void;
  empty?: string;
  label?: string;
}) {
  const settings = useBusinessSettings();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{empty}</option>
      {listOptions(settings.lists[list], value).map((option) => (
        <option key={option.label} value={option.label}>
          {option.archived ? `${option.label} (archived)` : option.label}
        </option>
      ))}
    </select>
  );
}

// Suggestions for a free-text field (dress code, inventory category): the list's
// active values, offered but not enforced.
export function ListSuggestions({ id, list }: { id: string; list: ListKey }) {
  const settings = useBusinessSettings();
  return (
    <datalist id={id}>
      {listOptions(settings.lists[list]).map((option) => (
        <option key={option.label} value={option.label} />
      ))}
    </datalist>
  );
}

// Every label a list has had, archived included: for filters over saved records.
export function useListLabels(list: ListKey | null): string[] {
  const settings = useBusinessSettings();
  return list ? (settings.lists[list] ?? []).map((value) => value.label) : [];
}

// Several values from one list, as checkboxes (a staff member's positions).
export function ListCheckboxes({
  list,
  values,
  onChange,
  legend,
}: {
  list: ListKey;
  values: string[];
  onChange: (values: string[]) => void;
  legend: string;
}) {
  const settings = useBusinessSettings();
  return (
    <fieldset className="list-checkboxes">
      <legend>{legend}</legend>
      {listOptions(settings.lists[list], values).map((option) => (
        <label key={option.label}>
          <input
            type="checkbox"
            checked={values.includes(option.label)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...values, option.label]
                  : values.filter((value) => value !== option.label),
              )
            }
          />
          {option.archived ? `${option.label} (archived)` : option.label}
        </label>
      ))}
    </fieldset>
  );
}
