export type Bindings = {
  ASSETS: { fetch: typeof fetch };
  SENTRY_DSN?: string;
  APP_VERSION?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  APP_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  // "enabled" only in the dev environment; exposes /api/dev/db-check.
  DB_CHECK_ROUTE?: string;
  // Ingestion secrets (Worker secrets, FLOW-28). Comma-separate several to rotate.
  INGEST_TOKEN_LEADS?: string;
  INGEST_TOKEN_THUMBTACK?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
  // File storage (FLOW-42). Account id and bucket are vars in wrangler.jsonc; the
  // R2 API token's key pair are Worker secrets used to sign upload/download URLs.
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  // Notification email (FLOW-43, set up in FLOW-33): the Resend API key (Worker
  // secret) and the verified sender, e.g. "Flowbase <notifications@…>". Without
  // both, notifications stay in the app and emails are skipped.
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  // Optional R2 binding to the same bucket, used only to confirm uploads arrived.
  FILES?: {
    head: (key: string) => Promise<{ size: number } | null>;
  };
};
