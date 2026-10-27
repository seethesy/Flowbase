import type { z } from "zod";
import type { includedItemSchema } from "../../shared/inventory";
import { allPages, inventoryApi } from "../services/core";
import { useResource } from "../app/useResource";
import { Button, FormField } from "../components/shared";

type Line = z.infer<typeof includedItemSchema>;
export function CatalogIncludes({
  itemId,
  service,
  value,
  onChange,
}: {
  itemId?: string;
  service: boolean;
  value: Line[];
  onChange: (value: Line[]) => void;
}) {
  const items = useResource(() => allPages((cursor) => inventoryApi.list({}, cursor)), []);
  const options = (items.data ?? []).filter(
    (item) => item.id !== itemId && item.kind !== "service" && item.active,
  );
  const change = (index: number, update: Partial<Line>) =>
    onChange(
      value.map((row, i) => (i === index ? { ...row, ...update } : row)),
    );
  return (
    <fieldset>
      <legend>{service ? "Includes" : "Kit components"}</legend>
      {items.error && <p role="alert">{items.error}</p>}
      {value.map((line, index) => (
        <div className="form-grid" key={index}>
          <FormField label={`Component ${index + 1}`}>
            <select
              value={line.itemId}
              onChange={(e) => change(index, { itemId: e.target.value })}
            >
              <option value="">Pick a rental or consumable</option>
              {!options.some((item) => item.id === line.itemId) &&
                line.itemId && (
                  <option value={line.itemId}>
                    Unavailable item ({line.itemId})
                  </option>
                )}
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={`Component ${index + 1} quantity`}>
            <input
              type="number"
              min="0"
              step="any"
              value={line.quantity}
              onChange={(e) =>
                change(index, { quantity: Number(e.target.value) })
              }
            />
          </FormField>
          {service && (
            <FormField label={`Component ${index + 1} basis`}>
              <select
                value={line.basis}
                onChange={(e) =>
                  change(index, { basis: e.target.value as Line["basis"] })
                }
              >
                <option value="per_event">per event</option>
                <option value="per_guest">per guest</option>
              </select>
            </FormField>
          )}
          <Button
            variant="outline"
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove component {index + 1}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        onClick={() =>
          onChange([
            ...value,
            {
              itemId: "",
              quantity: 1,
              basis: service ? "per_guest" : "per_event",
            },
          ])
        }
      >
        Add component
      </Button>
    </fieldset>
  );
}
