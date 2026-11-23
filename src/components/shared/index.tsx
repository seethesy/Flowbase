import { LayoutHeader, PageSubtitle, useLayoutBlockId } from "../../app/layout-deletion";
import { isValidElement } from "react";
import { Dropdown } from "../ui/Dropdown";
import { lazy, Suspense, useState, useRef, useEffect, type ReactNode } from "react";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Search,
  X,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  ArrowUpRight,
  Download,
} from "lucide-react";
import {
  createTable,
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type RowData,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { Button } from "../ui/button";
import { useTableSelection, type SelectionOptions } from "./table-selection-ui";
export { useTableSelection, MAX_BULK_DELETE, type DeleteResult, type SelectionOptions } from "./table-selection-ui";
import { canSeeField, type FieldGroup } from "../../../shared/visibility";
import type { Actor } from "../../../shared/access";
import { usePermissions } from "../../app/permissions";
import {
  csvFileName,
  downloadCsv,
  toCsv,
  type CsvValue,
} from "../../services/csv";
import { LabelT, Plural, T, useCopy } from "../../app/copy";
import { roleLabel } from "../../services/users";
import { copySlug } from "../../../shared/copy";
import { usePageLayoutContext } from "../../app/layout-context";
export { Button };

// List export (FLOW-48). A column's CSV value is its accessor's value unless meta.csv
// gives a plainer one. A column holding a field group (shared/visibility.ts) is left
// out of the file for anyone who may not see that group; meta.exportable: false
// leaves a column out for everyone (e.g. selection checkboxes).
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    csv?: (row: TData, value: TValue) => CsvValue;
    fieldGroup?: FieldGroup;
    exportable?: boolean;
    // A saved column width in pixels (FLOW-254).
    width?: number;
    // FLOW-261: only explicitly declared, persisted fields can be edited.
    edit?: "text" | "number" | "date" | "time" | "select" | "none";
    editOptions?: { value: string; label: string }[] | ((row: TData) => { value: string; label: string }[]);
    editValue?: (row: TData) => string;
    // FLOW-275: what the cell shows until it is edited, when that differs from
    // the option label (Bar container shows its size too).
    editDisplay?: (row: TData) => string;
    editCreate?: (row: TData, name: string) => Promise<string | void>;
    editMultiple?: boolean;
    canEdit?: (row: TData) => boolean;
    onEdit?: (row: TData, value: string) => Promise<void>;
  }
}

// The inline editor behind an editable table cell (FLOW-261). Exported for lists
// that edit fields in place outside a DataTable, such as All tasks (FLOW-275);
// label names the field: the button's title, and the open editor's accessible
// name (kept off the button so it doesn't clash with a filter of the same name).
export function EditableCell<Row>({
  value, row, edit, options, save, create, multiple, label, displayText,
}: {
  value: unknown;
  row: Row;
  edit: "text" | "number" | "date" | "time" | "select";
  options?: { value: string; label: string }[];
  save: (row: Row, value: string) => Promise<void>;
  create?: (row: Row, name: string) => Promise<string | void>;
  multiple?: boolean;
  label?: string;
  displayText?: string;
}) {
  const shown = value == null ? "" : String(value);
  const [display, setDisplay] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelled = useRef(false);
  useEffect(() => { setDisplay(shown); setDraft(shown); }, [shown]);
  const commit = async (next = draft) => {
    if (cancelled.current || busy) return;
    setEditing(false);
    if (next === display) return;
    setBusy(true);
    setError("");
    setDisplay(next);
    try { await save(row, next); }
    catch (cause) { setDisplay(shown); setDraft(shown); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const shownText = displayText !== undefined && display === shown ? displayText : edit === "select" ? multiple
    ? display.split(",").filter(Boolean).map((part) => options?.find((option) => option.value === part)?.label ?? part).join(", ")
    : options?.find((option) => option.value === display)?.label : display;
  if (!editing) return <>
    <button className="table-edit-trigger" type="button" disabled={busy} onClick={() => { cancelled.current = false; setEditing(true); }}
      title={label}>
      {shownText || "—"}
    </button>
    {error && <span className="table-edit-error" role="alert">{error}</span>}
  </>;
  if (edit === "select" && multiple) return <div className="table-edit-multiple">
    <Dropdown multiple autoFocus openOnMount value={draft ? draft.split(",") : []} variant="field" aria-label={label}
      options={options ?? []} onValueChange={(next) => setDraft(next.join(","))} />
    <button type="button" onClick={() => void commit()}><T id="shared.data-table.save">Save</T></button>
    <button type="button" onClick={() => { setEditing(false); setDraft(shown); }}><T id="shared.data-table.cancel">Cancel</T></button>
  </div>;
  if (edit === "select") return <Dropdown
    autoFocus openOnMount value={draft} variant="field" options={options ?? []} aria-label={label}
    creatable={create ? { onCreate: (name) => create(row, name) } : undefined}
    onValueChange={(next) => { setDraft(next); void commit(next); }}
    onOpenChange={(open) => { if (!open) setEditing(false); }}
  />;
  return <input
    className="table-edit-input" autoFocus type={edit} value={draft} aria-label={label}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => void commit()}
    onKeyDown={(event) => {
      if (event.key === "Escape") { cancelled.current = true; setEditing(false); setDraft(shown); }
      if (event.key === "Enter") { event.currentTarget.blur(); }
    }}
  />;
}
// The header row and every filtered row in the current sort order, not just the
// page on screen.
export function tableCsv<T>(table: Table<T>, actor: Actor | null): string {
  const columns = table.getVisibleLeafColumns().filter((column) => {
    const { header, meta } = column.columnDef;
    if (typeof header !== "string" || meta?.exportable === false) return false;
    if (!column.accessorFn && !meta?.csv) return false;
    return (
      !meta?.fieldGroup ||
      (actor !== null && canSeeField(actor, meta.fieldGroup))
    );
  });
  return toCsv(
    columns.map((column) => column.columnDef.header as string),
    table
      .getPrePaginationRowModel()
      .rows.map((row) =>
        columns.map((column) =>
          column.columnDef.meta?.csv
            ? column.columnDef.meta.csv(row.original, row.getValue(column.id))
            : (row.getValue(column.id) as CsvValue),
        ),
      ),
  );
}
// The CSV of rows the table doesn't hold (FLOW-216: every page of a paged list),
// with the table's columns and current sort, through a headless copy of it.
export function rowsCsv<T>(
  table: Table<T>,
  rows: T[],
  actor: Actor | null,
): string {
  const full = createTable<T>({
    data: rows,
    columns: table.options.columns,
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  full.setOptions((options) => ({
    ...options,
    state: {
      ...full.initialState,
      sorting: table.getState().sorting,
      columnVisibility: table.getState().columnVisibility,
    },
  }));
  return tableCsv(full, actor);
}
export function StatusBadge({ status }: { status: string }) {
  const tone = ["Active", "Signed", "In Stock", "Received"].includes(status)
    ? "success"
    : ["Low Stock", "Negotiating", "Ordered"].includes(status)
      ? "warning"
      : ["Lost", "Out of Stock", "Inactive"].includes(status)
        ? "error"
        : status === "Sent"
          ? "info"
          : "neutral";
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder,
  copyId,
}: {
  value: string;
  onChange: (value: string) => void;
  // From useCopy (FLOW-240); copyId is its key, so the admin can edit it.
  placeholder?: string;
  copyId?: string;
}) {
  const fallback = useCopy("shared.search-input.placeholder", "Search records…");
  if (placeholder === undefined) {
    placeholder = fallback;
    copyId = "shared.search-input.placeholder";
  }
  return (
    <div className="search-input">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-copy-id={copyId}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}
export function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <Dropdown
      variant="filter"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All {label.toLowerCase()}</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </Dropdown>
  );
}
export function PageHeader({
  pageKey,
  title,
  subtitle,
  children,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  eyebrow?: ReactNode;
  pageKey?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && (pageKey ? <PageSubtitle pageKey={pageKey}>{subtitle}</PageSubtitle> : <p>{subtitle}</p>)}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function EmptyState({
  title = <T id="shared.empty-state.title">No records found</T>,
  description = <T id="shared.empty-state.description">Try adjusting your search or filters.</T>,
}: {
  title?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function LoadingSkeleton() {
  return (
    <div className="skeleton" role="status" aria-label="Loading records" />
  );
}
// A column header given as text is editable like any other built-in string.
function headerText(header: unknown, copyKey: string): ReactNode | null {
  if (typeof header !== "string" || !/[A-Za-z]/.test(header)) return null;
  return <T id={`${copyKey}.column.${copySlug(header)}`}>{header}</T>;
}
export type TableSelection<Row> = SelectionOptions & { rowId: (row: Row) => string };
// Saved columns and the Columns editor (FLOW-254) load only on a page that has
// a saved column set for this table or is in edit mode.
const LayoutColumns = lazy(() => import("../layout-table"));

type DataTableProps<Row> = {
  data: Row[];
  columns: ColumnDef<Row, unknown>[];
  onRow?: (record: Row) => void;
  label?: ReactNode;
  // Prefix of the column headers' text keys (FLOW-240): <copyKey>.column.<header>.
  copyKey?: string;
  // Shows "Export CSV"; the file is named after it, e.g. "ingredients".
  exportName?: string;
  // A paged list's every matching row (usePagedList's loadAll, FLOW-216); the
  // export fetches them instead of writing only the rows loaded so far.
  exportAll?: (onProgress: (rows: number) => void) => Promise<Row[]>;
  // FLOW-260: Excel-style row selection with a bulk bar. Given only when the
  // table selects rows; Delete shows only when onDelete is given (the caller
  // passes it only to users who can edit the records).
  selection?: TableSelection<Row>;
  openColumn?: boolean;
};
export function DataTable<Row>(props: DataTableProps<Row>) {
  const layout = usePageLayoutContext();
  const copyKey = props.copyKey ?? "shared.data-table";
  if (!layout || !(layout.editing || layout.doc?.tables[copyKey])) return <DataTableView {...props} />;
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LayoutColumns copyKey={copyKey} columns={props.columns as unknown as ColumnDef<unknown, unknown>[]}>
        {(columns, editor, resize) => (
          <DataTableView {...props} columns={columns as unknown as ColumnDef<Row, unknown>[]} editor={editor} onResize={resize} />
        )}
      </LayoutColumns>
    </Suspense>
  );
}
// The drag handle on a column header in layout edit mode (FLOW-273): drag it, or
// focus it and press the arrow keys, to set the column's width in pixels.
export function ColumnResizeHandle({ label, onResize }: { label: string; onResize: (width: number) => void }) {
  const widthOf = (element: HTMLElement) => element.parentElement!.getBoundingClientRect().width;
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      tabIndex={0}
      className="column-resize-handle"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = widthOf(event.currentTarget);
        const move = (next: PointerEvent) => onResize(startWidth + next.clientX - startX);
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onResize(widthOf(event.currentTarget) + (event.key === "ArrowRight" ? 10 : -10));
      }}
    />
  );
}
function DataTableView<Row>({
  data,
  columns,
  onRow,
  openColumn,
  selection,
  label = <T id="shared.data-table.records">records</T>,
  exportName,
  exportAll,
  copyKey = "shared.data-table",
  editor = null,
  onResize,
}: DataTableProps<Row> & {
  editor?: ReactNode;
  // Edit mode only (FLOW-273): a drag handle on each header sets that column's width.
  onResize?: (key: string, width: number) => void;
}) {
  const { actor } = usePermissions();
  const [sorting, setSorting] = useState<SortingState>([]);
  // Rows fetched so far while an export runs; null when none is running.
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportError, setExportError] = useState("");
  const renderedColumns: ColumnDef<Row, unknown>[] = (openColumn && onRow ? [
    { id: "open", header: "Open", enableSorting: false, meta: { exportable: false },
      cell: ({ row }: { row: { original: Row } }) => <button className="table-link" onClick={() => onRow(row.original)}><T id="shared.data-table.open">Open</T></button> },
    ...columns,
  ] : columns).map((column) => ({ ...column, meta: { ...column.meta, edit: column.meta?.edit ?? "none" } }));
  const table = useReactTable({
    data,
    columns: renderedColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 8 } },
  });
  const pageRows = table.getRowModel().rows;
  const pageIds = selection ? pageRows.map((row) => selection.rowId(row.original)) : [];
  const selecting = useTableSelection(selection, pageIds);
  const exportCsv = async (name: string) => {
    if (!exportAll) return downloadCsv(csvFileName(name), tableCsv(table, actor));
    setExportError("");
    setExporting(0);
    try {
      const rows = await exportAll((count) => setExporting(count));
      downloadCsv(csvFileName(name), rowsCsv(table, rows, actor));
    } catch (error) {
      // Nothing is downloaded when any page fails (AC3).
      setExportError(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setExporting(null);
    }
  };
  return (
    <div
      className={["table-card", selecting.dragging ? "is-selecting" : ""].filter(Boolean).join(" ")}
      tabIndex={selection ? 0 : undefined}
      onKeyDown={selecting.onKeyDown}
    >
      {selection && selecting.bar}
      {(exportName || editor) && (
        <div className="table-toolbar">
          {editor}
          {exportError && (
            <p role="alert" className="error-message">
              {exportError}
            </p>
          )}
          {exportName && <Button
            variant="outline"
            disabled={!data.length || exporting !== null}
            onClick={() => void exportCsv(exportName)}
          >
            <Download size={16} />
            {exporting === null
              ? <T id="shared.data-table.export-csv">Export CSV</T>
              : <Plural id="shared.data-table.exporting-rows" count={exporting} one="Exporting… {count} row" other="Exporting… {count} rows" />}
          </Button>}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {table.getHeaderGroups()[0].headers.map((h) => (
                <th
                  key={h.id}
                  style={h.column.columnDef.meta?.width ? { width: h.column.columnDef.meta.width } : undefined}
                  className={onResize ? "column-resizable" : undefined}
                >
                  {h.column.getCanSort() ? (
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {headerText(h.column.columnDef.header, copyKey) ??
                        flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDown size={12} />
                      {h.column.getIsSorted() === "asc"
                        ? " ↑"
                        : h.column.getIsSorted() === "desc"
                          ? " ↓"
                          : ""}
                    </button>
                  ) : (
                    (headerText(h.column.columnDef.header, copyKey) ??
                    flexRender(h.column.columnDef.header, h.getContext()))
                  )}
                  {onResize && <ColumnResizeHandle
                    label={typeof h.column.columnDef.header === "string" ? h.column.columnDef.header : h.column.id}
                    onResize={(width) => onResize(h.column.id, width)}
                  />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody {...selecting.bodyProps}>
            {pageRows.map((row, index) => (
              <tr
                key={row.id}
                {...selecting.rowProps(index)}
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td key={cell.id}>
                    {cell.column.columnDef.meta?.edit && cell.column.columnDef.meta.edit !== "none" && cell.column.columnDef.meta.onEdit &&
                      (cell.column.columnDef.meta.canEdit?.(row.original) ?? true) ? (
                      <EditableCell
                        value={cell.column.columnDef.meta.editValue?.(row.original) ?? cell.getValue()} row={row.original}
                        edit={cell.column.columnDef.meta.edit}
                        options={typeof cell.column.columnDef.meta.editOptions === "function"
                          ? cell.column.columnDef.meta.editOptions(row.original)
                          : cell.column.columnDef.meta.editOptions}
                        save={cell.column.columnDef.meta.onEdit}
                        create={cell.column.columnDef.meta.editCreate}
                        multiple={cell.column.columnDef.meta.editMultiple}
                        displayText={cell.column.columnDef.meta.editDisplay?.(row.original)}
                      />
                    ) : i === 0 && onRow && !openColumn ? (
                      <button
                        className="table-link"
                        onClick={() => onRow(row.original)}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </button>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.length && <EmptyState />}
      {selecting.toast}
      <div className="pagination">
        <span>
          <T id="shared.data-table.of" values={{ first: data.length ? table.getState().pagination.pageIndex * 8 + 1 : 0, last: Math.min(
            (table.getState().pagination.pageIndex + 1) * 8,
            data.length,
          ), total: data.length, label }}>{"{first}–{last} of {total} {label}"}</T>
        </span>
        <div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft size={16} />
          </Button>
          <span>
            <T id="shared.data-table.page-of" values={{ page: table.getState().pagination.pageIndex + 1, pages: Math.max(1, table.getPageCount()) }}>{"Page {page} of {pages}"}</T>
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
export function DetailDrawer({
  open,
  onClose,
  title,
  description = <T id="shared.detail-drawer.description">Changes are simulated and reset when you refresh.</T>,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const previousFocus = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement,
  );
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            // React autoFocus fields may focus before Radix emits this event.
            // Retain the render-time opener when focus is already in the drawer.
            if (
              !(event.target as HTMLElement).contains(document.activeElement)
            ) {
              previousFocus.current = document.activeElement as HTMLElement;
            }
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            previousFocus.current?.focus();
          }}
          className={`drawer ${wide ? "wide" : ""}`}
        >
          <div className="drawer-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close dialog">
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="drawer-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = <T id="shared.confirmation-dialog.confirm">Confirm</T>,
  cancelLabel = <T id="shared.confirmation-dialog.cancel">Cancel</T>,
  description,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  children: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  description?: ReactNode;
}) {
  const [error, setError] = useState("");
  return (
    <DetailDrawer open={open} onClose={onClose} title={title} description={description}>
      <p>{children}</p>
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <Button variant="outline" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          onClick={async () => {
            try {
              await onConfirm();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </DetailDrawer>
  );
}
export function FormField({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Tabs({
  tabs,
  value,
  onChange,
  copyKey = "shared.tabs",
}: {
  tabs: string[];
  value: string;
  onChange: (v: string) => void;
  // Prefix of the tab names' text keys (FLOW-240): <copyKey>.tab.<name>.
  copyKey?: string;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t}
          id={`tab-${t}`}
          role="tab"
          aria-selected={value === t}
          aria-controls="record-panel"
          onClick={() => onChange(t)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const next =
                tabs[
                  (tabs.indexOf(t) +
                    (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                    tabs.length
                ];
              onChange(next);
              document.getElementById(`tab-${next}`)?.focus();
            }
          }}
        >
          <T id={`${copyKey}.tab.${copySlug(t)}`}>{t}</T>
        </button>
      ))}
    </div>
  );
}
export function FileList() {
  return (
    <div className="file-list">
      {[
        ["Event brief.pdf", "246 KB"],
        ["Service agreement.pdf", "182 KB"],
        ["Reference menu.pdf", "94 KB"],
      ].map(([name, size]) => (
        <div key={name}>
          <FileText size={22} />
          <div>
            <strong><T id={`shared.file-list.${copySlug(name)}`}>{name}</T></strong>
            <small><T id="shared.file-list.sample-attachment-preview-only" values={{ size }}>{"{size} · Sample attachment · preview only"}</T></small>
          </div>
          <span className="badge neutral"><T id="shared.file-list.demo-file">Demo file</T></span>
        </div>
      ))}
    </div>
  );
}
// A role (or user status) as screens show it, editable live (FLOW-257).
export function RoleText({ role, id = "labels.role" }: { role: string; id?: string }) {
  return <LabelT id={id} value={role}>{roleLabel(role)}</LabelT>;
}

export function Section({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  const blockId = useLayoutBlockId();
  const titleProps = isValidElement<{ id?: string; children?: ReactNode }>(title) ? title.props : null;
  const label = typeof title === "string" ? title : typeof titleProps?.children === "string" ? titleProps.children : "Section";
  const headerKey = titleProps?.id ?? `${blockId ?? "section"}.${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "title"}`;
  return (
    <section className="panel">
      <LayoutHeader headerKey={headerKey} name={`${label} header`}>
        <div className="section-heading"><h2>{title}</h2>{action}</div>
      </LayoutHeader>
      {children}
    </section>
  );
}
export function KpiCard({
  label,
  value,
  icon,
  comparison,
  onClick,
}: {
  label: ReactNode;
  value: string | number;
  icon: ReactNode;
  comparison: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="kpi-card" onClick={onClick}>
      <div className="kpi-top">
        <span>{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="kpi-bottom">
        <span>{comparison}</span>
        <ArrowUpRight size={16} />
      </div>
    </button>
  );
}
