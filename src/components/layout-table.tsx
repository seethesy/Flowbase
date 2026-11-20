import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { fieldDef } from "../../shared/fields";
import { layoutTables } from "../../shared/layout";
import { useTableLayout } from "../app/table-layout";
import { FieldValue, fieldText } from "./layout-fields";

// A layout-aware table's columns (FLOW-254), loaded only when the page has a
// saved column set or is in edit mode, so the field registry and the Columns
// editor stay out of the first load. The code's columns as they are until a
// column set is saved for the table; then the saved set in its order, the
// code's own cell for a column it has and a registry cell for one it doesn't,
// sorting only where the field is sortable.

const columnKey = <Row,>(column: ColumnDef<Row, unknown>) =>
  column.id ?? (column as { accessorKey?: string }).accessorKey ?? "";

export default function LayoutColumns<Row>({
  copyKey,
  columns,
  children,
}: {
  copyKey: string;
  columns: ColumnDef<Row, unknown>[];
  children: (columns: ColumnDef<Row, unknown>[], editor: ReactNode) => ReactNode;
}) {
  const target = layoutTables[copyKey];
  const codeColumns = columns.map((column) => ({
    key: columnKey(column),
    header: typeof column.header === "string" ? column.header : columnKey(column),
  }));
  const layout = useTableLayout(copyKey, codeColumns);
  const configKey = JSON.stringify(layout.custom ? layout.columns : null);
  const shown = useMemo(() => {
    if (!target || !layout.custom) return columns;
    return layout.columns.flatMap((config): ColumnDef<Row, unknown>[] => {
      const def = fieldDef(target.source, config.key);
      const existing = columns.find((column) => columnKey(column) === config.key);
      const meta = { ...existing?.meta, width: config.width };
      if (existing) return [{ ...existing, meta, ...(def ? { enableSorting: Boolean(def.sortable) } : {}) }];
      if (!def) return [];
      return [
        {
          id: def.key,
          header: def.label,
          accessorFn: (row) => fieldText(target.source, def.key, row as Record<string, unknown>),
          cell: ({ row }) => <FieldValue source={target.source} field={def.key} row={row.original as Record<string, unknown>} />,
          enableSorting: Boolean(def.sortable),
          meta,
        },
      ];
    });
    // configKey stands for layout.columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, configKey, target]);
  return <>{children(shown, layout.editor)}</>;
}
