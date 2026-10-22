import { useEffect, useState } from "react";

// Loads data from the API for a screen and reloads when its inputs change.
export function useResource<T>(load: () => Promise<T>, inputs: unknown[]) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    load().then(
      (data) => {
        if (active) setState({ data, loading: false });
      },
      (error: Error) => {
        if (active) setState({ error: error.message, loading: false });
      },
    );
    return () => {
      active = false;
    };
    // load is recreated every render; inputs decide when to refetch.
  }, [...inputs, version]);
  return {
    ...state,
    reload: () => setVersion((current) => current + 1),
    replace: (data: T) => setState({ data, loading: false }),
  };
}
