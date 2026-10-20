import * as Sentry from "@sentry/cloudflare";
import { createApp } from "./app";
import { checkDatabase } from "./health";
import type { Bindings } from "./bindings";
import { APP_VERSION } from "../shared/version";

const app = createApp({
  checkDatabase,
  captureError: (error, requestId) => {
    Sentry.captureException(error, { tags: { requestId } });
  },
});
export default Sentry.withSentry(
  (env: Bindings) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    release: env.APP_VERSION ?? APP_VERSION,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  }),
  {
    fetch: (
      request: Request,
      env: Bindings,
      ctx: Parameters<typeof app.fetch>[2],
    ) => app.fetch(request, env, ctx),
  },
);
