import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Trash2, Undo2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Plural, T } from "../../app/copy";
import { emptySelection, selectionReducer } from "./table-selection";
import { fromRowControl } from "./row-open";
import { ErrorText } from "./error-text";

// The selection, bulk bar, Delete key and Undo toast every data table shares
// (FLOW-260). DataTable uses it; a custom table (Leads) can too: spread
// bodyProps on <tbody>, rowProps(index) on each <tr>, onKeyDown on the table's
// focusable wrapper, and render bar and toast.

export type DeleteResult = {
  deleted: string[];
  // Rows left alone, each with why (e.g. "has a signed contract").
  skipped: { id: string; name: string; reason: string }[];
};
export type SelectionOptions = {
  // The table's own bulk actions (e.g. Assign owner, Change status).
  actions?: (ids: string[], clear: () => void) => ReactNode;
  // Given only to users who can edit the records (anyone who can edit can delete).
  onDelete?: (ids: string[]) => Promise<DeleteResult>;
  onRestore?: (ids: string[]) => Promise<void>;
};
export const MAX_BULK_DELETE = 100;
const UNDO_MS = 10_000;

// Pointer-downs on these keep their own behavior (typing, opening a dropdown).
const OWN_POINTER = "button, a, input, textarea, [contenteditable='true'], [role='combobox'], [role='listbox']";
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input, textarea, [contenteditable='true'], [role='combobox'], [role='listbox']");

type Toast = { ids: string[]; skipped: DeleteResult["skipped"] };

export function useTableSelection(options: SelectionOptions | undefined, ids: string[]) {
  const [state, dispatch] = useReducer(selectionReducer, emptySelection);
  const current = useRef(state);
  current.current = state;
  const justDragged = useRef(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Only rows still on screen stay selected (after a page change or a delete).
  const selected = state.selected.filter((id) => ids.includes(id));
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  useEffect(() => {
    if (!options) return;
    const up = () => {
      if (current.current.drag?.moved) {
        // The click that follows a drag must not edit the cell or open the row.
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 0);
      }
      dispatch({ type: "up" });
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [options]);

  const remove = useCallback(
    async (targets: string[]) => {
      if (!options?.onDelete || !targets.length || busy) return;
      if (targets.length > MAX_BULK_DELETE) {
        setError(`Delete at most ${MAX_BULK_DELETE} rows at a time.`);
        return;
      }
      setError("");
      setBusy(true);
      // The bulk bar (and its Delete button) goes away: focus returns to the
      // table, so Delete and Ctrl/Cmd+Z keep working from the keyboard.
      const table = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".table-card");
      try {
        const result = await options.onDelete(targets);
        dispatch({ type: "clear" });
        setToast({ ids: result.deleted, skipped: result.skipped });
        table?.focus();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [options, busy],
  );

  const undo = useCallback(async () => {
    if (!toast || !options?.onRestore || !toast.ids.length) return;
    const restoring = toast;
    setToast(null);
    try {
      await options.onRestore(restoring.ids);
      dispatch({ type: "set", selected: restoring.ids });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [toast, options]);

  // The toast stays 10 seconds; Ctrl/Cmd+Z undoes while it shows (outside text
  // fields, which keep their own undo). A layout effect, so the key works as
  // soon as the toast is on screen.
  useLayoutEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), UNDO_MS);
    const key = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !typing(event.target)) {
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", key);
    };
  }, [toast, undo]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!options || typing(event.target)) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selected.length && options.onDelete) {
      event.preventDefault();
      void remove(selected);
    } else if (event.key === "Escape" && selected.length) {
      clear();
    }
  };

  const bodyProps: HTMLAttributes<HTMLTableSectionElement> = options
    ? {
        onClickCapture: (event) => {
          // A drag, or a Shift/Ctrl/Cmd click, selects: it never edits or navigates.
          if (justDragged.current || event.shiftKey || event.ctrlKey || event.metaKey) {
            if ((event.target as HTMLElement).closest(OWN_POINTER)) return;
            event.preventDefault();
            event.stopPropagation();
          }
        },
        // Links and images inside rows don't start a browser drag.
        onDragStart: (event) => event.preventDefault(),
      }
    : {};

  const rowProps = (index: number): HTMLAttributes<HTMLTableRowElement> & { "aria-selected"?: boolean } => {
    if (!options) return {};
    const id = ids[index];
    const isSelected = selected.includes(id);
    return {
      "aria-selected": isSelected,
      className: isSelected ? "is-selected" : undefined,
      onPointerDown: (event: PointerEvent<HTMLTableRowElement>) => {
        // A control's own pointer-down, including one in a dropdown menu that
        // renders in a portal (FLOW-296), never starts a selection.
        if (event.button !== 0 || fromRowControl(event)) return;
        const ctrl = event.ctrlKey || event.metaKey;
        // Modifier clicks select; stop the browser selecting text or following links.
        if (event.shiftKey || ctrl) event.preventDefault();
        dispatch({ type: "down", ids: idsRef.current, index, shift: event.shiftKey, ctrl });
      },
      onPointerEnter: () => {
        if (current.current.drag) dispatch({ type: "enter", ids: idsRef.current, index });
      },
    };
  };

  const bar =
    options && selected.length > 0 ? (
      <div className="bulk-bar" role="region" aria-label="Selected rows">
        <strong>
          <Plural id="shared.table-selection.selected" count={selected.length} one="{count} selected" other="{count} selected" />
        </strong>
        {options.actions?.(selected, clear)}
        {options.onDelete && (
          <Button variant="destructive" disabled={busy} onClick={() => void remove(selected)}>
            <Trash2 size={14} />
            <T id="shared.table-selection.delete">Delete</T>
          </Button>
        )}
        <Button variant="ghost" onClick={clear}>
          <X size={14} />
          <T id="shared.table-selection.clear">Clear</T>
        </Button>
        {error && (
          <p role="alert" className="bulk-bar__error">
            {error}
          </p>
        )}
      </div>
    ) : <ErrorText message={error} />;

  const toastNode = toast
    ? createPortal(
        <div role="status" className="toast undo-toast">
          <span>
            <Plural id="shared.table-selection.deleted" count={toast.ids.length} one="{count} deleted." other="{count} deleted." />
            {toast.skipped.length > 0 && (
              <>
                {" "}
                <T
                  id="shared.table-selection.skipped"
                  values={{ count: toast.skipped.length, reasons: toast.skipped.map((row) => `${row.name} ${row.reason}`).join("; ") }}
                >
                  {"{count} skipped: {reasons}"}
                </T>
              </>
            )}
          </span>
          {toast.ids.length > 0 && options?.onRestore && (
            <button type="button" className="undo-toast__undo" onClick={() => void undo()}>
              <Undo2 size={14} />
              <T id="shared.table-selection.undo">Undo (Ctrl+Z)</T>
            </button>
          )}
          <button type="button" aria-label="Dismiss" className="undo-toast__close" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>,
        document.body,
      )
    : null;

  return { selected, clear, dragging: !!state.drag?.moved, onKeyDown, bodyProps, rowProps, bar, toast: toastNode, remove, undo };
}
