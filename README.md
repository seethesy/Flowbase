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
- **Clients, Venues, Events:** real records from the API (see [Core records](#core-records)), with search, show-archived filters, create/edit forms, archive/restore and detail pages. They need sign-in (FLOW-36), so until then deployed environments show a sign-in error on these screens.
- **Proposals:** pipeline/table toggle, shared filters, numeric sorting, date filtering, pagination, drag-and-drop cards, and detail/edit drawers. The status selector is the keyboard-accessible alternative to dragging. Lost requires confirmation and a reason. Signed is final; Draft cannot jump straight to Signed. Lost may reopen as Draft.
- **Inventory:** SKU/name search, category/status filters, numeric quantity sorting, pagination, item forms, detailed stock/history/purchasing/usage/notes/files tabs, and simulated receipts/adjustments. Available = on hand − reserved; <=0 means Out of Stock; <=reorder point means Low Stock.
- Global search finds proposal IDs/names and inventory; notifications link to sample records. Purchasing, Reports, Settings, and Help are labeled placeholders. Proposals and the Dashboard still use the demo client fixtures. Employee profile is fictional.

Seeded data: 35 clients, 45 contacts, 40 proposals, 50 items, 15 vendors, 12 purchase orders, 10 events, 8 employee profiles, activity and attachment metadata. Dashboard date ranges intentionally select different mock subsets rather than querying a backend.

## Architecture

React + strict TypeScript + Vite; Tailwind CSS; Radix/shadcn-style components; Lucide; React Router; TanStack Table; Recharts; dnd-kit. Shared components live in `src/components`, feature screens in `src/features`, and typed fixtures in `src/data/mock`. Rich text (SOPs, setup and BEO notes) uses TipTap free core in `src/components/rich-text`: `RichTextEditor` stores TipTap JSON, and `RichTextView`/`renderRichText` render it to DOMPurify-sanitized HTML for screen and print. Headings, bold, italic, bulleted/numbered/checklist lists (nestable) and http(s)/mailto/tel links are supported; pasted Google Docs content keeps that formatting and drops everything else.

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

No real authentication, database, external API integrations, uploads, email delivery, signatures, PDF generation, or production inventory transactions. Attachments are filename/size metadata only. Purchase orders are read-only sample records. Simulated operations update only React memory. No authentication is configured, R2 file storage is configured only in production, and a database is bound only in the dev environment (see [Database](#database)). The deployable unit is the Worker and its static SPA assets. No secrets or real client data are stored in the repository. This prototype targets WCAG 2.2 AA, but does not claim an independent accessibility audit.

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

**Environments** (`wrangler.jsonc`). There is deliberately no top-level Hyperdrive binding, so plain `wrangler dev` and CI run without a database. `--env dev` binds the dev Hyperdrive config and enables `/api/dev/db-check`; `--env production` binds the production config and is what [Deploy](#deploy) ships; `--env preview` uploads non-production preview versions of the same Worker against the dev config. Outside the dev environment `/api/dev/*` answers 404.

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

**Backups.** Production is dumped nightly to R2 from the private ops repo with 30-day retention. Setup, contents and the restore procedure: [docs/restore.md](docs/restore.md).

## Core records

Clients (FLOW-53), venues (FLOW-54) and events (FLOW-55) live in Postgres and are served by `worker/routes/records.ts`; Zod schemas in `shared/core-records.ts` are shared by the API and the screens in `src/features/{clients,venues,events}.tsx`.

| Resource | Routes |
| --- | --- |
| Clients | `GET /api/clients?archived=&flagged=`, `GET/PUT /api/clients/<id>`, `POST /api/clients`, `POST /api/clients/<id>/archive` and `/restore` |
| Venues | the same shape under `/api/venues` |
| History | `GET /api/clients/<id>/history`, and the same under `/api/venues` and `/api/events` |
| Event status | `POST /api/events/<id>/status`, `GET /api/events/<id>/status-history` |
| Events | the same shape under `/api/events`, with `?clientId=&venueId=&from=&to=` (New York dates) |

- **Who sees what** (`worker/policy.ts`, a stand-in for FLOW-38): Admin, Technical and Sales Manager see every client and event; a salesperson sees the clients and events assigned to them (their new clients are assigned to them); other staff see the events they lead or assist and no clients. Records a user can't see answer 404. Venues are visible to everyone. Writes are open to Admin, Technical, Sales Manager and salespeople.
- **Contact details** (F-01-04): client contact email/phone and venue contacts come back as `null` for anyone who isn't FT+. An update that omits a contact's email or phone keeps the stored value.
- **Duplicates:** creating a client whose contact email or phone matches an existing contact answers `409 POSSIBLE_DUPLICATE` with the matches, and the form offers "Create anyway" (`allowDuplicate: true`). A salesperson is only warned about their own clients; a match they can't see is saved as `possibleDuplicateOf`, which only Admin, Technical and Sales Manager see (`?flagged=true`), and emits `client.duplicate_flagged`.
- **Events:** only title, date, start time and client are required. Times are entered as New York wall-clock times and stored as UTC (`shared/time.ts`); an end time before the start runs past midnight. Picking a venue copies its address (when the address is empty) and its areas; per-event areas can be added. `booked_at` records the first time the event reaches Negotiation (or a later status other than Lost, if it skipped Negotiation). People fields (salesperson, Production Lead, assistants) are user ids until the users table exists.
- Every create, update, archive and restore emits a domain event (`client.created`, `event.updated`, …) in the same transaction.
- **Lifecycle** (FLOW-56, `shared/event-lifecycle.ts`): Inquiry → Pitching → P creation → Initial P sent → Negotiation → Closing → Closed (paid and signed) → Preparation → Finished | Lost. An event can be created in any status. After that the status never changes through `PUT`: Admin or the event's salesperson changes it with `POST /api/events/<id>/status` (`{ status, reason? }`) to any other status, and the system moves it with `advanceEventStatus` (in `worker/records/events.ts`, for the features that drive it), which allows only the next status or Lost and refuses anything else with `409 INVALID_TRANSITION`. Finished and Lost are final for the system. Every change writes a row to `event_status_history` (who, when, from, to, why, manual or automatic; `GET /api/events/<id>/status-history`), writes the audit row and emits exactly one domain event, `event.<new status>` with `{ from, to, reason, manual }`.
- **History** (FLOW-41, `worker/audit/log.ts`): every create, update, archive and restore of a client, venue or event (FLOW-161) writes one row to the append-only `audit_log` in the same transaction: actor, time, and a before/after diff of only the changed fields, keyed by their API names (a client's contacts, a venue's areas and contacts, and an event's area names are fields of their record). An update that changes nothing writes no row. `GET /api/{clients,venues,events}/<id>/history` returns it newest first to anyone who can see the record, hiding what the record itself hides from them (contact details from part-time users, the possible-duplicate match from salespeople); a change made only to hidden fields doesn't appear. No route updates or deletes audit rows.

## Attachments

Photos and documents attach to clients, venues and events (FLOW-42, ADR-08) through `/api/attachments` (`worker/routes/attachments.ts`) and the `Attachments` component (`src/features/attachments.tsx`). Venues use two groups, Floor plans and Aerial images.

- **In the browser** (`src/services/attachments.ts`): a file is checked before anything uploads (photos JPEG/PNG/WebP/HEIC up to 25 MB, PDF and .docx up to 20 MB). A photo is resized on a canvas to a 320 px thumbnail and a 1600 px display JPEG; only those two are uploaded, never the original. Documents upload as they are.
- **Upload:** `POST /api/attachments` checks the record (same visibility as the record itself; records you can't see answer 404) and the declared variants, stores a pending row, and returns signed R2 `PUT` URLs valid for 5 minutes. Each URL is signed for the exact content type and length declared. The browser `PUT`s straight to R2, then `POST /api/attachments/<id>/complete` marks it ready (in production the `FILES` binding first confirms each object arrived at its declared size). The Worker never handles file bytes. Object keys are generated (`<record type>/<record id>/<attachment id>/<variant>.<ext>`); file names are only metadata.
- **Download:** `GET /api/attachments?recordType=&recordId=` returns ready files with signed `GET` URLs that expire after 5 minutes. `PATCH /api/attachments/<id>` changes caption or order; `POST /api/attachments/<id>/archive` hides a file.
- **Config:** `R2_ACCOUNT_ID` and `R2_BUCKET` (`flowbase-files`) are production vars in `wrangler.jsonc`; `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (the R2 API token's S3 key pair) are Worker secrets. Without them the routes answer `503 STORAGE_NOT_CONFIGURED`, which is the case in dev and CI. Signing is in `worker/attachments/presign.ts` (SigV4, checked against AWS's published example).
- **Bucket CORS** (one-time, Cloudflare dashboard → R2 → `flowbase-files` → Settings → CORS): allow origin `https://flowbase.sybertechlabs.workers.dev`, methods `GET` and `PUT`, header `Content-Type`.

## Printable documents

`PrintLayout` (`src/components/print/PrintLayout.tsx`, FLOW-49, ADR-17) is the shared print layout for the recipe book, order list and BEO: a company header block (name, sales contact, website from `src/config/company.ts`, placeholders until the real details are filled in), US Letter pages with the header repeated on every page, and page numbers where the browser supports CSS page margin boxes (Chrome; Safari prints without them). Users print or "Save as PDF" from the browser; there is no PDF server or library. `/#/print/sample` is a sample multi-page document for checking the layout.

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

## Deploy

Cloudflare Workers Builds deploys from `main`; GitHub Actions is not involved, so merges use no Actions minutes. CI on the PR remains the gate.

**Production (every merge to `main`).** Workers Builds installs dependencies from `package-lock.json`, then runs `npm run deploy`, which stops at the first failing step:

1. `npm run build`: type checks and builds the SPA into `dist/`.
2. `npm run deploy:migrate`: refuses to run without `DATABASE_URL`, then applies committed Drizzle migrations to the production database with `drizzle-kit migrate`.
3. `wrangler deploy --env production`: uploads and activates the new Worker version.

If the build or a migration fails, nothing is deployed and the previous version keeps serving. Drizzle applies the pending migrations in one transaction, so a failing migration leaves the schema as it was. Migrations run before the new code goes live, so they must stay compatible with the version currently serving (add columns and tables first; remove them in a later release).

**Non-production branches.** Workers Builds runs `npm run deploy:preview`, which builds and runs `wrangler versions upload --env preview`. That creates a preview version of the `flowbase` Worker bound to the dev database, reachable at its preview URL and never serving production traffic. Previews do not run migrations; migrate the dev database manually (see [Database](#database)) when a branch changes the schema.

**Workers Builds settings** (Worker `flowbase` → Settings → Build; developer-configured):

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | *(empty; `npm run deploy` builds)* |
| Deploy command | `npm run deploy` |
| Non-production branch builds | enabled |
| Non-production branch deploy command | `npm run deploy:preview` |

**Build variables** (names only; values live in Cloudflare, never in this repo):

- `DATABASE_URL`: production Postgres connection string used for migrations. Set it as a secret build variable. Use the `flowbase-prod` session pooler string if the build environment cannot reach the direct connection over IPv6.
- `VITE_SENTRY_DSN`: public SPA Sentry DSN (optional; see [Observability](#observability)).
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`: provided by Workers Builds automatically.

Runtime secrets such as `SENTRY_DSN` are Worker secrets (`wrangler secret put SENTRY_DSN --env production`), not build variables.

**Rollback.** Roll back to the previous production deployment:

```sh
npx wrangler rollback --env production
```

To pick a specific version, list deployments with `npx wrangler deployments list --env production` and pass its version ID: `npx wrangler rollback <version-id> --env production`. Choose a version from the deployments list, not a preview version. Rollback does not undo migrations; fix forward with a new migration if the schema must change back.

**Manual verification.** Merge a trivial change, then in the Cloudflare dashboard confirm the build log shows the build, migrate and deploy steps and that the new version is active. A failing step ends the build before `wrangler deploy`, so the active version in the dashboard stays the same.

## Observability

Worker API requests emit JSON logs and return `X-Request-ID`. All API errors use `{ error: { code, message, requestId } }`; unexpected failures return a generic message and send the exception to Sentry tagged with that same ID. The SPA displays request references on API failures. Set `SENTRY_DSN` as a Worker secret and `VITE_SENTRY_DSN` as a public SPA build variable to enable Sentry; without DSNs, reporting is disabled. `APP_VERSION` optionally overrides the Worker release; both targets otherwise use the package version. Browser errors are captured by Sentry's React integration and error boundary. Request/user objects are stripped from Sentry events, and tracing/replays are disabled. Cloudflare request logs are enabled in Wrangler. Use only the Sentry free plan; monitor its event quota and Cloudflare usage before go-live.

Health reports Worker liveness plus version and `database: reachable | unreachable | not_configured`. With an optional `HYPERDRIVE` binding it executes `select 1` using a request-local Postgres.js client, then closes it. A missing binding is reported as `not_configured`; it is never treated as a verified database connection. Hyperdrive binding IDs and the connection decision are in [Database](#database); live dev verification is a manual check there.

Manual telemetry check after developer setup: configure both DSNs, trigger a controlled Worker failure in a development environment, and confirm the event's request ID matches its response header and Cloudflare log. Trigger a browser render error and confirm the fallback and Sentry event. No failure-trigger route is shipped. Confirm both projects remain on free tiers and inspect quotas. CI verifies middleware, SDK wiring, and DB-probe states without contacting Sentry or production resources.
