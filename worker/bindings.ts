export type Bindings = {
  ASSETS: { fetch: typeof fetch };
  SENTRY_DSN?: string;
  APP_VERSION?: string;
  HYPERDRIVE?: { connectionString: string };
  // "enabled" only in the dev environment; exposes /api/dev/db-check.
  DB_CHECK_ROUTE?: string;
};
