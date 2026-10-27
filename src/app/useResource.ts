import {
  keepPreviousData,
  useQuery,
  type QueryKey,
} from "@tanstack/react-query";
import { queryClient, REFERENCE_STALE_MS } from "./queryClient";
import { ApiRequestError } from "../services/core";

export type ResourceOptions<T = unknown> = {
  // A list several forms on one page use (clients, venues, sections): reused
  // for a few minutes instead of fetched again by each form (FLOW-189 AC3).
  reference?: boolean;
  // Keep showing the last result while a new key loads (a search as you type).
  // Off by default, so a page never shows one record while loading another.
  keepPrevious?: boolean;
  enabled?: boolean;
  // Data that goes bad at a known time, e.g. signed download links (FLOW-201):
  // returns when the loaded data expires. The data is renewed shortly before
  // then while the page is visible, and at once when a page that was hidden
  // past it is shown again. Nothing runs while the page is hidden or after the
  // screen unmounts.
  expiresAt?: (data: T) => string | null | undefined;
};

// Renew expiring data this long before it expires, so a link is never handed
// out in its last seconds.
export const RENEW_BEFORE_MS = 30_000;

// Data the reader may no longer see (FLOW-206): after an access change or
// another user's archive, a refetch answers 403 or 404, and the copy loaded
// before must not stay on screen.
export const isRefused = (error: unknown) =>
  error instanceof ApiRequestError &&
  (error.status === 403 || error.status === 404);

// TanStack Query refuses undefined as a result; loaders that have nothing to
// fetch return undefined, stored as this marker.
const nothing = Symbol("nothing");

// Loads data from the API for a screen (ADR-01, FLOW-189). `key` names the data
// — the same key anywhere on the page shares one request and one cached copy —
// so it must include every input `load` uses.
export function useResource<T>(
  key: QueryKey,
  load: () => Promise<T>,
  options: ResourceOptions<T> = {},
) {
  const { expiresAt } = options;
  // Milliseconds until the loaded data should be renewed; undefined when it
  // doesn't expire.
  const renewIn = (stored: unknown) => {
    if (!expiresAt || stored === undefined || stored === nothing) return;
    const at = expiresAt(stored as T);
    if (!at) return;
    return Math.max(0, Date.parse(at) - RENEW_BEFORE_MS - Date.now());
  };
  // Typed loosely: TanStack passes its Query, whose cached data may be `nothing`.
  type Cached = { state: { data: unknown } };
  const query = useQuery(
    {
      queryKey: key,
      queryFn: async () => {
        const data = await load();
        return data === undefined ? nothing : data;
      },
      staleTime: expiresAt
        ? (cached: Cached) => renewIn(cached.state.data) ?? 0
        : options.reference
          ? REFERENCE_STALE_MS
          : undefined,
      refetchInterval: expiresAt
        ? (cached: Cached) => {
            const wait = renewIn(cached.state.data);
            return wait === undefined ? false : Math.max(wait, 1_000);
          }
        : undefined,
      // Refetches only when stale, i.e. when the page was hidden past expiry.
      // Intervals already pause while the page is hidden (TanStack default).
      refetchOnWindowFocus: Boolean(expiresAt),
      placeholderData: options.keepPrevious ? keepPreviousData : undefined,
      enabled: options.enabled,
    },
    queryClient,
  );
  const unwrap = (stored: unknown) =>
    stored === nothing ? undefined : (stored as T | undefined);
  const data = isRefused(query.error) ? undefined : unwrap(query.data);
  return {
    data,
    error: query.error?.message,
    loading:
      query.isFetching || (query.isPending && options.enabled !== false),
    reload: () => {
      void query.refetch();
    },
    // Loads the data again and returns it, joining a load already under way
    // instead of starting another. Throws when the load fails.
    refresh: async () => {
      const result = await query.refetch({ cancelRefetch: false });
      if (result.error) throw result.error;
      return unwrap(result.data);
    },
    // Shows a value the API just returned (after a save) without refetching.
    replace: (value: T) => {
      queryClient.setQueryData(key, value === undefined ? nothing : value);
    },
  };
}
