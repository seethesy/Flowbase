# Development

`drizzle/meta` keeps only its newest snapshot. `npm run db:generate` prunes older snapshots after Drizzle writes a migration; the SQL migrations and journal remain complete. `npm run db:check` still checks migration drift. Generated snapshots, the lockfile and generated live-edit keys are marked as generated in GitHub. Open them by path when needed.

## CI and testing

GitHub Actions (`.github/workflows/ci.yml`) is the execution authority. Before pushing, agents may run the focused typechecks, ESLint and unit or Worker Vitest files listed in [the agent workflow](agents-workflow.md); DB tests and Playwright stay in CI except the mobile case described there. Every PR runs lint, app and Worker typechecks, frontend Vitest, Node Worker tests, migration drift checks, Postgres integration tests, build, and desktop Playwright against the actual Worker. PRs changing only Markdown skip Playwright.

The workflow is split into parallel jobs (FLOW-285), so a PR takes about as long as its slowest job:

| Job | Runs | Postgres |
|---|---|---|
| `changes` | Markdown-only detection; its output gates `e2e` | no |
| `static` | `lint`, `build` (type-checks app and Worker, then bundles), chunk budget | no |
| `unit` | `npm test`, `npm run test:worker` | no |
| `db` | `db:check`, `test:db` twice (second shuffled), `db:seed` | yes |
| `e2e (1..4)` | `npm run test:e2e:ci -- --shard=N/4` after `vite build` | one per shard |
| `ci-ok` | passes only if every job above succeeded or was skipped | no |

`ci-ok` is the single required status check in branch protection, so adding or removing shards does not change required checks. Each e2e shard has its own database and `wrangler dev`, so the one-database / one-Worker setup below holds inside a shard. Failure traces upload as `browser-failure-artifacts-N` for the failing shard. To run one shard locally: `npx playwright test --project=desktop --project=webkit-offline --shard=1/4`.

The `mobile` Playwright project (iPhone 13 on Chromium) is not run in CI for now (FLOW-286): CI runs `npm run test:e2e:ci`, which is only `desktop` and `webkit-offline`; `npm run test:e2e` still runs every project. Phone-width coverage stays in CI where specs set their own 390×844 viewport under `desktop` (`counts`, `closeout`, `beo-print`, `beo-sections`); the `isMobile` paths in `live-edit` and `calendar` (the nav drawer) are no longer exercised in CI. When a change touches the mobile nav drawer, the `AppShell` responsive layout or phone-only screens, run `npx playwright test --project=mobile` locally. Superseded runs on the same PR are cancelled; npm and Chromium are cached. Merge-to-main does not start a duplicate CI run. No workflow requires production credentials or repository secrets.

Postgres 17 runs as a disposable service with public CI-only credentials. `DATABASE_URL` points only to that service. `worker/db/schema.ts` and the Drizzle migrations in `drizzle/` define the application schema. Before each `npm run test:db` run, `tests/db/global-setup.ts` drops and re-creates the `public` and `drizzle` schemas and applies the committed migrations once, so the suite passes again on the same database and in any file order; it refuses to run unless `DATABASE_URL` points at localhost or the CI service (FLOW-182). A test file that clears migration-seeded rows (the default inventory locations) restores them when it finishes. CI runs the suite twice, the second time in shuffled file order. The DB suite applies committed migrations, checks the base column conventions and soft delete on the real tables, tests a separate CI fixture for reads/writes/rollback, and checks `pg_class.relrowsecurity` and browser-facing policies for all application tables. The drift check runs Drizzle generation and rejects both modified and newly generated migration files. CI does not contact Hyperdrive or any deployed database; that path is covered by the manual live check in [Database](#database).

The DB setup also runs the development seed (FLOW-26). Browser tests (FLOW-183) re-create, migrate and seed the same disposable database before starting their scenarios. They share **one local `wrangler dev` process**, using `tests/e2e/wrangler.jsonc` and the separate `tests/e2e/worker.ts` entry point. That entry point alone trusts a public test signing key; the normal auth resolver still loads each seeded identity from the real allowlist, and all policies, routes and Postgres operations run normally. The production entry point never imports the test verifier. No production credentials, Google login or Supabase Auth service is needed in CI.

Browser tests run serially and reset data between scenarios, without repeating migrations or restarting the Worker. Existing create/edit, transfer, count, lead conversion, search and tracking scenarios use database fixtures instead of an in-memory API. `real-stack.spec.ts` covers all seven modules as Admin and a restricted Salesperson in the desktop project (and in mobile when that project is run locally). The contract fixture forwards actual Worker responses after parsing them with shared Zod schemas; unknown or malformed response contracts fail the test. This avoids waiting on browser response bodies during page unload. CI stops after three failing tests to bound repeated failures. Only unavailable external OAuth, invitation delivery, R2 transport and explicit failure states are mocked; retained Flowbase mock responses are schema-validated. `event-time-contract.spec.ts` compares New York fixture timestamps with the actual event route in summer, winter, overnight across both DST transitions, and for skipped spring-forward times.

Commands used by CI:

```sh
npm run lint
npm run build            # includes both type-checks
npm test
npm run test:worker
npm run db:check
npm run test:db
npm run test:e2e:ci -- --shard=N/4
```

`npm run typecheck` and `npm run typecheck:worker` remain for local use.

Manual workflow verification: push two commits to a PR while the first run is active and confirm cancellation; check npm/Chromium cache hits on a subsequent run; open a Markdown-only PR and confirm the `e2e` shards are skipped and `ci-ok` passes. Review Actions billing minutes after runs: the account's 2,000 monthly free minutes are shared with ops schedules, so avoid redundant pushes. Cloud setup and production deploy verification remain developer tasks.

## Demo limitations

The Proposals navigation opens the real sales tracker; proposal creation and stage changes remain on the event hub. The header has no demo quick-create control; real modules provide their own create forms. Purchasing and Help remain placeholders. Clients, venues, events, leads, inventory, global search, time tracking, attachments, jobs and ingestion use real APIs; records persist in Postgres and attachment content uses R2. Google-only, invite-only authentication is configured per environment (see [Sign-in setup](sign-in-setup.md)); R2 file storage is configured only in production. The deployable unit is the Worker and its static SPA assets. No secrets or real client data are stored in the repository. This prototype targets WCAG 2.2 AA, but does not claim an independent accessibility audit.

## Database

Supabase Free Postgres (`flowbase-prod` `lfsznrmrzxiohzydetbd`, `flowbase-dev` `qlnjdckcrawrcgcoecpl`), reached from the Worker through Hyperdrive with caching disabled. The browser never queries the database. Schema and migrations are Drizzle only: `worker/db/schema.ts` defines tables and `drizzle/` holds the generated SQL and snapshots. Never edit generated migrations by hand, and never change the database any other way.

**Development seed (FLOW-26):** after migrations, set `DATABASE_URL` to the known `flowbase-dev` direct/session-pooler URL or local/CI Postgres and run `npm run db:seed`. The guard rejects the production project, unknown remote destinations and `NODE_ENV=production` before connecting. Stable IDs, a transaction and an advisory lock make repeats safe and preserve development edits. The seed maps the prototype's 35 clients, 45 contacts, 50 inventory items and 10 events to real tables, with every lifecycle stage, opening stock in Warehouse, Jamie's - Garage, Cozy Cafe and Vendor (supplies in Warehouse, ingredients in the Fridge), a sample lead, and 14 users covering every role and both employment types. Opening ledger entries and stock balances are inserted together; rental quantities are distributed across locations without multiplying the prototype total. Proposals and purchase orders remain the existing prototype fixtures until their durable tables are implemented; the vendor directory starts empty. Later modules extend `worker/db/seed.ts` with their own stable ID group. Seed identities use fictional `.example` addresses and cannot be used for real Google sign-in.

**Connection string type: direct connection.** Both Hyperdrive configs use Supabase's direct connection string (`db.<project-ref>.supabase.co:5432`), which Hyperdrive reaches over IPv6. The session pooler is not needed and the paid IPv4 add-on is never used. This is recorded from the developer's answer on FLOW-24; confirm it with the live check below. If that check fails to connect, recreate the Hyperdrive config with the session pooler string (`--caching-disabled`), then update this paragraph. Your own laptop may lack IPv6: for `db:migrate` only, use the dev project's session pooler string as `DATABASE_URL`.

**Conventions** (`worker/db/conventions.ts`; CI tests enforce them):

- UUID primary keys generated by the database (`gen_random_uuid()`).
- `created_at`, `updated_at` (set on every Drizzle update), `created_by`, `updated_by`. The two `*_by` columns are nullable and have no foreign key until the users table exists.
- Soft delete through `archived_at`; list queries exclude archived rows.
- Money as integer cents (`moneyCents`), all times as `timestamptz` (`timestamptz`).
- RLS on every table with no browser-facing policies.
- A CHECK constraint on every enum-like text column (`oneOf(name, column, values)` with the column's `enum` list), and `inventory_stock.quantity >= 0` (FLOW-187). A unique violation answers `409 ALREADY_EXISTS` and a CHECK violation `400 INVALID_VALUE` (`onError` in `worker/app.ts`).

**Adding a table:** spread `...baseColumns()` into `pgTable(...)`, end it with `.enableRLS()`, run `npm run db:generate`, and commit the SQL and snapshot together with the schema change. CI rejects a schema without a matching migration, and any table in `public` without RLS.

**Hand-written SQL** (data fixes, seed rows, triggers) goes in its own migration created with `npx drizzle-kit generate --custom --name=<name>`, never appended to a generated file (FLOW-187; `0010_stock_ledger.sql` predates this rule).

**Migration order:** Drizzle skips a migration whose journal `when` is not later than the last one applied, so `npm run db:check` fails when a migration added on your branch is not newer than the last one on `main` (`scripts/check-migration-order.mjs`). If it fails, merge `main`, delete your migration and its snapshot, remove its journal entry, and run `npm run db:generate` again.

**Using it in the Worker:** `withDb(env, (db) => ...)` in `worker/db/client.ts` opens a request-local postgres.js client from the `HYPERDRIVE` binding (`max: 5`, `fetch_types: false`, prepared statements on), runs the callback with a typed Drizzle `db`, and always closes the client. Without the binding it throws `DatabaseNotConfiguredError`; `/api/health` keeps reporting `not_configured`.

**Environments** (`wrangler.jsonc`). There is deliberately no top-level Hyperdrive binding, so plain `wrangler dev` and CI run without a database. `--env dev` binds the dev Hyperdrive config and enables `/api/dev/db-check`; `--env production` binds the production config and is what [Deploy](#deploy) ships. There is no preview environment (FLOW-176). Outside the dev environment `/api/dev/*` answers 404.

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

**Backups.** Production is dumped nightly to R2 from the private ops repo with 30-day retention. Setup, contents and the restore procedure: [docs/restore.md](restore.md).

## Deploy

Cloudflare Workers Builds deploys from `main`; GitHub Actions is not involved, so merges use no Actions minutes. CI on the PR remains the gate.

**Production (every merge to `main`).** Workers Builds installs dependencies from `package-lock.json`, then runs `npm run deploy`, which stops at the first failing step:

1. `npm run build`: type checks and builds the SPA into `dist/`.
2. `npm test` and `npm run test:worker`: the frontend and Worker unit tests (FLOW-173). The database (`test:db`) and browser (`test:e2e`) suites run only in CI, so a PR still has to be green before it merges.
3. `npm run deploy:migrate`: refuses to run without `DATABASE_URL`, then applies committed Drizzle migrations to the production database with `drizzle-kit migrate`.
4. `wrangler deploy --env production`: uploads and activates the new Worker version.
5. `npm run deploy:verify` (`scripts/check-health.mjs`): calls `https://flowbase.sybertechlabs.workers.dev/api/health` and passes only when the body says `"database":"reachable"`. It retries 8 times, 5 seconds apart, while the new version activates. `HEALTH_URL`, `HEALTH_ATTEMPTS` and `HEALTH_RETRY_MS` override the defaults.

If the build, a test or a migration fails, nothing is deployed and the previous version keeps serving. **A failed health check is different: the new version is already live** but cannot reach its database (`unreachable`, `not_configured` or no answer), and the Workers Builds log shows "Deploy verification failed". Check the `HYPERDRIVE` binding and the production database, or roll back (below). Drizzle applies the pending migrations in one transaction, so a failing migration leaves the schema as it was. Migrations run before the new code goes live, so they must stay compatible with the version currently serving (add columns and tables first; remove them in a later release).

**Non-production branches are not deployed** (FLOW-176). Worker secrets belong to the Worker, not to a version, so a preview version of `flowbase` would run unmerged code at a public URL with the production runtime secrets (`INGEST_TOKEN_LEADS`, `INGEST_TOKEN_THUMBTACK`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SENTRY_DSN`). Non-production branch builds are therefore off and there is no `deploy:preview` script. Check a branch with CI and `wrangler dev --remote --env dev` (see [Database](#database)). If previews are needed later, give them a separate Worker (for example `flowbase-preview`) bound to the dev database with dev-only secrets; never upload versions of `flowbase` from an unmerged branch.

**Workers Builds settings** (Worker `flowbase` → Settings → Build; developer-configured):

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | *(empty; `npm run deploy` builds)* |
| Deploy command | `npm run deploy` |
| Non-production branch builds | disabled |

**Build variables** (names only; values live in Cloudflare, never in this repo):

- `DATABASE_URL`: production Postgres connection string used for migrations. Set it as a secret build variable on the Production settings only. Use the `flowbase-prod` session pooler string if the build environment cannot reach the direct connection over IPv6.
- `VITE_SENTRY_DSN`: public SPA Sentry DSN (optional; see [Observability](#observability)).
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`: provided by Workers Builds automatically.

Runtime secrets such as `SENTRY_DSN` are Worker secrets (`wrangler secret put SENTRY_DSN --env production`), not build variables.

**Rollback.** Roll back to the previous production deployment:

```sh
npx wrangler rollback --env production
```

To pick a specific version, list deployments with `npx wrangler deployments list --env production` and pass its version ID: `npx wrangler rollback <version-id> --env production`. Rollback does not undo migrations; fix forward with a new migration if the schema must change back.

**Manual verification.** Merge a trivial change, then in the Cloudflare dashboard confirm the build log shows the build, the two test runs, migrate, deploy and the health check in that order, and that the new version is active. A failing step before `wrangler deploy` ends the build, so the active version in the dashboard stays the same.

## Observability

Worker API requests emit JSON logs and return `X-Request-ID`. All API errors use `{ error: { code, message, requestId } }`; unexpected failures return a generic message and send the exception to Sentry tagged with that same ID. The SPA displays request references on API failures. Set `SENTRY_DSN` as a Worker secret and `VITE_SENTRY_DSN` as a public SPA build variable to enable Sentry; without DSNs, reporting is disabled. `APP_VERSION` optionally overrides the Worker release; both targets otherwise use the package version. Browser errors are captured by Sentry's React integration and error boundary. Request/user objects are stripped from Sentry events, and tracing/replays are disabled. Cloudflare request logs are enabled in Wrangler. Use only the Sentry free plan; monitor its event quota and Cloudflare usage before go-live.

Health reports Worker liveness plus version and `database: reachable | unreachable | not_configured`. With an optional `HYPERDRIVE` binding it executes `select 1` using a request-local Postgres.js client, then closes it. A missing binding is reported as `not_configured`; it is never treated as a verified database connection. Hyperdrive binding IDs and the connection decision are in [Database](#database); live dev verification is a manual check there.

Manual telemetry check after developer setup: configure both DSNs, trigger a controlled Worker failure in a development environment, and confirm the event's request ID matches its response header and Cloudflare log. Trigger a browser render error and confirm the fallback and Sentry event. No failure-trigger route is shipped. Confirm both projects remain on free tiers and inspect quotas. CI verifies middleware, SDK wiring, and DB-probe states without contacting Sentry or production resources.
