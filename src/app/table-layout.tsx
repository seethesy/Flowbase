import { DeleteLayoutButton, useDeletion } from "./layout-deletion";
import { lazy, Suspense, type ReactNode } from "react";
import { canReadField } from "../../shared/fields";
import { controlColumns, layoutItemGone, layoutTables, type ColumnConfig } from "../../shared/layout";
import { usePageLayoutContext } from "./layout-state";
import { usePermissions } from "./permissions";

const ColumnsEditor = lazy(() => import("./table-columns-editor"));

// A table's columns (FLOW-254): the saved column set of the surrounding page's
// layout, or the code's own columns when none is saved. A viewer never gets a
// registry column whose field they can't read; code-only columns keep their own
// rules.

export type CodeColumn = { key: string; header: string };

export function useTableLayout(tableKey: string, codeColumns: CodeColumn[]) {
  const layout = usePageLayoutContext();
  const deletion = useDeletion();
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
    layout?.update((doc) => ({ ...doc, tables: { ...doc.tables, [tableKey]: { ...doc.tables[tableKey], columns: next } } }));
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
    deleted: Boolean(layout?.doc?.tables[tableKey] && layoutItemGone(layout.doc.tables[tableKey])),
    custom: saved !== undefined,
    columns,
    editable: Boolean(target && layout?.editing),
    // Only in edit mode, where a header's drag handle calls it.
    resize: target && layout?.editing ? resizeColumn : undefined,
    editor:
      target && layout?.editing ? (
        <>
        <DeleteLayoutButton name={`${tableKey} table`} onDelete={() => layout.update((doc) => ({ ...doc, tables: { ...doc.tables, [tableKey]: { columns, deleted: deletion(`${tableKey} table`) } } }))} />
        <Suspense fallback={null}>
        <ColumnsEditor
          tableKey={tableKey}
          columns={columns}
          codeColumns={codeColumns}
          custom={saved !== undefined}
          onChange={setColumns}
          onReset={resetColumns}
        />
        </Suspense>
        </>
      ) : null,
  };
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
  const layout = useTableLayout(tableKey, codeColumns);
  return layout.deleted ? null : <>{children(layout)}</>;
}
