export type Bindings = {
  ASSETS: { fetch: typeof fetch };
  SENTRY_DSN?: string;
  APP_VERSION?: string;
  HYPERDRIVE?: { connectionString: string };
  // "enabled" only in the dev environment; exposes /api/dev/db-check.
  DB_CHECK_ROUTE?: string;
  // Ingestion secrets (Worker secrets, FLOW-28). Comma-separate several to rotate.
  INGEST_TOKEN_LEADS?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
};
