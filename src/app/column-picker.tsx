import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { readableFields, type SourceKey } from "../../shared/fields";
import type { ColumnConfig } from "../../shared/layout";
import { RoundCheck } from "../components/ui/round-check";
import { usePermissions } from "./permissions";

// The Columns editor (FLOW-254): every registry field of the table's source, a
// RoundCheck to show or hide it and a handle to drag it into place (or the
// arrows). Locked columns (row controls) stay put. Edit chrome: its wording
// isn't wrapped in <T>; field names are the registry's default labels.

export function ColumnPicker({
  source,
  columns,
  locked = [],
  controls = {},
  onChange,
}: {
  source: SourceKey;
  columns: ColumnConfig[];
  locked?: string[];
  // Names of pseudo-columns that aren't registry fields, e.g. { open: "Open" }.
  controls?: Record<string, string>;
  onChange: (columns: ColumnConfig[]) => void;
}) {
  const { actor } = usePermissions();
  const [dragging, setDragging] = useState<string | null>(null);
  const fields = actor ? readableFields(actor, source) : [];
  const shown = new Set(columns.map((column) => column.key));
  // Visible columns in their order, then every hidden field.
  const rows = [
    ...columns.map((column) => ({
      key: column.key,
      label: controls[column.key] ?? fields.find((field) => field.key === column.key)?.label ?? column.key,
    })),
    ...fields.filter((field) => !shown.has(field.key)).map((field) => ({ key: field.key, label: field.label })),
  ];
  const isLocked = (key: string) => locked.includes(key);
  const move = (key: string, to: number) => {
    const from = columns.findIndex((column) => column.key === key);
    if (from < 0 || to < 0 || to >= columns.length || isLocked(columns[to].key)) return;
    const next = [...columns];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  return (
    <ul className="layout-column-picker" aria-label="Columns">
      {rows.map((row) => {
        const visible = shown.has(row.key);
        const index = columns.findIndex((column) => column.key === row.key);
        const fixed = isLocked(row.key);
        const required = fields.find((field) => field.key === row.key)?.required;
        return (
          <li
            key={row.key}
            draggable={visible && !fixed}
            onDragStart={() => setDragging(row.key)}
            onDragOver={(event) => {
              if (dragging && visible && !fixed) event.preventDefault();
            }}
            onDrop={() => {
              if (dragging && dragging !== row.key) move(dragging, index);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            className={dragging === row.key ? "dragging" : undefined}
          >
            <span className="layout-drag" aria-hidden="true">
              {visible && !fixed && <GripVertical size={14} />}
            </span>
            <label>
              <RoundCheck
                checked={visible}
                disabled={fixed || (visible && required)}
                aria-label={`Show ${row.label}`}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...columns, { key: row.key }]
                      : columns.filter((column) => column.key !== row.key),
                  )
                }
              />
              {row.label}
              {fixed && <small> (locked)</small>}
            </label>
            {visible && !fixed && (
              <span className="layout-column-moves">
                <button type="button" aria-label={`Move ${row.label} left`} disabled={index === 0} onClick={() => move(row.key, index - 1)}>
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.label} right`}
                  disabled={index === columns.length - 1}
                  onClick={() => move(row.key, index + 1)}
                >
                  <ArrowDown size={12} />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
