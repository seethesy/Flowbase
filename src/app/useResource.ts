import {
  keepPreviousData,
  useQuery,
  type QueryKey,
} from "@tanstack/react-query";
import { queryClient, REFERENCE_STALE_MS } from "./queryClient";

export type ResourceOptions = {
  // A list several forms on one page use (clients, venues, sections): reused
  // for a few minutes instead of fetched again by each form (FLOW-189 AC3).
  reference?: boolean;
  // Keep showing the last result while a new key loads (a search as you type).
  // Off by default, so a page never shows one record while loading another.
  keepPrevious?: boolean;
  enabled?: boolean;
};

// TanStack Query refuses undefined as a result; loaders that have nothing to
// fetch return undefined, stored as this marker.
const nothing = Symbol("nothing");

// Loads data from the API for a screen (ADR-01, FLOW-189). `key` names the data
// — the same key anywhere on the page shares one request and one cached copy —
// so it must include every input `load` uses.
export function useResource<T>(
  key: QueryKey,
  load: () => Promise<T>,
  options: ResourceOptions = {},
) {
  const query = useQuery(
    {
      queryKey: key,
      queryFn: async () => {
        const data = await load();
        return data === undefined ? nothing : data;
      },
      staleTime: options.reference ? REFERENCE_STALE_MS : undefined,
      placeholderData: options.keepPrevious ? keepPreviousData : undefined,
      enabled: options.enabled,
    },
    queryClient,
  );
  const data = query.data === nothing ? undefined : (query.data as T | undefined);
  return {
    data,
    error: query.error?.message,
    loading:
      query.isFetching || (query.isPending && options.enabled !== false),
    reload: () => {
      void query.refetch();
    },
    // Shows a value the API just returned (after a save) without refetching.
    replace: (value: T) => {
      queryClient.setQueryData(key, value === undefined ? nothing : value);
    },
  };
}
