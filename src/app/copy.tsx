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
  copySlug,
  placeholderError,
  placeholderNames,
  placeholdersMatch,
  splitPlaceholders,
  trimLineBreaks,
  type CopyOverrides,
} from "../../shared/copy";
import { request } from "../services/core";
import { z } from "zod";
import { orphansSchema, type OrphanAction } from "../../shared/live-edit-orphans";
import type { LayoutDoc } from "../../shared/layout";
import { styleContrastOk } from "../../shared/contrast";

// Admin live text editing (FLOW-240). Every built-in string on a screen is a
// <T id="area.screen.element">Default text</T> (or useCopy for an input
// placeholder). The admin's saved wording comes from GET /api/copy; with none,
// or before it loads, or outside the providers (unit tests), the default shows.
// Key convention: docs/live-text-editing.md.

export const COPY_QUERY_KEY = ["ui-copy"] as const;
// A page's saved layout (FLOW-253).
export const layoutQueryKey = (pageKey: string) => ["ui-layout", pageKey] as const;
const COPY_STALE_MS = 30 * 60_000;

export const COPY_ORPHANS_QUERY_KEY = ["ui-copy-orphans"] as const;

export const copyApi = {
  list: () => request(copyOverridesSchema, "/api/copy"),
  // Saved edits that no longer match a screen (FLOW-277).
  orphans: () => request(orphansSchema, "/api/copy/orphans"),
  resolveOrphan: (action: OrphanAction) => request(z.null(), "/api/copy/orphans", "POST", action),
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
  // Admin live layout editing (FLOW-253) shares the session: one pencil, one
  // Save and Cancel, one leave-page guard.
  canEditLayout: boolean;
  // Unsaved page layouts by page key; null resets the page to its code default.
  layoutPending: Record<string, LayoutDoc | null>;
  stageLayout: (pageKey: string, layout: LayoutDoc | null | undefined) => void;
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
  canEditLayout: false,
  layoutPending: {},
  stageLayout: () => {},
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

// Blocks and boxes whose text and background colors are too close (FLOW-253 AC8).
export function layoutStyleProblems(layouts: Record<string, LayoutDoc | null>) {
  return Object.entries(layouts).flatMap(([pageKey, doc]) => {
    if (!doc) return [];
    const styles = [
      ...doc.blocks.map((block) => block.style),
      ...doc.blocks.flatMap((block) =>
        block.kind === "card" && block.card.display.type === "boxes" ? block.card.display.boxes.map((box) => box.style) : [],
      ),
      ...Object.values(doc.fieldBoxes).flatMap((card) => card.boxes.map((box) => box.style)),
    ];
    return styles.some((style) => !styleContrastOk(style)) ? [{ pageKey }] : [];
  });
}

// Everything the session would save: wording edits and page layouts.
export const pendingCount = (live: Pick<LiveEdit, "pending" | "layoutPending">) =>
  Object.keys(live.pending).length + Object.keys(live.layoutPending).length;

export function CopyProvider({
  canEdit,
  canEditLayout = false,
  children,
}: {
  canEdit: boolean;
  canEditLayout?: boolean;
  children: ReactNode;
}) {
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
  const [layoutPending, setLayoutPending] = useState<Record<string, LayoutDoc | null>>({});
  const stageLayout = useCallback((pageKey: string, layout: LayoutDoc | null | undefined) =>
    setLayoutPending((current) => {
      const next = { ...current };
      if (layout === undefined) delete next[pageKey];
      else next[pageKey] = layout;
      return next;
    }), []);
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
    const layouts = Object.entries(layoutPending);
    if ((!entries.length && !layouts.length) || pendingProblems(pending).length || layoutStyleProblems(layoutPending).length)
      return;
    const edits = entries.flatMap(([key, edit]) =>
      edit.text === null ? [] : [{ key, text: trimLineBreaks(edit.text), placeholders: edit.placeholders }],
    );
    // The PUT answers with every override: show them at once, then refetch.
    if (edits.length) client.setQueryData(COPY_QUERY_KEY, await copyApi.save(edits));
    for (const [key, edit] of entries) if (edit.text === null) await copyApi.reset(key);
    if (entries.length) await client.invalidateQueries({ queryKey: COPY_QUERY_KEY });
    // The layout API loads with the layout schemas, only when there is a layout to save.
    if (layouts.length) {
      const { layoutApi } = await import("../services/layout");
      for (const [pageKey, layout] of layouts) {
        if (layout) client.setQueryData(layoutQueryKey(pageKey), await layoutApi.save(pageKey, layout));
        else {
          await layoutApi.reset(pageKey);
          client.setQueryData(layoutQueryKey(pageKey), null);
        }
      }
    }
    setPending({});
    setLayoutPending({});
    setTarget(null);
  }, [client, pending, layoutPending]);
  const cancel = useCallback(() => {
    setPending({});
    setLayoutPending({});
    setTarget(null);
    setEditingState(false);
  }, []);
  const value = useMemo<LiveEdit>(
    () => ({
      overrides,
      canEdit,
      canEditLayout: canEditLayout && canEdit,
      layoutPending,
      stageLayout,
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
    [overrides, canEdit, canEditLayout, layoutPending, stageLayout, editing, pending, target, setEditing, stage, save, cancel],
  );
  return <LiveEditContext.Provider value={value}>{children}</LiveEditContext.Provider>;
}

// A saved override written for an older default whose {placeholders} have
// since changed (FLOW-277): it would show "{oldname}" or leave a value out, so
// the default shows until the Admin updates it.
export function staleOverride(overrides: CopyOverrides, id: string, defaultText: string): boolean {
  const saved = overrides[id];
  return saved !== undefined && !placeholdersMatch(defaultText, saved);
}

// The text a key shows now: a pending edit, else the saved override (when it
// still fits the default's placeholders), else the default.
function currentText(live: LiveEdit, id: string, defaultText: string) {
  const edit = live.pending[id];
  if (edit) return edit.text ?? defaultText;
  if (staleOverride(live.overrides, id, defaultText)) return defaultText;
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
  const stale = !live.pending[id] && staleOverride(live.overrides, id, children);
  const names = placeholderNames(children);
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
      className={`live-copy${edited ? " live-copy-edited" : ""}${stale ? " live-copy-stale" : ""}${live.target?.id === id ? " live-copy-active" : ""}`}
      data-copy-id={id}
      title={stale ? `Update for new ${names.length ? names.map((name) => `{${name}}`).join(", ") : "plain text"}` : undefined}
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

// A display label a screen takes from a constant map (FLOW-257), e.g. a status
// label. The key is `<id>.<value slug>`, so one map shares its keys on every
// screen: <LabelT id="labels.task-status" value={task.status}>{taskStatusLabels[task.status]}</LabelT>.
export function LabelT({ id, value, children }: { id: string; value: string; children: string }) {
  return <T id={`${id}.${copySlug(value)}`}>{children}</T>;
}

// Parts of one line joined with a separator, e.g. "Rental · Linen", where some
// parts are <T> or <LabelT> elements. Falsy parts are left out, like .filter(Boolean).
export function joined(parts: ReactNode[], separator = " · "): ReactNode {
  const shown = parts.filter(Boolean);
  return shown.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && separator}
      {part}
    </Fragment>
  ));
}
