import { useEffect, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { clsx } from "clsx";
import { useUnsavedEdits } from "../../app/unsavedEdits";

// In-place editing of a record page (FLOW-334, FLOW-335). The page's Edit
// button turns every stored field it shows into an input where the value was,
// in the same card and under the same label; one Save / Cancel in the heading
// saves or drops them all. Calculated values have no input and stay as text,
// marked read-only.

// One labeled value in an .info-grid. With `editing` and an `input`, the input
// takes the value's place under the label; with `editing` and no input, the
// value is calculated (or edited elsewhere) and shows as read-only.
export function InfoItem({
  label,
  editing = false,
  input,
  wide = false,
  children,
}: {
  label: ReactNode;
  editing?: boolean;
  input?: ReactNode;
  // Spans the grid's full width (long text).
  wide?: boolean;
  children: ReactNode;
}) {
  if (editing && input !== undefined)
    return (
      <label className={clsx("info-item info-item--editing", wide && "info-item--wide")}>
        <small>{label}</small>
        {input}
      </label>
    );
  return (
    <div className={clsx(editing && "info-item info-item--readonly", wide && "info-item--wide") || undefined} data-readonly={editing || undefined}>
      <small>{label}</small>
      <strong>{children}</strong>
    </div>
  );
}

// While a record page has unsaved edits: leaving it in the app asks first, and
// so does closing or reloading the tab. Mount it only in Edit mode (useBlocker
// needs the app's data router).
export function UnsavedLeaveGuard({ dirty, message = "Discard your unsaved changes?" }: { dirty: boolean; message?: string }) {
  // A new app version waits for these to be saved (FLOW-325).
  useUnsavedEdits(dirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  return null;
}
