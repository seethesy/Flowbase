import { useState, type ReactNode } from "react";
import { Columns3 } from "lucide-react";
import { canReadField } from "../../shared/fields";
import { controlColumns, layoutTables, type ColumnConfig } from "../../shared/layout";
import { Button } from "../components/ui/button";
import { ColumnPicker } from "./column-picker";
import { usePageLayoutContext } from "./layout-state";
import { usePermissions } from "./permissions";

// A table's columns (FLOW-254): the saved column set of the surrounding page's
// layout, or the code's own columns when none is saved. A viewer never gets a
// registry column whose field they can't read; code-only columns keep their own
// rules.

export type CodeColumn = { key: string; header: string };

export function useTableLayout(tableKey: string, codeColumns: CodeColumn[]) {
  const layout = usePageLayoutContext();
  const { actor } = usePermissions();
  const target = layoutTables[tableKey];
  const saved = target ? layout?.doc?.tables[tableKey]?.columns : undefined;
  // A table with no source (FLOW-296) shows only its code's own columns.
  const readable = (key: string) =>
    !target ||
    !target.source ||
    controlColumns.has(key) ||
    target.code.includes(key) ||
    (actor !== null && canReadField(actor, target.source, key));
  const columns: ColumnConfig[] = (saved ?? codeColumns.map((column) => ({ key: column.key }))).filter((column) =>
    readable(column.key),
  );
  const setColumns = (next: ColumnConfig[]) =>
    layout?.update((doc) => ({ ...doc, tables: { ...doc.tables, [tableKey]: { columns: next } } }));
  // Column width drag in edit mode (FLOW-273): sets one column's width, saving
  // the table's column set the first time.
  // A table with no source (FLOW-296) may show a code column its saved set
  // doesn't list yet; resizing it adds it.
  const resizeColumn = (key: string, width: number) => {
    const clamped = Math.max(40, Math.min(1200, Math.round(width)));
    setColumns(
      columns.some((column) => column.key === key)
        ? columns.map((column) => (column.key === key ? { ...column, width: clamped } : column))
        : [...columns, { key, width: clamped }],
    );
  };
  const resetColumns = () =>
    layout?.update((doc) => {
      const tables = { ...doc.tables };
      delete tables[tableKey];
      return { ...doc, tables };
    });
  return {
    // Whether a column set is saved or staged; without one the table renders
    // exactly as its code does.
    custom: saved !== undefined,
    columns,
    editable: Boolean(target && layout?.editing),
    // Only in edit mode, where a header's drag handle calls it.
    resize: target && layout?.editing ? resizeColumn : undefined,
    editor:
      target && layout?.editing ? (
        <ColumnsEditor
          tableKey={tableKey}
          columns={columns}
          codeColumns={codeColumns}
          custom={saved !== undefined}
          onChange={setColumns}
          onReset={resetColumns}
        />
      ) : null,
  };
}

// The Columns button above a table in edit mode (edit chrome, not wrapped in <T>).
function ColumnsEditor({
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

// The hook as a component, for a page that renders its table inline.
export function TableLayout({
  tableKey,
  codeColumns,
  children,
}: {
  tableKey: string;
  codeColumns: CodeColumn[];
  children: (layout: ReturnType<typeof useTableLayout>) => ReactNode;
}) {
  return <>{children(useTableLayout(tableKey, codeColumns))}</>;
}
