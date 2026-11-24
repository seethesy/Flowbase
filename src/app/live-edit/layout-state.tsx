import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
// The app's client, named so pages render without a QueryClientProvider too (tests mount pages bare).
import { queryClient } from "../queryClient";
import { emptyLayout, type LayoutDoc, type SavedLayout } from "../../../shared/layout";
import { codeDefaultGrid, withCodeBlocks } from "../../../shared/page-grid";
import { layoutApi } from "../../services/layout";
import { layoutQueryKey, useLiveEdit } from "../copy";
import { PageLayoutProvider, usePageLayoutContext, type PageLayout } from "./layout-context";

export { PageLayoutProvider, usePageLayoutContext, type PageLayout };

// A page's layout (FLOW-253): the saved document, the session's unsaved one, and
// how page parts (blocks, tables, field cards) change it. Documents are page
// grids (FLOW-319); a saved version 1 document arrives converted.

const LAYOUT_STALE_MS = 30 * 60_000;

// A built-in block as the page's code declares it: its id, a name for the edit
// chrome, and its height in the code default (its row's share).
export type BuiltinBlock = { id: string; name: string; w: number; h: number };

// The code default (FLOW-319 20): one column, one row per built-in block in
// code order, each row's share proportional to its height.
export const codeDefault = (builtins: BuiltinBlock[]): LayoutDoc => ({ ...emptyLayout(), ...codeDefaultGrid(builtins) });

// A saved document against the blocks the code has now: a built-in the code
// added since the save goes into a new row where its code order puts it.
// Built-ins the code didn't render this time (another tab, another role) stay,
// in their cells (FLOW-320 A3).
export const withBuiltins = (doc: LayoutDoc, builtins: BuiltinBlock[]): LayoutDoc => withCodeBlocks(doc, builtins);

// Reading order: top to bottom, then left to right (card boxes; FLOW-255).
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
  const builtinKey = builtins.map((block) => `${block.id}:${block.h}`).join(",");
  const update = useCallback(
    (change: (doc: LayoutDoc) => LayoutDoc) => {
      // A part with no blocks of its own (a page subtitle) leaves the grid as it is.
      const base: LayoutDoc = doc ? (builtins.length ? withBuiltins(doc, builtins) : doc) : codeDefault(builtins);
      const next = change(base);
      // Back to what is saved, or to the code default with nothing saved:
      // nothing to save for this page.
      const unchanged = saved ? same(next, saved) : same(next, codeDefault(builtins));
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
