import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "react-router-dom";
import { Pencil } from "lucide-react";
import {
  placeholderError,
  placeholdersOf,
  type CopyEdit,
  type CopyOverrides,
} from "../../shared/copy";
import { copyApi } from "../services/copy";
import "./live-copy.css";

// Live text editing (FLOW-240). Every built-in string on a screen is written as
// <T id="area.screen.element">Default text</T> (or useCopy for an input's
// placeholder). It shows the admin's saved override for its key, or the default.
// In edit mode (the pencil in the header, Admin only) each string is outlined;
// clicking one opens an editor, and Save writes every pending edit at once.
// Overrides are plain text and only ever render as text nodes.
// docs/live-text-editing.md has the key conventions.
//
// This file is the editing UI itself, so its own wording isn't wrapped: it must
// stay clickable while edit mode is on.

export const COPY_QUERY_KEY = ["ui-copy"] as const;

// A value shown inside a string, e.g. `{count}`.
type Values = Record<string, ReactNode>;
type StringValues = Record<string, string | number>;

// One unsaved edit: the new text, or null to go back to the default.
type PendingEdit = { text: string | null; defaultText: string };
type Editing = { id: string; defaultText: string; anchor: DOMRect };

type LiveCopy = {
  overrides: CopyOverrides;
  // Whether this tree can edit at all (a CopyProvider is mounted).
  available: boolean;
  editing: boolean;
  pending: ReadonlyMap<string, PendingEdit>;
  saving: boolean;
  error: string;
  start: () => void;
  cancel: () => void;
  discard: () => void;
  save: () => Promise<boolean>;
  open: (target: Editing) => void;
  registerPlaceholder: (text: string, id: string, defaultText: string) => void;
};

const fallback: LiveCopy = {
  overrides: {},
  available: false,
  editing: false,
  pending: new Map(),
  saving: false,
  error: "",
  start: () => {},
  cancel: () => {},
  discard: () => {},
  save: async () => true,
  open: () => {},
  registerPlaceholder: () => {},
};
const LiveCopyContext = createContext<LiveCopy>(fallback);
export const useLiveEdit = () => useContext(LiveCopyContext);

// The text a key shows: the pending edit, else the saved override, else the default.
function effectiveText(copy: LiveCopy, id: string, defaultText: string) {
  const pending = copy.pending.get(id);
  if (pending) return pending.text ?? defaultText;
  return copy.overrides[id] ?? defaultText;
}

// Puts each `{name}` value into the text. An unknown name shows as written.
function interpolate(text: string, values: Values = {}): ReactNode[] {
  return text.split(/(\{[A-Za-z0-9_]+\})/).map((part, index) => {
    const name = /^\{([A-Za-z0-9_]+)\}$/.exec(part)?.[1];
    if (name === undefined) return part;
    return <Fragment key={index}>{name in values ? values[name] : part}</Fragment>;
  });
}
const interpolateString = (text: string, values: StringValues = {}) =>
  text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );

// A key segment made from text, for keys built at run time (table headers, tabs).
export const copySlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "text";

export function T({
  id,
  children,
  values,
}: {
  id: string;
  // The default text, as written in the code.
  children: string;
  values?: Values;
}) {
  const copy = useLiveEdit();
  const text = effectiveText(copy, id, children);
  if (!copy.editing) return <>{interpolate(text, values)}</>;
  const stop = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const open = (event: ReactMouseEvent<HTMLSpanElement>) => {
    stop(event);
    copy.open({ id, defaultText: children, anchor: event.currentTarget.getBoundingClientRect() });
  };
  return (
    <span
      className={`live-copy${text !== children ? " live-copy-changed" : ""}`}
      data-copy-key={id}
      onClick={open}
      onPointerDown={stop}
      onMouseDown={stop}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          stop(event);
          copy.open({
            id,
            defaultText: children,
            anchor: event.currentTarget.getBoundingClientRect(),
          });
        }
      }}
      tabIndex={0}
    >
      {interpolate(text, values)}
    </span>
  );
}

// The `.one` / `.other` key for a count: `{count}` and any other values fill in.
export function TPlural({
  id,
  count,
  one,
  other,
  values,
}: {
  id: string;
  count: number;
  one: string;
  other: string;
  values?: Values;
}) {
  const single = count === 1;
  return (
    <T id={`${id}.${single ? "one" : "other"}`} values={{ count, ...values }}>
      {single ? one : other}
    </T>
  );
}

// Text that can't be a child element, such as an input's placeholder. In edit
// mode, clicking the input opens the editor for it.
export function useCopy(id: string, defaultText: string, values?: StringValues): string {
  const copy = useLiveEdit();
  const text = interpolateString(effectiveText(copy, id, defaultText), values);
  const { registerPlaceholder, editing } = copy;
  useEffect(() => {
    if (editing) registerPlaceholder(text, id, defaultText);
  }, [editing, registerPlaceholder, text, id, defaultText]);
  return text;
}
export function useCopyPlural(
  id: string,
  count: number,
  one: string,
  other: string,
  values?: StringValues,
) {
  const single = count === 1;
  return useCopy(`${id}.${single ? "one" : "other"}`, single ? one : other, {
    count,
    ...values,
  });
}

export function CopyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const overrides = useQuery({
    queryKey: COPY_QUERY_KEY,
    queryFn: () => copyApi.list(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Map<string, PendingEdit>>(new Map());
  const [active, setActive] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const placeholders = useRef(new Map<string, { id: string; defaultText: string }>());
  const saved = useMemo(() => overrides.data ?? {}, [overrides.data]);

  const discard = useCallback(() => {
    setPending(new Map());
    setActive(null);
    setError("");
  }, []);
  const cancel = useCallback(() => {
    discard();
    setEditing(false);
  }, [discard]);
  const save = useCallback(async () => {
    const edits: CopyEdit[] = [];
    const resets: string[] = [];
    for (const [key, edit] of pending) {
      const current = saved[key];
      if (edit.text === null || edit.text === edit.defaultText) {
        if (current !== undefined) resets.push(key);
      } else if (edit.text !== current) {
        edits.push({ key, text: edit.text, placeholders: placeholdersOf(edit.defaultText) });
      }
    }
    setSaving(true);
    setError("");
    try {
      if (edits.length) await copyApi.save(edits);
      for (const key of resets) await copyApi.reset(key);
      await queryClient.invalidateQueries({ queryKey: COPY_QUERY_KEY });
      setPending(new Map());
      setActive(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [pending, saved, queryClient]);
  const registerPlaceholder = useCallback((text: string, id: string, defaultText: string) => {
    placeholders.current.set(text, { id, defaultText });
  }, []);

  // In edit mode, clicking an input with a wrapped placeholder edits the placeholder.
  useEffect(() => {
    if (!editing) return;
    const onClick = (event: MouseEvent) => {
      const field = (event.target as Element | null)?.closest?.("input, textarea");
      const text = field?.getAttribute("placeholder");
      const entry = text ? placeholders.current.get(text) : undefined;
      if (!field || !entry) return;
      event.preventDefault();
      event.stopPropagation();
      setActive({ ...entry, anchor: field.getBoundingClientRect() });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [editing]);
  // Leaving or reloading the page with unsaved edits asks first (AC4).
  useEffect(() => {
    if (!pending.size) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending.size]);

  const value: LiveCopy = {
    overrides: saved,
    available: true,
    editing,
    pending,
    saving,
    error,
    start: () => setEditing(true),
    cancel,
    discard,
    save,
    open: setActive,
    registerPlaceholder,
  };
  return (
    <LiveCopyContext.Provider value={value}>
      {children}
      {editing && active && (
        <CopyEditor
          key={active.id}
          target={active}
          current={effectiveText(value, active.id, active.defaultText)}
          saved={saved[active.id]}
          onChange={(text) =>
            setPending((current) =>
              new Map(current).set(active.id, { text, defaultText: active.defaultText }),
            )
          }
          onClose={() => setActive(null)}
        />
      )}
    </LiveCopyContext.Provider>
  );
}

// Every pending edit's placeholder problem, if any; Save is blocked while one exists.
export function pendingErrors(pending: ReadonlyMap<string, PendingEdit>) {
  return [...pending.values()].flatMap((edit) => {
    if (edit.text === null) return [];
    const error = placeholderError(edit.text, placeholdersOf(edit.defaultText));
    return error ? [error] : [];
  });
}

function CopyEditor({
  target,
  current,
  saved,
  onChange,
  onClose,
}: {
  target: Editing;
  current: string;
  saved: string | undefined;
  onChange: (text: string | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(current);
  const error = placeholderError(text, placeholdersOf(target.defaultText));
  const top = Math.min(target.anchor.bottom + 6, window.innerHeight - 240);
  const left = Math.max(8, Math.min(target.anchor.left, window.innerWidth - 368));
  const changed = text !== target.defaultText || saved !== undefined;
  return createPortal(
    <div
      className="live-copy-editor"
      role="dialog"
      aria-label="Edit wording"
      style={{ top, left }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <label>
        <span>Text</span>
        <textarea
          autoFocus
          value={text}
          rows={Math.min(6, Math.max(2, Math.ceil(text.length / 40)))}
          maxLength={500}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <small className="live-copy-default">Default: {target.defaultText}</small>
      <div className="live-copy-editor-actions">
        {changed && (
          <button
            type="button"
            onClick={() => {
              setText(target.defaultText);
              onChange(null);
            }}
          >
            Reset to default
          </button>
        )}
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}

// The header's controls: the pencil, or Save and Cancel while editing.
export function LiveEditControls({ allowed }: { allowed: boolean }) {
  const copy = useLiveEdit();
  if (!allowed || !copy.available) return null;
  if (!copy.editing)
    return (
      <button
        type="button"
        className="live-edit-toggle"
        aria-label="Edit wording"
        title="Edit wording"
        onClick={copy.start}
      >
        <Pencil size={17} />
      </button>
    );
  const errors = pendingErrors(copy.pending);
  return (
    <div className="live-edit-controls">
      {copy.error && (
        <span role="alert" className="error-message">
          {copy.error}
        </span>
      )}
      <button
        type="button"
        className="live-edit-save"
        disabled={!copy.pending.size || errors.length > 0 || copy.saving}
        onClick={async () => {
          if (await copy.save()) copy.cancel();
        }}
      >
        {copy.saving ? "Saving…" : "Save"}
      </button>
      <button type="button" className="live-edit-cancel" onClick={copy.cancel}>
        Cancel
      </button>
    </div>
  );
}

// Leaving a page with unsaved edits asks Save / Discard / Stay (AC4). Mounted in
// the router's app layout, since it needs the data router.
export function LiveEditGuard() {
  const copy = useLiveEdit();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      copy.pending.size > 0 && currentLocation.pathname !== nextLocation.pathname,
  );
  if (blocker.state !== "blocked") return null;
  const errors = pendingErrors(copy.pending);
  return (
    <div className="live-edit-guard-scrim">
      <div className="live-edit-guard" role="alertdialog" aria-modal="true" aria-labelledby="live-edit-guard-title">
        <h2 id="live-edit-guard-title">Save your wording changes?</h2>
        <p>You changed text on this page and haven't saved it.</p>
        {errors.length > 0 && (
          <p role="alert" className="error-message">
            {errors[0]}
          </p>
        )}
        {copy.error && (
          <p role="alert" className="error-message">
            {copy.error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            disabled={errors.length > 0 || copy.saving}
            onClick={async () => {
              if (await copy.save()) blocker.proceed();
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              copy.discard();
              blocker.proceed();
            }}
          >
            Discard
          </button>
          <button type="button" onClick={() => blocker.reset()}>
            Stay
          </button>
        </div>
      </div>
    </div>
  );
}
