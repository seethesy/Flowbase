# Flowbase v0.1

A small, fictional Clients and inventory management demo for a catering team of 15–20 employees. Forest & Sage branding, a responsive sidebar, and browser-local interactions. **This is an interactive frontend prototype. All records are fictional. Changes reset on refresh.**

## Setup

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run build
npm run dev:worker
```

The Worker serves the built SPA and `/api/*` at `http://localhost:8787`. `GET /api/health` returns `{ ok: true, version, database }`. For frontend hot reload, run `npm run dev` in another terminal; Vite proxies `/api` to the local Worker. Rebuild to update the SPA served by Wrangler. Hash routing supports direct record URLs and browser back/forward without server rewrites. Fonts are bundled locally.

No credentials are needed for the fixture demo. `.env.example` lists optional Sentry configuration and the disposable CI database URL. Keep later local Worker secrets in ignored `.dev.vars`, and Vite variables in ignored `.env.local`. Never put secrets in `VITE_*`, which are shipped to the browser.

## Explore

- **Dashboard:** date-range sample datasets, KPI navigation, activity links, proposal status chart, stock alerts, and upcoming events.
- **Clients:** client/contact search, status and owner filters, sorting, pagination, create/edit forms, and client details with Overview, Contacts, Proposals, Events, Notes, and Files tabs. Archiving requires confirmation.
- **Proposals:** pipeline/table toggle, shared filters, numeric sorting, date filtering, pagination, drag-and-drop cards, and detail/edit drawers. The status selector is the keyboard-accessible alternative to dragging. Lost requires confirmation and a reason. Signed is final; Draft cannot jump straight to Signed. Lost may reopen as Draft.
- **Inventory:** SKU/name search, category/status filters, numeric quantity sorting, pagination, item forms, detailed stock/history/purchasing/usage/notes/files tabs, and simulated receipts/adjustments. Available = on hand − reserved; <=0 means Out of Stock; <=reorder point means Low Stock.
- Global search finds clients, proposal IDs/names, and inventory; notifications link to sample records. Purchasing, Events, Reports, Settings, and Help are labeled placeholders. Employee profile is fictional.

Seeded data: 35 clients, 45 contacts, 40 proposals, 50 items, 15 vendors, 12 purchase orders, 10 events, 8 employee profiles, activity and attachment metadata. Dashboard date ranges intentionally select different mock subsets rather than querying a backend.

## Architecture

React + strict TypeScript + Vite; Tailwind CSS; Radix/shadcn-style components; Lucide; React Router; TanStack Table; Recharts; dnd-kit. Shared components live in `src/components`, feature screens in `src/features`, and typed fixtures in `src/data/mock`.

A Hono Worker in `worker/` handles the API, and one `wrangler.jsonc` serves `dist/` as static assets on the same origin. App and API infer record types from Zod schemas in `shared/records.ts`. The build typechecks both targets before bundling. The async `RecordService<T>` adapter loads fixtures from `/api/demo/*`, validates writes through the API, and keeps changes in browser memory until refresh. Demo endpoints validate and echo writes; they do not persist records. Context publishes loaded snapshots for rendering; screens await mutations before reporting success. Database access lives in `worker/db/` (see [Database](#database)). Binding decisions, principles, and terms are copied from FLOW-1 in [docs/architecture.md](docs/architecture.md).

## CI and testing

GitHub Actions (`.github/workflows/ci.yml`) is the execution authority. Local test/check execution is prohibited by the repository workflow. Every PR runs lint, app and Worker typechecks, frontend Vitest, Node Worker tests, migration drift checks, Postgres integration tests, build, and desktop/mobile Playwright against the actual Worker. PRs changing only Markdown skip Playwright. Superseded runs on the same PR are cancelled; npm and Chromium are cached. Merge-to-main does not start a duplicate CI run. No workflow requires production credentials or repository secrets.

Postgres 17 runs as a disposable service with public CI-only credentials. `DATABASE_URL` points only to that service. `worker/db/schema.ts` and the Drizzle migrations in `drizzle/` define the application schema. The DB suite applies committed migrations, checks the base column conventions and soft delete on the real tables, tests a separate CI fixture for reads/writes/rollback, and checks `pg_class.relrowsecurity` and browser-facing policies for all application tables. The drift check runs Drizzle generation and rejects both modified and newly generated migration files. CI does not contact Hyperdrive or any deployed database; that path is covered by the manual live check in [Database](#database).

Commands used by CI:

```sh
npm run lint
npm run typecheck
npm run typecheck:worker
npm test
npm run test:worker
npm run db:check
npm run test:db
npm run build
npm run test:e2e
```

Manual workflow verification: push two commits to a PR while the first run is active and confirm cancellation; check npm/Chromium cache hits on a subsequent run; open a Markdown-only PR and confirm Playwright is skipped. Review Actions billing minutes after runs: the account's 2,000 monthly free minutes are shared with ops schedules, so avoid redundant pushes. Cloud setup and production deploy verification remain developer tasks.

## Demo limitations

No real authentication, database, external API integrations, uploads, email delivery, signatures, PDF generation, or production inventory transactions. Attachments are filename/size metadata only. Purchase orders are read-only sample records. Simulated operations update only React memory. No authentication or R2 integration is configured, and a database is bound only in the dev environment (see [Database](#database)). The deployable unit is the Worker and its static SPA assets. No secrets or real client data are stored in the repository. This prototype targets WCAG 2.2 AA, but does not claim an independent accessibility audit.

## Database

Supabase Free Postgres (`flowbase-prod` `hzmgxkyitvlzcnecywai`, `flowbase-dev` `qlnjdckcrawrcgcoecpl`), reached from the Worker through Hyperdrive with caching disabled. The browser never queries the database. Schema and migrations are Drizzle only: `worker/db/schema.ts` defines tables and `drizzle/` holds the generated SQL and snapshots. Never edit generated migrations by hand, and never change the database any other way.

**Connection string type: direct connection.** Both Hyperdrive configs use Supabase's direct connection string (`db.<project-ref>.supabase.co:5432`), which Hyperdrive reaches over IPv6. The session pooler is not needed and the paid IPv4 add-on is never used. This is recorded from the developer's answer on FLOW-24; confirm it with the live check below. If that check fails to connect, recreate the Hyperdrive config with the session pooler string (`--caching-disabled`), then update this paragraph. Your own laptop may lack IPv6: for `db:migrate` only, use the dev project's session pooler string as `DATABASE_URL`.

**Conventions** (`worker/db/conventions.ts`; CI tests enforce them):

- UUID primary keys generated by the database (`gen_random_uuid()`).
- `created_at`, `updated_at` (set on every Drizzle update), `created_by`, `updated_by`. The two `*_by` columns are nullable and have no foreign key until the users table exists.
- Soft delete through `archived_at`; list queries exclude archived rows.
- Money as integer cents (`moneyCents`), all times as `timestamptz` (`timestamptz`).
- RLS on every table with no browser-facing policies.

**Adding a table:** spread `...baseColumns()` into `pgTable(...)`, end it with `.enableRLS()`, run `npm run db:generate`, and commit the SQL and snapshot together with the schema change. CI rejects a schema without a matching migration, and any table in `public` without RLS.

**Using it in the Worker:** `withDb(env, (db) => ...)` in `worker/db/client.ts` opens a request-local postgres.js client from the `HYPERDRIVE` binding (`max: 5`, `fetch_types: false`, prepared statements on), runs the callback with a typed Drizzle `db`, and always closes the client. Without the binding it throws `DatabaseNotConfiguredError`; `/api/health` keeps reporting `not_configured`.

**Environments** (`wrangler.jsonc`). There is deliberately no top-level Hyperdrive binding, so plain `wrangler dev` and CI run without a database. `--env dev` binds the dev Hyperdrive config and enables `/api/dev/db-check`; `--env production` binds the production config and is wired into the deploy pipeline in FLOW-25. Outside the dev environment `/api/dev/*` answers 404.

**Migrate the dev database:**

```sh
DATABASE_URL="<dev connection string>" npm run db:migrate
```

**Live check through Hyperdrive (manual, dev only).** CI cannot reach Hyperdrive, so run this once after migrating. It writes to the dev database.

```sh
npx wrangler dev --remote --env dev
curl -X POST http://localhost:8787/api/dev/db-check -d '{"note":"hello"}'
curl http://localhost:8787/api/dev/db-check
curl http://localhost:8787/api/health
```

The POST returns `201` with the new row, the GET lists it, and health reports `database: "reachable"`. Local mode (without `--remote`) skips Hyperdrive and needs `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`; see `.env.example`.

## Background jobs

`worker/jobs/queue.ts` (FLOW-27) is the outbox and work queue, stored in the `jobs` table.

- **Enqueue inside the change's transaction.** `enqueueJob(tx, { type, payload, idempotencyKey })` and `emitDomainEvent(tx, { name, entityId, data })` take the caller's transaction, so a rolled-back change never leaves a job behind. A repeated idempotency key is ignored. Domain events are jobs of type `event:<name>` (`<entity>.<past-tense verb>`, e.g. `client.created`).
- **Handlers** register by type in `createJobRegistry()` (`worker/jobs/cron.ts`). Handlers must be idempotent. An event with no subscriber succeeds as a no-op; any other job type without a handler fails.
- **Cron.** One Cron Trigger (`*/5 * * * *` in `wrangler.jsonc`) runs `runDueJobs`, which claims at most 10 due jobs (`FOR UPDATE SKIP LOCKED`) so each run stays within the 10 ms CPU budget. A throwing handler retries after 30 s, 1 min, 2 min, … (capped at 1 h) and is marked `failed` after 5 attempts. A job stuck in `running` for 10 minutes is reclaimed. Without a Hyperdrive binding the cron logs `jobs_skipped` and does nothing.
- **Admin API:** `GET /api/admin/jobs?status=failed` lists jobs; `POST /api/admin/jobs/<id>/retry` re-queues a failed job with fresh attempts.

## Machine ingestion

`POST /api/ingest/<source>` (FLOW-28) is how outside systems push data in. Each request must authenticate, be at most 256 KB, and name its record; otherwise nothing is stored (401, 413 or 400). The raw body is stored once per source + record id in `ingest_receipts` with an `ingest.process` job in the same transaction; a repeat answers `200` with `duplicate: true` and creates nothing.

| Source | Auth | Record id | Worker secret |
| --- | --- | --- | --- |
| `leads` (lead collector, FLOW-102) | `Authorization: Bearer <token>` | `sourceRecordId` in the JSON body | `INGEST_TOKEN_LEADS` |
| `shopify` (FLOW-109) | Shopify HMAC (`X-Shopify-Hmac-Sha256`) | `X-Shopify-Webhook-Id` header | `SHOPIFY_WEBHOOK_SECRET` |

Thumbtack (FLOW-108) adds its own row once its payload and auth scheme are known. Each source's ticket also registers the processor that turns a receipt into records (`ingestProcessors` in `worker/ingest/receipts.ts`); until then receipts are stored and left unprocessed.

**Rotating a secret:** set the secret to `old,new` (`npx wrangler secret put INGEST_TOKEN_LEADS --env production`), switch the sender to the new value, then set it to `new` alone.

**Admin API:** `GET /api/admin/ingest-receipts?status=failed&source=leads` lists receipts with their job status; `POST /api/admin/ingest-receipts/<id>/replay` queues a new processing job for a receipt whose job failed.

**Sign-in.** Admin routes check permissions through `worker/policy.ts`, a stand-in for the FLOW-38 matrix. Until sign-in (FLOW-36) resolves the caller, no request has a user, so every `/api/admin/*` route answers `401` in deployed environments.

## Observability

Worker API requests emit JSON logs and return `X-Request-ID`. All API errors use `{ error: { code, message, requestId } }`; unexpected failures return a generic message and send the exception to Sentry tagged with that same ID. The SPA displays request references on API failures. Set `SENTRY_DSN` as a Worker secret and `VITE_SENTRY_DSN` as a public SPA build variable to enable Sentry; without DSNs, reporting is disabled. `APP_VERSION` optionally overrides the Worker release; both targets otherwise use the package version. Browser errors are captured by Sentry's React integration and error boundary. Request/user objects are stripped from Sentry events, and tracing/replays are disabled. Cloudflare request logs are enabled in Wrangler. Use only the Sentry free plan; monitor its event quota and Cloudflare usage before go-live.

Health reports Worker liveness plus version and `database: reachable | unreachable | not_configured`. With an optional `HYPERDRIVE` binding it executes `select 1` using a request-local Postgres.js client, then closes it. A missing binding is reported as `not_configured`; it is never treated as a verified database connection. Hyperdrive binding IDs and the connection decision are in [Database](#database); live dev verification is a manual check there.

Manual telemetry check after developer setup: configure both DSNs, trigger a controlled Worker failure in a development environment, and confirm the event's request ID matches its response header and Cloudflare log. Trigger a browser render error and confirm the fallback and Sentry event. No failure-trigger route is shipped. Confirm both projects remain on free tiers and inspect quotas. CI verifies middleware, SDK wiring, and DB-probe states without contacting Sentry or production resources.
