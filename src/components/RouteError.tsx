import { useEffect, useState } from "react";
import { useRouteError } from "react-router-dom";
import { T } from "../app/copy";
import { isChunkLoadError, reloadForStaleChunk } from "../app/appUpdate";

// A screen that failed to load (FLOW-325). A screen chunk removed by a deploy
// reloads the app once, which loads the new version; anything else shows a
// plain message instead of a broken screen.
export function RouteError() {
  const error = useRouteError();
  const [reloading] = useState(() => isChunkLoadError(error) && reloadForStaleChunk());
  useEffect(() => {
    if (!reloading) console.error(error);
  }, [error, reloading]);
  if (reloading) {
    return <p role="status"><T id="app-update.route-error.loading-new-version">Loading the new version of Flowbase…</T></p>;
  }
  return (
    <p role="alert">
      <T id="app-update.route-error.unable-to-display">Unable to display this page. Please refresh to retry.</T>
    </p>
  );
}
