import { Button } from "./shared";
import { T } from "../app/copy";
import { reloadToUpdate, useUpdateWaiting } from "../app/appUpdate";

// A new version of Flowbase is ready (FLOW-325). It also loads on the next
// navigation when nothing is unsaved; this lets the person reload now.
export function AppUpdateNotice() {
  const waiting = useUpdateWaiting();
  if (!waiting) return null;
  return (
    <aside className="demo-callout app-update-notice" role="status" aria-label="New version">
      <p>
        <strong><T id="app-update.notice.new-version">New version of Flowbase available.</T></strong>{" "}
        <T id="app-update.notice.save-first">Save anything you're working on, then reload.</T>
      </p>
      <Button onClick={reloadToUpdate}>
        <T id="app-update.notice.reload">Reload</T>
      </Button>
    </aside>
  );
}
