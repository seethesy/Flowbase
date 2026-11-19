import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  SEARCH_MIN_LENGTH,
  searchResultTypeLabels,
  type SearchResult,
} from "../../shared/search";
import { searchApi } from "../services/search";
import { EmptyState, LoadingSkeleton, SearchInput } from "../components/shared";
import "./search.css";
import { T, useCopy } from "../app/live-copy";

// Waits for typing to pause before asking the API.
const DEBOUNCE_MS = 250;

// Global search (FLOW-46): clients, leads, events, venues, inventory items,
// vendors (FLOW-84) and recipes (FLOW-217) from one box, fuzzy enough to forgive a typo, and limited to
// what the user may see.
export function GlobalSearch({ onOpen }: { onOpen: (path: string) => void }) {
  const copyPlaceholder = useCopy("search.global-search.placeholder-search-clients-leads-events-venues-items", "Search clients, leads, events, venues, items, vendors, recipes…");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<{
    query: string;
    results: SearchResult[];
    error?: string;
    loading: boolean;
  }>({ query: "", results: [], loading: false });
  const term = search.trim();
  useEffect(() => {
    if (term.length < SEARCH_MIN_LENGTH) {
      setState({ query: term, results: [], loading: false });
      return;
    }
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      searchApi.search(term).then(
        (results) => active && setState({ query: term, results, loading: false }),
        (error: Error) =>
          active &&
          setState({ query: term, results: [], error: error.message, loading: false }),
      );
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [term]);
  const ready = term.length >= SEARCH_MIN_LENGTH && state.query === term && !state.loading;
  return (
    <>
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={copyPlaceholder}
      />
      {state.error && ready && (
        <p role="alert" className="error-message">
          {state.error}
        </p>
      )}
      {term.length >= SEARCH_MIN_LENGTH && !ready && <LoadingSkeleton />}
      {ready &&
        state.results.map((result) => (
          <button
            key={`${result.type}-${result.id}`}
            className="search-result"
            onClick={() => {
              onOpen(result.path);
              setSearch("");
            }}
          >
            <div>
              <strong>{result.title}</strong>
              <small>
                {searchResultTypeLabels[result.type]}
                {result.subtitle && ` · ${result.subtitle}`}
              </small>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))}
      {(term.length < SEARCH_MIN_LENGTH || (ready && !state.error && !state.results.length)) && (
        <EmptyState
          title={term.length < SEARCH_MIN_LENGTH ? <T id="search.global-search.everything-in-one-place">Everything, in one place</T> : <T id="search.global-search.no-matching-records">No matching records</T>}
          description={
            term.length < SEARCH_MIN_LENGTH
              ? <T id="search.global-search.type-a-name-email-phone-number">Type a name, email, phone number or item code to begin.</T>
              : <T id="search.global-search.try-another-spelling-or-part-of">Try another spelling, or part of the name.</T>
          }
        />
      )}
    </>
  );
}
