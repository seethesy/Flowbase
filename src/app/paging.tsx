import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  type QueryKey,
} from "@tanstack/react-query";
import type { Page } from "../services/core";
import { Button } from "../components/shared";
import { queryClient } from "./queryClient";
import { isRefused } from "./useResource";

// Every row a list's `load` returns, walking its pages from the first (FLOW-216:
// Export CSV writes the whole filtered list, not just the pages on screen). Each
// request is an ordinary page of the list endpoint, so none outgrows the Worker's
// CPU budget. onProgress gets the number of rows fetched so far. Any failed page
// rejects the whole walk.
export async function loadEveryPage<T>(
  load: (cursor?: string) => Promise<Page<T>>,
  onProgress?: (rows: number) => void,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await load(cursor);
    rows.push(...page.rows);
    onProgress?.(rows.length);
    if (!page.next) return rows;
    if (seen.has(page.next))
      throw new Error("The list kept returning the same page. Please retry.");
    seen.add(page.next);
    cursor = page.next;
  }
}

// A list screen's rows, one API page at a time (FLOW-179), cached by TanStack
// Query (FLOW-189). `key` names the list and must include every filter `load`
// sends; a new key loads its first page and loadMore appends the next. The rows
// for the previous filters stay on screen while the new first page loads, and a
// response for filters that have since changed never replaces the newer list.
export function usePagedList<T>(
  key: QueryKey,
  load: (cursor?: string) => Promise<Page<T>>,
) {
  const query = useInfiniteQuery(
    {
      queryKey: key,
      queryFn: ({ pageParam }) => load(pageParam),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: Page<T>) => last.next ?? undefined,
      placeholderData: keepPreviousData,
    },
    queryClient,
  );
  return {
    data: isRefused(query.error)
      ? undefined
      : query.data?.pages.flatMap((page) => page.rows),
    loading: query.isFetching && !query.isFetchingNextPage,
    loadingMore: query.isFetchingNextPage,
    error: query.error?.message,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage)
        void query.fetchNextPage();
    },
    reload: () => {
      void query.refetch();
    },
    // Every row matching the current filters, fetched page by page (FLOW-216).
    loadAll: (onProgress?: (rows: number) => void) =>
      loadEveryPage(load, onProgress),
  };
}

// "Load more" under a paged list; nothing when the list is complete.
export function LoadMore({
  list,
  label = "Load more",
}: {
  list: { hasMore: boolean; loadingMore: boolean; loadMore: () => void };
  label?: string;
}) {
  if (!list.hasMore) return null;
  return (
    <p className="load-more">
      <Button
        variant="outline"
        disabled={list.loadingMore}
        onClick={list.loadMore}
      >
        {list.loadingMore ? "Loading…" : label}
      </Button>
    </p>
  );
}

// The value after it has stopped changing for `delay` ms, so typing into a
// search box sends one request rather than one per keystroke.
export function useDebounced<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
