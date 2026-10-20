import { useState, useRef, type ReactNode } from "react";
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
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Button } from "../ui/button";
export { Button };
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
  placeholder = "Search records…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All {label.toLowerCase()}</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}
export function PageHeader({
  title,
  subtitle,
  children,
  eyebrow,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function EmptyState({
  title = "No records found",
  description = "Try adjusting your search or filters.",
}: {
  title?: string;
  description?: string;
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
export function DataTable<T>({
  data,
  columns,
  onRow,
  label = "records",
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  onRow?: (record: T) => void;
  label?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 8 } },
  });
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {table.getHeaderGroups()[0].headers.map((h) => (
                <th key={h.id}>
                  {h.column.getCanSort() ? (
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDown size={12} />
                      {h.column.getIsSorted() === "asc"
                        ? " ↑"
                        : h.column.getIsSorted() === "desc"
                          ? " ↓"
                          : ""}
                    </button>
                  ) : (
                    flexRender(h.column.columnDef.header, h.getContext())
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell, i) => (
                  <td key={cell.id}>
                    {i === 0 && onRow ? (
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
      <div className="pagination">
        <span>
          {data.length ? table.getState().pagination.pageIndex * 8 + 1 : 0}–
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * 8,
            data.length,
          )}{" "}
          of {data.length} {label}
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
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {Math.max(1, table.getPageCount())}
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
  description = "Changes are simulated and reset when you refresh.",
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
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
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  return (
    <DetailDrawer open={open} onClose={onClose} title={title}>
      <p>{children}</p>
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <Button variant="outline" onClick={onClose}>
          Cancel
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
          Confirm
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
  label: string;
  children: ReactNode;
  hint?: string;
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
}: {
  tabs: string[];
  value: string;
  onChange: (v: string) => void;
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
          {t}
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
            <strong>{name}</strong>
            <small>{size} · Sample attachment · preview only</small>
          </div>
          <span className="badge neutral">Demo file</span>
        </div>
      ))}
    </div>
  );
}
export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
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
  label: string;
  value: string | number;
  icon: ReactNode;
  comparison: string;
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
export function Notes({
  notes,
  onAdd,
}: {
  notes: { text: string; date: string }[];
  onAdd: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <Section title="Team notes">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim()) {
            try {
              await onAdd(text.trim());
              setError("");
            } catch (e) {
              setError((e as Error).message);
              return;
            }
            setText("");
          }
        }}
      >
        <FormField label="Add a note">
          <textarea
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Capture something useful for your team…"
          />
        </FormField>
        {error && <p role="alert">{error}</p>}
        <Button>Add note</Button>
      </form>
      {notes.length ? (
        notes.map((n, i) => (
          <div className="note" key={i}>
            <p>{n.text}</p>
            <small>Alex Chen · {n.date}</small>
          </div>
        ))
      ) : (
        <p className="muted">No notes yet. Add the first note for your team.</p>
      )}
    </Section>
  );
}
