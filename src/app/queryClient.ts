import { QueryClient } from "@tanstack/react-query";

// Server data for every screen goes through TanStack Query (ADR-01, FLOW-189).
// One client for the app, so screens and forms that ask for the same data
// share one request and one cached copy.
//
// The defaults keep how screens behaved before the cache: data is refetched
// whenever a screen opens it (stale at once), failures show at once (no
// retries), and switching back to the browser tab doesn't refetch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 0, retry: false, refetchOnWindowFocus: false },
  },
});

// How long a reference list (clients and venues for pickers, inventory
// sections) is reused before it is fetched again. Every save marks all cached
// data stale (see `send` in services/core.ts), so this only bounds how long
// another user's change can take to appear in a picker.
export const REFERENCE_STALE_MS = 5 * 60_000;
