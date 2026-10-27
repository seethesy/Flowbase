import { useEffect, useRef, useState } from "react";
import type { Page } from "../services/core";
import { Button } from "../components/shared";

// A list screen's rows, one API page at a time (FLOW-179). The first page loads
// whenever `inputs` (filters, search) change; loadMore appends the next. A
// response for filters that have since changed is ignored, so a slow page can't
// replace a newer list. Rows stay on screen while a new first page loads.
export function usePagedList<T>(
  load: (cursor?: string) => Promise<Page<T>>,
  inputs: unknown[],
) {
  const [state, setState] = useState<{
    rows?: T[];
    next: string | null;
    loading: boolean;
    loadingMore: boolean;
    error?: string;
  }>({ next: null, loading: true, loadingMore: false });
  const generation = useRef(0);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const current = ++generation.current;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    load().then(
      (page) => {
        if (generation.current === current)
          setState({
            rows: page.rows,
            next: page.next,
            loading: false,
            loadingMore: false,
          });
      },
      (error: Error) => {
        if (generation.current === current)
          setState({
            next: null,
            loading: false,
            loadingMore: false,
            error: error.message,
          });
      },
    );
    // load is recreated every render; inputs decide when to refetch.
  }, [...inputs, version]);
  const loadMore = () => {
    const cursor = state.next;
    if (!cursor || state.loadingMore) return;
    const current = generation.current;
    setState((previous) => ({ ...previous, loadingMore: true }));
    load(cursor).then(
      (page) => {
        if (generation.current === current)
          setState((previous) => ({
            ...previous,
            rows: [...(previous.rows ?? []), ...page.rows],
            next: page.next,
            loadingMore: false,
          }));
      },
      (error: Error) => {
        if (generation.current === current)
          setState((previous) => ({
            ...previous,
            loadingMore: false,
            error: error.message,
          }));
      },
    );
  };
  return {
    data: state.rows,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    hasMore: state.next !== null,
    loadMore,
    reload: () => setVersion((current) => current + 1),
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
