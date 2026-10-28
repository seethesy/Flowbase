import { useState, type ReactNode } from "react";
import { STALE_CODE } from "../../shared/schema-primitives";
import { ApiRequestError } from "../services/core";

// A save refused because the record changed since the form loaded it (FLOW-186).
export const isStale = (error: unknown) =>
  error instanceof ApiRequestError && error.code === STALE_CODE;

// Holds an edit form's copy of the record. When a save comes back 409 STALE, the
// form calls onStale: the current version is loaded and the form, keyed on its
// updatedAt, starts again from it with `conflict` saying what happened. The
// user's unsaved changes are not merged in; they make them again.
export function StaleReload<R extends { id: string; updatedAt: string }>({
  record,
  load,
  what,
  children,
}: {
  record: R | undefined;
  load: (id: string) => Promise<R>;
  // "client", "venue", "event", "item".
  what: string;
  children: (form: {
    record: R | undefined;
    conflict: string;
    onStale: () => Promise<void>;
  }) => ReactNode;
}) {
  const [current, setCurrent] = useState(record);
  const [conflict, setConflict] = useState("");
  const onStale = async () => {
    if (!current) return;
    try {
      setCurrent(await load(current.id));
      setConflict(
        `This ${what} changed since you opened it, so your changes weren't saved. The form now shows the current version: make your changes again and save.`,
      );
    } catch (error) {
      setConflict(
        `This ${what} changed since you opened it, so your changes weren't saved, and the current version couldn't be loaded: ${(error as Error).message}`,
      );
    }
  };
  return <>{children({ record: current, conflict, onStale })}</>;
}
