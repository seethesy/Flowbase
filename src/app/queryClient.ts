import { QueryClient } from "@tanstack/react-query";

// Server data for every screen goes through TanStack Query (ADR-01, FLOW-189).
// One client for the app, so screens and forms that ask for the same data
// share one request and one cached copy.
//
// Data is reused for 30 seconds before a screen that opens it fetches it again
// (FLOW-304): another user's change reaches open screens through the "changed"
// ping (liveUpdates.ts), and a save in this browser marks the areas it changed
// stale at once (`send` in services/core.ts). Failures show at once (no
// retries), and switching back to the browser tab doesn't refetch. Queries run
// with no signal too, so a screen shows the saved offline copy or an error
// instead of waiting for the network to return (FLOW-150).
export const DEFAULT_STALE_MS = 30_000;
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: DEFAULT_STALE_MS, retry: false, refetchOnWindowFocus: false, networkMode: "always" },
  },
});

// How long a reference list (clients and venues for pickers, inventory
// sections) is reused before it is fetched again. A save marks the areas it
// changed stale (see `send` in services/core.ts), so this only bounds how long
// another user's change can take to appear in a picker when no ping arrives.
export const REFERENCE_STALE_MS = 5 * 60_000;
