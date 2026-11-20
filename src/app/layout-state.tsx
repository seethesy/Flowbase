import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
// The app's client, named so pages render without a QueryClientProvider too (tests mount pages bare).
import { queryClient } from "./queryClient";
import type { SourceKey } from "../../shared/fields";
import { emptyLayout, GRID_COLUMNS, type LayoutBlock, type LayoutDoc, type SavedLayout } from "../../shared/layout";
import { layoutApi } from "../services/layout";
import { layoutQueryKey, useLiveEdit } from "./copy";

// A page's layout (FLOW-253): the saved document, the session's unsaved one, and
// how page parts (blocks, tables, field cards) change it.

const LAYOUT_STALE_MS = 30 * 60_000;

// A built-in block as the page's code declares it: its id, a name for the edit
// chrome, and its default size in grid units.
export type BuiltinBlock = { id: string; name: string; w: number; h: number };

export type PageLayout = {
  pageKey: string;
  // The record a record page shows ("This record" cards, field cards).
  record: { source: SourceKey; id: string; row?: Record<string, unknown> } | null;
  saved: LayoutDoc | null;
  // Pending in this session, else saved; null with neither (the code default).
  doc: LayoutDoc | null;
  editing: boolean;
  // Applies a change to the current document (the code default when none),
  // staging it for the session's Save.
  update: (change: (doc: LayoutDoc) => LayoutDoc) => void;
  // Back to the code default on Save, colors included.
  reset: () => void;
  dirty: boolean;
};

const PageLayoutContext = createContext<PageLayout | null>(null);
export const PageLayoutProvider = PageLayoutContext.Provider;
// The surrounding page's layout; null outside a PageGrid.
export const usePageLayoutContext = () => useContext(PageLayoutContext);

// The code default's blocks: built-in blocks stacked full width in code order.
export function defaultBlocks(builtins: BuiltinBlock[]): LayoutBlock[] {
  let y = 0;
  return builtins.map((block) => {
    const placed: LayoutBlock = { kind: "builtin", id: block.id, x: 0, y, w: Math.min(block.w, GRID_COLUMNS), h: block.h };
    y += block.h;
    return placed;
  });
}

// A saved document against the blocks the code has now: built-ins the code
// dropped are left out; new ones go at the bottom.
export function withBuiltins(doc: LayoutDoc, builtins: BuiltinBlock[]): LayoutBlock[] {
  const known = new Set(builtins.map((block) => block.id));
  const kept = doc.blocks.filter((block) => block.kind !== "builtin" || known.has(block.id));
  const placed = new Set(kept.map((block) => block.id));
  let bottom = Math.max(0, ...kept.map((block) => block.y + block.h));
  const added = builtins
    .filter((block) => !placed.has(block.id))
    .map((block): LayoutBlock => {
      const next: LayoutBlock = { kind: "builtin", id: block.id, x: 0, y: bottom, w: Math.min(block.w, GRID_COLUMNS), h: block.h };
      bottom += block.h;
      return next;
    });
  return [...kept, ...added];
}

// Reading order: top to bottom, then left to right. Phones stack in this order.
export const readingOrder = <T extends { x: number; y: number }>(items: T[]) =>
  [...items].sort((a, b) => a.y - b.y || a.x - b.x);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function usePageLayout(
  pageKey: string,
  builtins: BuiltinBlock[],
  record: PageLayout["record"],
): PageLayout {
  const live = useLiveEdit();
  const query = useQuery({
    queryKey: layoutQueryKey(pageKey),
    queryFn: () => layoutApi.get(pageKey),
    staleTime: LAYOUT_STALE_MS,
  }, queryClient);
  const saved: LayoutDoc | null = (query.data as SavedLayout | undefined)?.layout ?? null;
  const pending = live.layoutPending[pageKey];
  const doc = pending === undefined ? saved : pending;
  const editing = live.editing && live.canEditLayout;
  const { stageLayout } = live;
  const builtinKey = builtins.map((block) => `${block.id}:${block.w}:${block.h}`).join(",");
  const update = useCallback(
    (change: (doc: LayoutDoc) => LayoutDoc) => {
      const base: LayoutDoc = doc
        ? { ...doc, blocks: withBuiltins(doc, builtins) }
        : { ...emptyLayout(), blocks: defaultBlocks(builtins) };
      const next = change(base);
      // Back to what is saved, or to the code default with nothing saved:
      // nothing to save for this page.
      const unchanged = saved
        ? same(next, saved)
        : same(next, { ...emptyLayout(), blocks: defaultBlocks(builtins) });
      stageLayout(pageKey, unchanged ? undefined : next);
    },
    // builtins is rebuilt each render; builtinKey stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, saved, pageKey, stageLayout, builtinKey],
  );
  const reset = useCallback(() => stageLayout(pageKey, saved ? null : undefined), [pageKey, saved, stageLayout]);
  return useMemo(
    () => ({ pageKey, record, saved, doc, editing, update, reset, dirty: pending !== undefined }),
    [pageKey, record, saved, doc, editing, update, reset, pending],
  );
}
