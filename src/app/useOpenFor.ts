import { useState } from "react";

// State that belongs to one record (FLOW-197): an open form or dialog, a draft
// field, an error message. It holds its value only while the page still shows
// that record; navigating to another id gives back `initial`, so a draft opened
// for A can never be saved while the page shows B, and coming back to A starts
// fresh. Drop-in for useState when only plain values are set.
export function useStateFor<T>(id: string, initial: T) {
  const [state, setState] = useState<{ id: string; value: T }>({
    id,
    value: initial,
  });
  // A new record discards the old record's value right away (React's "adjust state
  // when a prop changes" pattern), so returning to A later doesn't revive it.
  if (state.id !== id) setState({ id, value: initial });
  const value = state.id === id ? state.value : initial;
  const set = (next: T) => setState({ id, value: next });
  return [value, set] as const;
}

// A form or dialog opened for one record; closes when the page moves to another.
export const useOpenFor = (id: string) => useStateFor(id, false);
