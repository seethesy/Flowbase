import * as Sentry from "@sentry/react";
import { APP_VERSION } from "../shared/version";

export function initializeObservability() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: APP_VERSION,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
}
