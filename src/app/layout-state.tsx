import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
// The app's client, named so pages render without a QueryClientProvider too (tests mount pages bare).
import { queryClient } from "./queryClient";
import { emptyLayout, GRID_COLUMNS, type LayoutBlock, type LayoutDoc, type SavedLayout } from "../../shared/layout";
import { layoutApi } from "../services/layout";
import { layoutQueryKey, useLiveEdit } from "./copy";
import { PageLayoutProvider, usePageLayoutContext, type PageLayout } from "./layout-context";

export { PageLayoutProvider, usePageLayoutContext, type PageLayout };

// A page's layout (FLOW-253): the saved document, the session's unsaved one, and
// how page parts (blocks, tables, field cards) change it.

const LAYOUT_STALE_MS = 30 * 60_000;

// A built-in block as the page's code declares it: its id, a name for the edit
// chrome, and its default size in grid units.
export type BuiltinBlock = { id: string; name: string; w: number; h: number };

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
// dropped are left out. A built-in the code added since the save goes where its
// code order puts it (FLOW-278): just above the next saved built-in that follows
// it in code, pushing the blocks from there down; with none, at the bottom. So a
// toolbar split out of a saved list stays above the list.
export function withBuiltins(doc: LayoutDoc, builtins: BuiltinBlock[]): LayoutBlock[] {
  const known = new Set(builtins.map((block) => block.id));
  let blocks = doc.blocks.filter((block) => block.kind !== "builtin" || known.has(block.id));
  const placed = new Set(blocks.map((block) => block.id));
  builtins.forEach((block, index) => {
    if (placed.has(block.id)) return;
    const w = Math.min(block.w, GRID_COLUMNS);
    const next = builtins.slice(index + 1).map((later) => blocks.find((b) => b.kind === "builtin" && b.id === later.id)).find(Boolean);
    let y: number;
    if (next) {
      y = next.y;
      blocks = blocks.map((b) => (b.y >= y ? { ...b, y: b.y + block.h } : b));
    } else y = Math.max(0, ...blocks.map((b) => b.y + b.h));
    blocks = [...blocks, { kind: "builtin", id: block.id, x: 0, y, w, h: block.h }];
    placed.add(block.id);
  });
  return blocks;
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
