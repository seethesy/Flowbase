import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  type QueryKey,
} from "@tanstack/react-query";
import type { Page } from "../services/core";
import { Button } from "../components/shared";
import { queryClient } from "./queryClient";

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
    data: query.data?.pages.flatMap((page) => page.rows),
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
