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
  // Per-user Google Calendar sync (FLOW-268): the OAuth client (Worker secrets)
  // and GOOGLE_TOKEN_KEY, 32 random bytes in base64 that encrypt refresh tokens.
  // Without all three, Calendar shows Google Calendar as not set up.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_TOKEN_KEY?: string;
  // Usage figures from Cloudflare (FLOW-305): an account-scoped API token with
  // Account Analytics: Read only (Worker secret), the account id, the Worker's
  // script name and the Hyperdrive config id (vars). Without the token and the
  // account id, request and query counts are estimated in the isolate.
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_WORKER_NAME?: string;
  CF_HYPERDRIVE_ID?: string;
  // Optional R2 binding to the same bucket: confirms uploads arrived and removes
  // abandoned or long-archived files (FLOW-188).
  FILES?: {
    head: (key: string) => Promise<{ size: number } | null>;
    delete: (keys: string | string[]) => Promise<void>;
    // Used to copy a layout's images to new keys (FLOW-237). Absent in tests that
    // don't exercise copying; without them images are not copied.
    get?: (key: string) => Promise<{
      arrayBuffer: () => Promise<ArrayBuffer>;
      httpMetadata?: { contentType?: string };
    } | null>;
    put?: (
      key: string,
      value: ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ) => Promise<unknown>;
  };
};
