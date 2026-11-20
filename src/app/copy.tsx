import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyOverridesSchema,
  placeholderError,
  placeholderNames,
  splitPlaceholders,
  type CopyOverrides,
} from "../../shared/copy";
import { request } from "../services/core";

// Admin live text editing (FLOW-240). Every built-in string on a screen is a
// <T id="area.screen.element">Default text</T> (or useCopy for an input
// placeholder). The admin's saved wording comes from GET /api/copy; with none,
// or before it loads, or outside the providers (unit tests), the default shows.
// Key convention: docs/live-text-editing.md.

export const COPY_QUERY_KEY = ["ui-copy"] as const;
const COPY_STALE_MS = 30 * 60_000;

export const copyApi = {
  list: () => request(copyOverridesSchema, "/api/copy"),
  save: (edits: { key: string; text: string; placeholders: string[] }[]) =>
    request(copyOverridesSchema, "/api/copy", "PUT", edits),
  reset: (key: string) =>
    request(copyOverridesSchema.nullable(), `/api/copy/${encodeURIComponent(key)}`, "DELETE"),
};

// A pending edit: new text, or null to reset to the default on Save.
export type PendingEdit = { text: string | null; defaultText: string; placeholders: string[] };
export type EditorTarget = {
  id: string;
  defaultText: string;
  placeholders: string[];
  anchor: HTMLElement;
};

type LiveEdit = {
  overrides: CopyOverrides;
  canEdit: boolean;
  editing: boolean;
  pending: Record<string, PendingEdit>;
  target: EditorTarget | null;
  setEditing: (on: boolean) => void;
  open: (target: EditorTarget) => void;
  close: () => void;
  stage: (id: string, text: string | null, defaultText: string, placeholders: string[]) => void;
  save: () => Promise<void>;
  cancel: () => void;
};

const inert: LiveEdit = {
  overrides: {},
  canEdit: false,
  editing: false,
  pending: {},
  target: null,
  setEditing: () => {},
  open: () => {},
  close: () => {},
  stage: () => {},
  save: async () => {},
  cancel: () => {},
};
const LiveEditContext = createContext<LiveEdit>(inert);
export const useLiveEdit = () => useContext(LiveEditContext);

// Whether a pending batch can be saved: something to save, every placeholder kept.
export function pendingProblems(pending: Record<string, PendingEdit>) {
  return Object.entries(pending).flatMap(([id, edit]) => {
    const error = edit.text === null ? null : placeholderError(edit.placeholders, edit.text);
    return error ? [{ id, error }] : [];
  });
}

export function CopyProvider({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: COPY_QUERY_KEY,
    queryFn: copyApi.list,
    staleTime: COPY_STALE_MS,
    refetchOnWindowFocus: true,
  });
  const overrides = useMemo(() => query.data ?? {}, [query.data]);
  const [editing, setEditingState] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingEdit>>({});
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const setEditing = useCallback(
    (on: boolean) => {
      setEditingState(on && canEdit);
      if (!on) setTarget(null);
    },
    [canEdit],
  );
  const stage = useCallback(
    (id: string, text: string | null, defaultText: string, placeholders: string[]) =>
      setPending((current) => {
        const next = { ...current };
        const saved = overrides[id];
        // Back to what is already saved: nothing to do on Save.
        if ((text === null && saved === undefined) || (text !== null && text === (saved ?? defaultText)))
          delete next[id];
        else next[id] = { text, defaultText, placeholders };
        return next;
      }),
    [overrides],
  );
  const save = useCallback(async () => {
    const entries = Object.entries(pending);
    if (!entries.length || pendingProblems(pending).length) return;
    const edits = entries.flatMap(([key, edit]) =>
      edit.text === null ? [] : [{ key, text: edit.text, placeholders: edit.placeholders }],
    );
    // The PUT answers with every override: show them at once, then refetch.
    if (edits.length) client.setQueryData(COPY_QUERY_KEY, await copyApi.save(edits));
    for (const [key, edit] of entries) if (edit.text === null) await copyApi.reset(key);
    await client.invalidateQueries({ queryKey: COPY_QUERY_KEY });
    setPending({});
    setTarget(null);
  }, [client, pending]);
  const cancel = useCallback(() => {
    setPending({});
    setTarget(null);
    setEditingState(false);
  }, []);
  const value = useMemo<LiveEdit>(
    () => ({
      overrides,
      canEdit,
      editing: editing && canEdit,
      pending,
      target,
      setEditing,
      open: setTarget,
      close: () => setTarget(null),
      stage,
      save,
      cancel,
    }),
    [overrides, canEdit, editing, pending, target, setEditing, stage, save, cancel],
  );
  return <LiveEditContext.Provider value={value}>{children}</LiveEditContext.Provider>;
}

// The text a key shows now: a pending edit, else the saved override, else the default.
function currentText(live: LiveEdit, id: string, defaultText: string) {
  const edit = live.pending[id];
  if (edit) return edit.text ?? defaultText;
  return live.overrides[id] ?? defaultText;
}

function interpolate(text: string, values?: Record<string, ReactNode>): ReactNode {
  if (!values) return text;
  return splitPlaceholders(text).map((part, index) =>
    "text" in part ? (
      <Fragment key={index}>{part.text}</Fragment>
    ) : (
      <Fragment key={index}>{part.name in values ? values[part.name] : `{${part.name}}`}</Fragment>
    ),
  );
}

// One built-in string. `children` is the default wording; `{name}` placeholders
// are filled from `values` (text or elements). Overrides render as text only.
export function T({
  id,
  values,
  children,
}: {
  id: string;
  values?: Record<string, ReactNode>;
  children: string;
}) {
  const live = useLiveEdit();
  const text = currentText(live, id, children);
  const content = interpolate(text, values);
  if (!live.editing) return <>{content}</>;
  const edited = text !== children;
  const onClick = (event: MouseEvent<HTMLSpanElement>) => {
    // Text inside a button or link is edited; the button or link does nothing.
    event.preventDefault();
    event.stopPropagation();
    live.open({
      id,
      defaultText: children,
      placeholders: placeholderNames(children),
      anchor: event.currentTarget,
    });
  };
  return (
    <span
      className={`live-copy${edited ? " live-copy-edited" : ""}${live.target?.id === id ? " live-copy-active" : ""}`}
      data-copy-id={id}
      onClick={onClick}
    >
      {content}
    </span>
  );
}

// Plurals are two keys, `<id>.one` and `<id>.other`, never string concatenation.
export function Plural({
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
  values?: Record<string, ReactNode>;
}) {
  const all = { count, ...values };
  return count === 1 ? (
    <T id={`${id}.one`} values={all}>
      {one}
    </T>
  ) : (
    <T id={`${id}.other`} values={all}>
      {other}
    </T>
  );
}

// Defaults of the useCopy keys rendered so far, so a click on their input can
// open the editor (inputs carry data-copy-id, see LiveEditLayer).
export const copyDefaults = new Map<string, string>();

// Visible text that can't be a child span, e.g. an input placeholder. Give the
// input data-copy-id={id} so the admin can click it to edit the text.
export function useCopy(id: string, defaultText: string, values?: Record<string, string | number>) {
  const live = useLiveEdit();
  copyDefaults.set(id, defaultText);
  const text = currentText(live, id, defaultText);
  if (!values) return text;
  return splitPlaceholders(text)
    .map((part) => ("text" in part ? part.text : part.name in values ? String(values[part.name]) : `{${part.name}}`))
    .join("");
}
