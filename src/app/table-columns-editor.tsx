import { useState } from "react";
import { Columns3 } from "lucide-react";
import { controlColumns, layoutTables, type ColumnConfig } from "../../shared/layout";
import { Button } from "../components/ui/button";
import { ColumnPicker } from "./column-picker";
import type { CodeColumn } from "./table-layout";

// The Columns button above a table in edit mode (edit chrome, not wrapped in <T>).
export default function ColumnsEditor({
  tableKey,
  columns,
  codeColumns,
  custom,
  onChange,
  onReset,
}: {
  tableKey: string;
  columns: ColumnConfig[];
  codeColumns: CodeColumn[];
  custom: boolean;
  onChange: (columns: ColumnConfig[]) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const target = layoutTables[tableKey];
  // A table with no source has no fields to pick (FLOW-296): only its column
  // widths change, and Reset clears them.
  if (!target.source)
    return (
      <div className="layout-columns-editor">
        <Button variant="ghost" disabled={!custom} onClick={onReset}>
          Reset columns
        </Button>
      </div>
    );
  const source = target.source;
  // Code-only and control columns are named by their header.
  const controls = Object.fromEntries(
    codeColumns
      .filter((column) => controlColumns.has(column.key) || target.code.includes(column.key))
      .map((column) => [column.key, column.header]),
  );
  return (
    <div className="layout-columns-editor">
      <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Columns3 size={16} />
        Columns
      </Button>
      {open && (
        <div className="layout-columns-popover" role="dialog" aria-label="Columns">
          <ColumnPicker
            source={source}
            columns={columns}
            locked={target.locked}
            controls={controls}
            onChange={onChange}
            extra={codeColumns.filter((column) => controls[column.key] && !target.locked.includes(column.key)).map((column) => column.key)}
          />
          <div className="form-actions">
            <Button variant="ghost" disabled={!custom} onClick={onReset}>
              Reset columns
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

