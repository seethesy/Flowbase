export type Bindings = {
  ASSETS: { fetch: typeof fetch };
  SENTRY_DSN?: string;
  APP_VERSION?: string;
  HYPERDRIVE?: { connectionString: string };
};
