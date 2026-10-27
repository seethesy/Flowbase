# Flowbase v0.1

Flowbase is a catering operations workspace for a team of 15–20 employees. Clients, venues, events, leads, inventory, search, time tracking, attachments, jobs and ingestion use real Worker APIs and Postgres (with R2 for file content). Google-only, invite-only sign-in protects the workspace. Dashboard figures and the Proposals pipeline screen still use sample data; their simulated changes reset on refresh. Real proposals live on each event's hub (see Proposals below).

## Setup

Requires Node.js 22.23.4 (pinned in `.node-version` and `package.json`) and npm. CI and Cloudflare Workers Builds use this pin.

```sh
npm ci
npm run build
npm run dev:worker
```

The Worker serves the built SPA and `/api/*` at `http://localhost:8787`. `GET /api/health` returns `{ ok: true, version, database }`. For frontend hot reload, run `npm run dev` in another terminal; Vite proxies `/api` to the local Worker. Rebuild to update the SPA served by Wrangler. Hash routing supports direct record URLs and browser back/forward without server rewrites. Fonts are bundled locally.

Google sign-in is required to enter the workspace. Follow [Sign-in setup](docs/sign-in-setup.md) to configure Supabase, the allowlist hook, invitation delivery and the first Admin. `.env.example` lists optional Sentry configuration and the disposable CI database URL. Keep later local Worker secrets in ignored `.dev.vars`, and Vite variables in ignored `.env.local`. Never put secrets in `VITE_*`, which are shipped to the browser.

## Explore

- **Dashboard:** date-range sample datasets, KPI navigation, activity links, proposal status chart, stock alerts, and upcoming events.
- **Clients, Venues, Events:** real records from the API (see [Core records](#core-records)), with search, show-archived filters, create/edit forms, archive/restore and detail pages. They require an invited Google account.
- **Proposals:** pipeline/table toggle, shared filters, numeric sorting, date filtering, pagination, drag-and-drop cards, and detail/edit drawers. The status selector is the keyboard-accessible alternative to dragging. Lost requires confirmation and a reason. Signed is final; Draft cannot jump straight to Signed. Lost may reopen as Draft.
- **Inventory:** real items from the API (see [Inventory](#inventory)): rentals, decor, ingredients, bar stock, supplies and services, with per-section stock, the stock ledger (movement history, transfers, counts, receipts, adjustments and corrections) on the item page, the kitchen ingredient catalog, the bar screen, count mode, the low-stock list, cost history, and Admin-managed sections. The Dashboard stock alerts still use the demo item fixtures.
- **Vendors:** the vendor and distributor directory (see [Vendors](#vendors)): distributors, rental vendors and event partners, how to order from each, and the items they supply.
- **Recipes:** the recipe book (see [Recipe book](#recipe-book)): dishes with ingredient lines, method, yield, cost, allergens and dietary tags, and a scaling tool.
- Global search (header, see [Global search](#global-search)) finds real clients, leads, events, venues, inventory items and vendors; demo proposals are no longer in it. The header bell shows the signed-in person's real notifications (see [Notifications](#notifications)). Purchasing and Help are labeled placeholders; Reports holds the time-tracking reports and Settings the time-tracking notice (see [Time tracking](#time-tracking)). Proposals and the Dashboard still use the demo client fixtures. The employee profile and header show the signed-in staff member. Admin manages invitations and access in Settings → Manage users.

Demo fixtures: 35 clients, 40 proposals, 50 items, 15 vendors, 10 events, 8 employee profiles, activity and attachment metadata. The separate development database seed is described below. Dashboard date ranges intentionally select different mock subsets rather than querying a backend.

## Architecture

React + strict TypeScript + Vite; Tailwind CSS; Radix/shadcn-style components; Lucide; React Router; TanStack Table; Recharts; dnd-kit. Shared components live in `src/components`, feature screens in `src/features`, and typed fixtures in `src/data/mock`. `src/styles/globals.css` holds the tokens, base element styles and shared components; styles used by a single feature live next to it as `src/features/<feature>.css`, imported by its screens so they load after the global sheet (FLOW-193). Rich text (SOPs, setup and BEO notes) uses TipTap free core in `src/components/rich-text`: `RichTextEditor` stores TipTap JSON, and `RichTextView`/`renderRichText` render it to DOMPurify-sanitized HTML for screen and print. Headings, bold, italic, bulleted/numbered/checklist lists (nestable) and http(s)/mailto/tel links are supported; pasted Google Docs content keeps that formatting and drops everything else.

A Hono Worker in `worker/` handles the API, and one `wrangler.jsonc` serves `dist/` as static assets on the same origin. App and API infer record types from the Zod schemas in `shared/`; `shared/records.ts` describes only demo fixtures. The demo client and item schemas remain because Dashboard, Proposals and the development seed still consume those fixtures. Route screens load lazily; chart, editor, auth and observability dependencies have separate chunks. CI enforces a 500 kB JavaScript chunk budget. The build typechecks both targets before bundling. The async `RecordService<T>` adapter loads fixtures from `/api/demo/*`, validates writes through the API, and keeps changes in browser memory until refresh. Demo endpoints validate and echo writes; they do not persist records. Context publishes loaded snapshots for rendering; screens await mutations before reporting success. Database access lives in `worker/db/` (see [Database](#database)). Binding decisions, principles, and terms are copied from FLOW-1 in [docs/architecture.md](docs/architecture.md).

## CI and testing

GitHub Actions (`.github/workflows/ci.yml`) is the execution authority. Local test/check execution is prohibited by the repository workflow. Every PR runs lint, app and Worker typechecks, frontend Vitest, Node Worker tests, migration drift checks, Postgres integration tests, build, and desktop/mobile Playwright against the actual Worker. PRs changing only Markdown skip Playwright. Superseded runs on the same PR are cancelled; npm and Chromium are cached. Merge-to-main does not start a duplicate CI run. No workflow requires production credentials or repository secrets.

Postgres 17 runs as a disposable service with public CI-only credentials. `DATABASE_URL` points only to that service. `worker/db/schema.ts` and the Drizzle migrations in `drizzle/` define the application schema. Before each `npm run test:db` run, `tests/db/global-setup.ts` drops and re-creates the `public` and `drizzle` schemas and applies the committed migrations once, so the suite passes again on the same database and in any file order; it refuses to run unless `DATABASE_URL` points at localhost or the CI service (FLOW-182). A test file that clears migration-seeded rows (the default inventory sections) restores them when it finishes. CI runs the suite twice, the second time in shuffled file order. The DB suite applies committed migrations, checks the base column conventions and soft delete on the real tables, tests a separate CI fixture for reads/writes/rollback, and checks `pg_class.relrowsecurity` and browser-facing policies for all application tables. The drift check runs Drizzle generation and rejects both modified and newly generated migration files. CI does not contact Hyperdrive or any deployed database; that path is covered by the manual live check in [Database](#database).

The DB setup also runs the development seed (FLOW-26). Browser tests (FLOW-183) re-create, migrate and seed the same disposable database before starting their scenarios. They share **one local `wrangler dev` process**, using `tests/e2e/wrangler.jsonc` and the separate `tests/e2e/worker.ts` entry point. That entry point alone trusts a public test signing key; the normal auth resolver still loads each seeded identity from the real allowlist, and all policies, routes and Postgres operations run normally. The production entry point never imports the test verifier. No production credentials, Google login or Supabase Auth service is needed in CI.

Browser tests run serially and reset data between scenarios, without repeating migrations or restarting the Worker. Existing create/edit, transfer, count, lead conversion, search and tracking scenarios use database fixtures instead of an in-memory API. `real-stack.spec.ts` covers all seven modules as Admin and a restricted Salesperson in both desktop and mobile projects. The contract fixture forwards actual Worker responses after parsing them with shared Zod schemas; unknown or malformed response contracts fail the test. This avoids waiting on browser response bodies during page unload. CI stops after three failing tests to bound repeated failures. Only unavailable external OAuth, invitation delivery, R2 transport and explicit failure states are mocked; retained Flowbase mock responses are schema-validated. `event-time-contract.spec.ts` compares New York fixture timestamps with the actual event route in summer, winter, overnight across both DST transitions, and for skipped spring-forward times.

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

Dashboard figures, activity, stock alerts and upcoming events are labeled sample data. The Proposals pipeline screen and its create/edit forms still use a validated, browser-memory demo service; real proposals (FLOW-122) are managed on the event hub until the sales tracker (FLOW-117) lists them. Only the Dashboard and Proposals screens request demo data. The header has no demo quick-create control; real modules provide their own create forms. Purchasing and Help remain placeholders. Clients, venues, events, leads, inventory, global search, time tracking, attachments, jobs and ingestion use real APIs; records persist in Postgres and attachment content uses R2. Google-only, invite-only authentication is configured per environment (see [Sign-in setup](docs/sign-in-setup.md)); R2 file storage is configured only in production. The deployable unit is the Worker and its static SPA assets. No secrets or real client data are stored in the repository. This prototype targets WCAG 2.2 AA, but does not claim an independent accessibility audit.

## Database

Supabase Free Postgres (`flowbase-prod` `lfsznrmrzxiohzydetbd`, `flowbase-dev` `qlnjdckcrawrcgcoecpl`), reached from the Worker through Hyperdrive with caching disabled. The browser never queries the database. Schema and migrations are Drizzle only: `worker/db/schema.ts` defines tables and `drizzle/` holds the generated SQL and snapshots. Never edit generated migrations by hand, and never change the database any other way.

**Development seed (FLOW-26):** after migrations, set `DATABASE_URL` to the known `flowbase-dev` direct/session-pooler URL or local/CI Postgres and run `npm run db:seed`. The guard rejects the production project, unknown remote destinations and `NODE_ENV=production` before connecting. Stable IDs, a transaction and an advisory lock make repeats safe and preserve development edits. The seed maps the prototype's 35 clients, 45 contacts, 50 inventory items and 10 events to real tables, with every lifecycle stage, opening stock in Warehouse, Jamie's, Cafe and Vendor, a sample lead, and 14 users covering every role and both employment types. Opening ledger entries and stock balances are inserted together; rental quantities are distributed across sections without multiplying the prototype total. Proposals and purchase orders remain the existing prototype fixtures until their durable tables are implemented; the vendor directory starts empty. Later modules extend `worker/db/seed.ts` with their own stable ID group. Seed identities use fictional `.example` addresses and cannot be used for real Google sign-in.

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

**Backups.** Production is dumped nightly to R2 from the private ops repo with 30-day retention. Setup, contents and the restore procedure: [docs/restore.md](docs/restore.md).

## Core records

Clients (FLOW-53), venues (FLOW-54) and events (FLOW-55) live in Postgres and are served by `worker/routes/records.ts`; Zod schemas in `shared/core-records.ts` are shared by the API and the screens in `src/features/{clients,venues,events}.tsx`.

| Resource | Routes |
| --- | --- |
| Clients | `GET /api/clients?archived=&flagged=&search=`, `GET/PUT /api/clients/<id>`, `POST /api/clients`, `POST /api/clients/<id>/archive` and `/restore` |
| Venues | the same shape under `/api/venues` |
| History | `GET /api/clients/<id>/history`, and the same under `/api/venues` and `/api/events` |
| Event status | `POST /api/events/<id>/status`, `GET /api/events/<id>/status-history` |
| Staff roster | `GET /api/events/<id>/roster`, `POST /api/events/<id>/shifts`, `PUT /api/events/<id>/shifts/<shiftId>`, `POST …/shifts/<shiftId>/archive`, `POST /api/events/<id>/slots`, `PATCH /api/events/<id>/slots/<slotId>`, `POST …/slots/<slotId>/archive`, `PUT /api/events/<id>/production-leads` |
| Events | the same shape under `/api/events`, with `?clientId=&venueId=&from=&to=` (New York dates), `&status=` (one or more, comma-separated) and `&search=` (title, client or venue name). Lead conversion creates events in Inquiry; see Lifecycle below |

- **Data cache** (FLOW-189, ADR-01): screens load API data through TanStack Query with a key per resource (`useResource` in `src/app/useResource.ts`, `usePagedList` in `src/app/paging.tsx`), so forms on one page share one request for the same list. A save marks everything stale; the screen on view reloads what it shows.
- **Paging** (FLOW-179, `worker/records/paging.ts`): every list endpoint (records, history, status history, leads and duplicates, inventory items, movements, cost history and counts) returns one page in its own order: 100 rows by default, `?limit=` up to 500. The body is still the array of rows; `X-Has-More: true|false` says whether more exist and `X-Next-Cursor` is passed back as `?cursor=` for the next page. Cursors are keyset positions (the last row's sort values, ending with its id), so paging returns every row once even while rows are added; a cursor the server can't read answers `400`. Screens search and filter on the server and show **Load more** (`src/app/paging.tsx`); pickers that must be complete load every page (`allPages` in `src/services/core.ts`), and the event form and lead conversion search clients as you type. The Events screen opens on the past 7 days through the next 30, soonest first, and its From/To dates reach any other range. List joins use maps (FLOW-180), and `tests/db/list-cpu.test.ts` keeps the median CPU of one list call under 10 ms with 2,000 items and 600 events.
- **Who sees what** (`shared/policy.ts`, FLOW-38): Admin, Technical and Sales Manager see every client and event; a salesperson sees the clients and events assigned to them (their new clients are assigned to them); other staff see the events they lead or assist or have a shift on (FLOW-140) and no clients. Records a user can't see answer 404. Venues are visible to everyone. Writes are open to Admin, Technical, Sales Manager and salespeople.
- **Contact details** (F-01-04): client contact email/phone and venue contacts come back as `null` for anyone who isn't FT+. An update that omits a contact's email or phone keeps the stored value.
- **Duplicates:** creating a client whose contact email or phone matches an existing contact answers `409 POSSIBLE_DUPLICATE` with the matches, and the form offers "Create anyway" (`allowDuplicate: true`). A salesperson is only warned about their own clients; a match they can't see is saved as `possibleDuplicateOf`, which only Admin, Technical and Sales Manager see (`?flagged=true`), and emits `client.duplicate_flagged`.
- **Events:** only title, date, start time and client are required. Times are entered as New York wall-clock times and stored as UTC (`shared/time.ts`); an end time before the start runs past midnight. Picking a venue copies its address (when the address is empty) and its areas; per-event areas can be added. The venue arrival time (`arrivalTime`, FLOW-140) is a time on the event date. `booked_at` records the first time the event reaches Negotiation (or a later status other than Lost, if it skipped Negotiation). The salesperson is a user id; Production Leads are named only through their own route (see Staff roster below), so the event form never changes them.
- Every create, update, archive and restore emits a domain event (`client.created`, `event.updated`, `venue.archived`, …) in the same transaction. Archive and restore for every record go through `setArchived` (`worker/records/archive.ts`), which sets `archived_at`, writes the audit row for audited records and emits `<record>.archived` / `.restored` in one transaction; inventory sections have no event. Route files run record functions with `recordRunner` (`worker/hono.ts`), which passes the database and the signed-in actor.
- **Lifecycle** (FLOW-56, `shared/event-lifecycle.ts`): Inquiry → Pitching → P creation → Initial P sent → Negotiation → Closing → Closed (paid and signed) → Preparation → Finished | Lost. An event can be created in any status. After that the status never changes through `PUT`: Admin or the event's salesperson changes it with `POST /api/events/<id>/status` (`{ status, reason? }`) to any other status, and the system moves it with `advanceEventStatus` (in `worker/records/events.ts`, for the features that drive it), which allows only the next status or Lost and refuses anything else with `409 INVALID_TRANSITION`. Finished and Lost are final for the system. Every change writes a row to `event_status_history` (who, when, from, to, why, manual or automatic; `GET /api/events/<id>/status-history`), writes the audit row and emits exactly one domain event, `event.<new status>` with `{ from, to, reason, manual }`.
- **History** (FLOW-41, `worker/audit/log.ts`): every create, update, archive and restore of a client, venue or event (FLOW-161) writes one row to the append-only `audit_log` in the same transaction: actor, time, and a before/after diff of only the changed fields, keyed by their API names (a client's contacts, a venue's areas and contacts, and an event's area names are fields of their record). An update that changes nothing writes no row. `GET /api/{clients,venues,events}/<id>/history` returns it newest first to anyone who can see the record, hiding what the record itself hides from them (contact details from part-time users, the possible-duplicate match from salespeople); a change made only to hidden fields doesn't appear. Inventory items, inventory sections and lead changes are audited the same way (FLOW-185, below), and so is every stock movement (FLOW-168). No route updates or deletes audit rows.
- **Event hub** (FLOW-57): `/events/<id>` is one page per event, loaded from `GET /api/events/<id>/hub`, which returns the event, its client (or `null`), the sections to show whether the user may edit, and whether they may change the status (FLOW-56). The full set of sections is defined in `shared/event-hub.ts`. Only the sections whose module exists are listed (`builtSections` in `worker/records/events.ts`: details, client, staff and files), and each module ticket adds its own. The client section needs access to the client record, so staff who only work the event see the client's name in the details but not the client, and contact details follow F-01-04. Edit and Archive appear only for roles with `events.write`.
- **Proposals** (FLOW-122/123, `shared/proposals.ts`, `worker/records/proposals.ts`, `src/features/event-proposals.tsx`): the hub's Proposals section, for anyone with `proposals.read` (Admin, Technical, Sales Manager, salespeople) on an event they can open. An event has one or more proposals (`proposals`), each with a title, notes, an assigned salesperson (the event's by default; Admin, Technical and the Sales Manager may pick another) and its own stage, separate from the event's status: Client communication → Menu curation → Revisions → Finalized → Approved → Sent → Signed | Lost. People with `proposals.write` move only the manual stages (Client communication, Menu curation, Revisions, in any order, and back to Revisions from Finalized, Approved or Sent) and Lost, which needs a reason and is final like Signed; `POST /api/proposals/<id>/stage` refuses Finalized, Approved, Sent and Signed (AC1), which only their actions set. Losing a proposal when the event has no other proposal that isn't lost also moves the event to Lost automatically (unless it is already Finished or Lost), with the reason in its status history. Every stage change writes `proposal_stage_history` (who, when, from, to, why, and whether a person or an action made it), an audit row (`proposal`) and `proposal.stage_changed` for the sales tracker (FLOW-117). **Versions** (FLOW-123, ADR-16): the finalized proposal is uploaded as the Google Docs Word export (.docx), optionally with a PDF of the same version; anything without a .docx is refused before upload and by the API with the export hint. Files go straight to R2 with signed URLs (`POST /api/proposals/<id>/versions`, then `…/versions/<versionId>/complete`, which checks each file arrived). Completing gives the version the next number, makes it current, emits `proposal.version_uploaded` and moves the proposal to Finalized (from a manual stage or Approved; a sent proposal goes back to Revisions first, a signed or lost one takes no uploads). Versions are never edited or deleted: no route changes one, and older versions stay downloadable. Mapping the .docx (FLOW-124/125) and approval, sending and booking (F-11-06, F-12-01) come later. The `/proposals` pipeline screen is still the demo.
- **Staff roster and Production Leads** (FLOW-140, `shared/event-staff.ts`, `worker/records/event-staff.ts`, `src/features/event-staff.tsx`): the hub's Staff section, laid out like the BEO's Staff Roster. An event has shifts (`event_shifts`): pull/load day, setup day and event day, each with its own New York date, start and end time (an end before the start runs past midnight) and activities; the pull/load and setup days default to the day before. Each shift has staffing slots (`event_staff_slots`) with a position from the `staff_position` list (Settings, so roles are configurable), a department and an assignee or none. Repeated positions on a shift are numbered ("Server #5"), open slots read "– open", and the staffing breakdown counts slots and filled slots by department (Management, Kitchen, Service, Bar, Decor/Setup, Pull/Load, Transport, Other; a new slot's department defaults from its position and can be changed). Anyone who can open the event reads the roster; `events.write` changes it. Assigning someone whose other shift overlaps (on any event that isn't archived or Lost) still saves, and both slots show a double-booking warning naming the other event, or "another event" when the viewer can't open it; back-to-back shifts don't count. Each assignment emits `event.staff_assigned` (and a removal `event.staff_unassigned`) with the slot, user and previous user, which the notifications (FLOW-43) follow; shift and slot changes are audited as `event_shift` and `event_staff_slot`. Production Leads: `events.production_leads` (Admin and Sales Manager) names one primary and up to 10 assistants; assistants need a primary, the primary must be an active full-time user, assistants active staff, and the change emits `event.production_leads_changed` for production alerts (FLOW-153). Staffing slots from the mapped proposal (F-11-04) wait for FLOW-125.

## Inventory

Rental details, decor kits, service offerings and supplies (FLOW-72/79/80/92): rental forms store internal/replacement costs, dimensions, assembly notes, buffers and a color list. A single rental item can hold separate quantities per color and section; movements, counts, transfers and corrections preserve the color. Existing uncolored balances remain in an explicit unassigned-color bucket. A color with stock cannot be removed. Staff and Kitchen Staff never receive rental costs, including full-time users. Empty item ratios inherit the current category default from Settings; item overrides take precedence. Admin and Sales Manager can edit rental prices directly (FLOW-73's settled role exception); other roles cannot directly reprice rentals while approval proposals remain pending implementation in FLOW-73.

Decor rentals can define kits of rental/consumable components, with active-reference and cycle validation. Services support fixed, per-person and quoted prices, per-person add-ons and fixed/per-guest includes; they show no stock quantities, including in CSV exports. Photos continue to use the existing item attachments. `/inventory/supplies` lists consumable supplies, including below-par filtering and links to low stock and count mode; new supplies default to the Supplies storage section. `shared/inventory-requirements.ts` provides pure ratio fallback and nested kit/service quantity calculations.

This batch delivers the catalog foundations. Actual event reservations, kit pull/closeout movements and shortages, service planning/task-template application, and supplies allocation/order/pull-list/import integration are deferred to FLOW-212, FLOW-213 and FLOW-214. The 120-guest plasticware calculation is covered as a pure calculation; it does not yet create persisted event requirements. Those follow-ups depend on the existing reservation, planning, ordering, closeout and import tickets. Their unfinished acceptance criteria remain linked from the original issues.

Inventory items (FLOW-69), sections and stock (FLOW-70), the ingredient catalog (FLOW-81), the stock ledger (FLOW-71), count mode (FLOW-82), cost history (FLOW-83) and bar stock (FLOW-90) live in Postgres and are served by `worker/routes/inventory.ts`; Zod schemas in `shared/inventory.ts` are shared by the API and the screens in `src/features/inventory.tsx` (`/inventory`, `/inventory/ingredients`, `/inventory/bar`, `/inventory/sections`, `/inventory/<id>`) and `src/features/stock-counts.tsx` (`/inventory/counts`, `/inventory/counts/<id>`, `/inventory/low-stock`). Item lists are paged (see [Core records](#core-records)) and every item filter runs in SQL (FLOW-180).

| Resource | Routes |
| --- | --- |
| Items | `GET /api/inventory/items?kind=&subtype=&category=&sectionId=&vendor=&belowPar=&search=&tier=&subcategory=&archived=`, `GET/PUT /api/inventory/items/<id>`, `POST /api/inventory/items`, `POST /api/inventory/items/<id>/archive` and `/restore`, `GET /api/inventory/items/<id>/cost-history` (FT+ and kitchen roles), `GET /api/inventory/items/<id>/history` |
| Stock | `GET /api/inventory/items/<id>/movements`, `POST /api/inventory/items/<id>/movements` (`type`, `sectionId`, `quantity`, `reason`, optional `eventId`), `POST /api/inventory/items/<id>/transfers` (`fromSectionId`, `toSectionId`, `quantity`, `reason`), `POST /api/inventory/items/<id>/counts` (`sectionId`, counted `quantity`, `reason`), `POST /api/inventory/movements/<id>/corrections` (what it should have been, `reason`) |
| Counts | `GET /api/inventory/counts?status=`, `POST /api/inventory/counts` (`sectionId`; resumes the open count), `GET /api/inventory/counts/<id>`, `POST /api/inventory/counts/<id>/lines` (`itemId`, counted `quantity`, `reason`), `POST /api/inventory/counts/<id>/complete` |
| Sections | `GET /api/inventory/sections?kind=&archived=`, `POST /api/inventory/sections`, `PUT /api/inventory/sections/<id>` (rename), `POST /api/inventory/sections/<id>/archive` and `/restore` |

- **Items:** `kind` is `rental`, `consumable` or `service`, with a subtype for rentals (equipment, furniture, linen, tableware, glassware, bar, decor) and consumables (ingredient, bar, supply). Every item has a code, name, category, stock unit, optional display group, tier and color/finish, and an optional ratio (e.g. 2 per guest). Kind-specific fields live in their own tables (`inventory_rental_details`, `inventory_consumable_details`, `inventory_service_details`). An item's kind can't change, and a live code is unique. Photos attach through [Attachments](#attachments) (`inventory_item`). Categories use business settings (FLOW-45); allergens are set on dishes, not ingredients (FLOW-95). A consumable's preferred vendor is picked from the [vendor directory](#vendors) (`preferredVendorId`, with its name copied to `preferredVendor`), or typed as free text for a vendor that isn't in it.
- **Units** (`shared/units.ts`, FLOW-51): count (each, dozen, case), weight (oz, lb, g, kg) and volume (tsp, tbsp, cup, fl oz, qt, gal, ml, l). `convert()` handles the standard conversions plus each item's pack count (a case of 12) and "one each is about" size (750 ml a bottle, 8 oz a chicken breast), and returns `cannot_convert` instead of guessing (weight ↔ volume never converts). `orderQuantity()` rounds up to whole purchase units. A recipe unit an ingredient can't be converted to is flagged on the form (`recipeUnitProblem`).
- **Stock:** quantities are per item and section. Rentals live in rental sections (Warehouse, Jamie's, Cafe, Vendor for sub-rentals, and Unlabeled for rentals with no location label), consumables in storage sections (Kitchen – Dry Storage, – Refrigerated, – Freezer, Bar Storage, Supplies); the defaults are seeded by migration.
- **Stock ledger (FLOW-71):** every quantity change is a `stock_movements` row: one item, one section, a signed quantity, a type (`receive`, `adjust`, `count`, `transfer`, `pull`, `return`, `damage_loss`, `consume`), the reason, the user and time, and an optional link to an event, order or import. A transfer is two rows sharing a `transfer_id`. `inventory_stock` caches on-hand per item and section; `recordMovement` (`worker/records/inventory.ts`) is the only writer and updates it in the same transaction as the movements, never lets a section go below zero, and rejects service items. No route sets a quantity. Movements are append-only (a database trigger rejects updates and deletes); a correction is a new movement of the difference that points at the original (`corrects_id`), and a transfer is corrected by transferring back. Each movement emits `stock.moved` and writes one `stock_movement` audit row in its transaction (FLOW-168). Importers enter quantities with `recordImportedStock`: a `count` movement for the difference between the file's quantity and the section's on-hand, linked to the import's log (`link_type` `import`). Re-running an import sets the section back to the file's quantity, even if stock moved since; a matching quantity records nothing.
- **Count mode (FLOW-82):** a count covers one storage section: its consumables (kept there, holding stock there, or already counted) listed in shelf order (`storageOrder` on the item). Each saved count writes a `count` movement for the difference (bar counts round to the nearest 0.5 for beer, wine and champagne and the nearest 0.25 for liquor and cordials, `barCountStep`) and replaces the item's line in the count (`stock_counts`, `stock_count_lines`), so a count left part-way resumes where it stopped; starting a count where one is open resumes it. Consumable counts need no approval; rentals are counted from the item page. The low-stock list (`/inventory/low-stock`) shows consumables below par.
- **History (FLOW-185):** creating, editing, archiving and restoring an item, and creating, renaming, archiving and restoring a section, write an audit row in the same transaction (`inventory_item`, `inventory_section`). Item snapshots are the item's API shape without stock (stock is the ledger's), so a price change records only `rental`, `service` or `consumable`. `GET /api/inventory/items/<id>/history` hides consumable costs from users who can't see costs; a cost-only change doesn't appear for them.
- **Cost history (FLOW-83):** every change to a consumable's unit cost is logged in `inventory_cost_history` with the previous and new cost, the source (`manual` from the item form; `receiving` from FLOW-88 through `recordCostChange`) and the user, and emits `inventory_item.cost_changed` for recipe costing (FLOW-94) to recalculate recipes.
- **Bar stock (FLOW-90):** consumables of subtype `bar`, with a category from the bar inventory masterlist (Beer, Wine, Champagne, Liquor, Cordials, Mixers & Juices, Garnishes, Soft Beverages), a subcategory for wine (White, Red) and liquor (Vodka, Tequila, Gin, Rum, Whiskey, Cognac), with category lists managed by business settings (FLOW-45), brand or varietal and container (`inventory_bar_details`), tier `rail`, `mid`, `high` or `premium`, size (each size), pack size (case count), distributor (preferred vendor), unit cost, par and storage section (Bar Storage by default). The bar screen filters by category, subcategory, tier and distributor.
- **Who can do what** (`worker/policy.ts`): every signed-in user can read inventory. Admin, Technical, Sales Manager and the kitchen lead can change items and consumable stock and correct movements. Rental stock (counts, receipts, transfers, corrections) is also updated by salespeople, kitchen staff and FT+ (`canMoveItem`, `canCountItem`); editing the rental item itself stays with the managers. Ingredients are counted by Admin, the kitchen lead and kitchen staff; bar stock and supplies by Admin and FT+. Only Admin adds, renames and archives sections; a section that still holds stock can't be archived. Consumable costs and cost history are visible to FT+, Kitchen Lead and Kitchen Staff (FLOW-39): costs come back `null` (with `costHidden`) for anyone else, and an update that omits the cost keeps it.

## Vendors

The vendor and distributor directory (FLOW-84, `worker/records/vendors.ts`, `shared/vendors.ts`, screens in `src/features/vendors.tsx` at `/vendors` and `/vendors/<id>`). Each vendor has a type (`food_distributor`, `beverage_distributor`, `rental_vendor`, `event_partner`), the vendor portal URL, the business's account number, contacts, order cutoff, delivery days, minimum order, lead time, ordering instructions and notes. The vendor page lists the items they supply: consumables whose preferred vendor they are and rentals sub-rented from them.

| Resource | Routes |
| --- | --- |
| Vendors | `GET /api/vendors?type=&search=&archived=`, `GET/PUT /api/vendors/<id>`, `POST /api/vendors`, `POST /api/vendors/<id>/archive` and `/restore`, `GET /api/vendors/<id>/history` |

- **No passwords:** there is no password field or column, and the API answers 400 to any body with a field named like a password (`pass`, `password`, `passcode`, `pwd`, `secret`), at any depth.
- **Who can do what:** everyone with `inventory.read` reads the directory; `inventory.write` (Admin, Technical, Sales Manager, Kitchen Lead) edits it. Contacts and the account number are FT+ only: they come back `null` for part-time users, who can't change them (an update that omits them keeps them), and history hides them the same way.
- **One vendor per name:** a live name is unique (any case). `ensureVendor(tx, actor, { name, type })` returns the live vendor with that name or creates it; the bar import (FLOW-91) uses it for Imperio.
- **Sub-rentals (FLOW-75):** a rental linked to a vendor (`rental.vendorId`) is a vendor item: it carries the vendor cost (`vendorCostCents`, hidden like other rental costs), the client price (`priceCents`) and the vendor's lead time (`leadTimeDays`). `shared/sub-rentals.ts` holds the rules reservations (FLOW-76) and conflict detection (FLOW-77) apply: a vendor item is available on request, so reserving it never reduces owned availability (`ownedAvailability`; stock in the Vendor section isn't owned), and `leadTimeWarning` flags an event closer than the lead time. Adding vendor items to the vendor's rental request is FLOW-136.

## Recipe book

Recipes (FLOW-93), costing (FLOW-94), allergens and dietary tags (FLOW-95) and scaling (FLOW-98) live in Postgres (`recipes`, `recipe_lines`) and are served by `worker/routes/recipes.ts` with logic in `worker/records/recipes.ts`; schemas and the calculations are in `shared/recipes.ts`, and the screens in `src/features/recipes.tsx` (`/recipes`, `/recipes/<id>`).

| Route | Purpose |
| --- | --- |
| `GET /api/recipes?category=&search=&archived=`, `GET/PUT /api/recipes/<id>`, `POST /api/recipes`, `POST /api/recipes/<id>/archive` and `/restore` | The recipe book |
| `GET /api/recipes/<id>/history` | The recipe's audit history (FLOW-41) |
| `GET /api/recipes/<id>/scale?servings=` | Ingredient quantities for that many servings |
| `GET /api/recipes/client?category=` | Authenticated client projection: dish details, ingredient names, tags and a signed photo URL |

- **Dishes:** name, category (appetizers, mains, sides, desserts, drinks, additional items), description, photos ([Attachments](#attachments), `recipe`), ingredient lines, numbered method steps and a finishing note, an optional yield (servings and portion size), and an active flag. A line is a catalog ingredient (FLOW-81) with an optional quantity and unit ("Italian Seasoning" has none), a prep note and an optional entered cost. A live dish with the same name in the same category is flagged (`duplicates`), not blocked. Every create, edit, archive and restore writes an audit row and emits `recipe.<action>`. Everyone signed in reads recipes; Admin, Technical, Sales Manager, the Kitchen Lead, Kitchen Staff and full-time Salespeople and Staff change them (`recipes.write`).
- **Costing:** each line is **calculated** (quantity × the ingredient's unit cost, converted to its purchase unit with `shared/units.ts`) when it has a quantity and the ingredient has a cost; otherwise the **entered** line cost; otherwise **no cost**, counted as $0. Batch cost is the sum and per-serving cost divides by the yield, all in integer cents. Costs are worked out on every read, so a new ingredient cost shows at once. Costs and entered line costs follow F-01-04 like ingredient costs: `null` with `costHidden` for anyone else, an omitted entered cost keeps the stored one, and history hides them.
- **Allergens and dietary tags** are set by hand on the dish (`allergens`, `dietaryTags`), not on its ingredients, and changes are audited. Dietary tags are vegan (no ingredient contains meat), vegetarian, gluten-free (no ingredient contains gluten) and dairy-free; the form shows what each one promises. Ingredients no longer show allergens; values saved before are kept in the database.
- **Scaling:** each line is multiplied by servings ÷ yield. Countable units (each, dozen, case) round up to whole units; the purchase-unit amount is not rounded to packs here (the order list does that). Lines with no quantity are "as needed" and left out of the per-ingredient totals. A dish with no yield answers `{ ok: false, reason: "no_yield" }` instead of quantities.

- **Internal book (FLOW-96):** browse categories, search dish or ingredient names, and combine allergen and dietary-tag filters. The API also accepts `allergen` and `dietaryTag`. Recipe costs, entered costs and cost history are FT+ only, including kitchen roles. Kitchen Staff still read and edit the method; edits omit costs to preserve stored values. **Kitchen card** opens `/print/recipes/<id>` with ingredients, quantities, yield, method and tags, with no costs even for Admin.
- **Client book (FLOW-97):** `/recipes/client` shows active, unarchived dishes using a server-side field allowlist. It includes name, description, ingredient names, the first ready photo and tags; it excludes quantities, yield, prep notes, method, finishing notes and costs. Select dishes or choose a category, then print or save as PDF using the shared company branding. `/print/recipes/client?ids=<comma-separated ids>` and `?category=<category>` remain behind sign-in; there are no public share links.
- **Cost changes (FLOW-169):** the registered `inventory_item.cost_changed` job handler recalculates every recipe using the consumable from current catalog data, for manual and receiving changes. Ingredient lines can also use bar stock and supplies. Each resulting `recipe.cost_recalculated` event records the computed cost with an idempotency key tied to the input job and recipe; replay creates no duplicate results. Costs continue to be derived on reads, so an older queued event cannot overwrite a newer price with a stale cached total.

## Leads

Every lead source writes the same record (FLOW-100); the inbox, triage queue and conversion (FLOW-111, FLOW-112) are served by `worker/routes/leads.ts` under `/api/leads`, with logic in `worker/records/leads.ts`, schemas in `shared/leads.ts` and the screens in `src/features/leads.tsx` (`/#/leads`).

| Route | Purpose |
| --- | --- |
| `GET /api/leads` | The inbox, newest first. Filters: `status`, `source`, `channel`, `assigned` (a user id or `unassigned`), `search`, `needsReview=true`, `triage=true` |
| `GET /api/leads/<id>` | One lead; includes `rawPayload` for FT+ users, `null` for part-time |
| `POST /api/leads/<id>/assign`, `POST /api/leads/assign` | Assign a salesperson to one lead, or to many (`{leadIds, assignedSalespersonId}`). Admin only |
| `POST /api/leads/<id>/status` | `{status: contacted \| qualified \| lost, reason}` |
| `POST /api/leads/<id>/convert` | Convert a qualified lead (below) |
| `GET /api/leads/dashboard?from=&to=` | The lead dashboard (below); New York dates, the last 30 days by default |
| `GET /api/leads/duplicates` | Open possible duplicates the caller can resolve (below) |
| `POST /api/leads/duplicates/<id>/merge`, `/dismiss` | Merge the pair into `{keepLeadId}`, or mark it not a duplicate |
| `GET /api/leads/<id>/history` | The lead's audit history (FLOW-185), for anyone who can see the lead |

- **Entering a lead:** there is no create route. Collectors (FLOW-102), webhooks (FLOW-108), manual entry (FLOW-101) and import (FLOW-109) call `createLead(db, input)`, which stores the lead and emits `lead.collected` (collector) or `lead.received` (everything else) in the same transaction. Only `channel` and `source` are required; a lead with no event date, or with neither email nor phone, appears in the **Needs review** view.
- **Who sees what:** Admin, Technical and Sales Manager see every lead; a salesperson sees only the leads assigned to them, and any other lead answers 404 (Q-41). Other roles get 403. The raw payload is returned only on the detail response and only to FT+ users.
- **Triage and assignment:** the triage queue is every open lead (new, contacted or qualified) with no salesperson. Only Admin can assign or reassign (FLOW-111 Q-41a; `leads.assign` in `worker/policy.ts` is the one rule to widen if the Sales Manager should assign too). Bulk assign is all or nothing. Each change of salesperson emits `lead.assigned` with the new and previous salesperson; the notification (FLOW-43) subscribes to it. The form currently accepts a salesperson user id.
- **Status:** `new → contacted → qualified`, and `lost` from any open status with a required reason. Lost and converted are final; `converted` is reached only by converting. The first move to `contacted` stamps `firstRespondedAt`; first-response time is the gap from `receivedAt` to that moment. Each change emits `lead.status_changed`.
- **Convert:** needs a `qualified` lead. In one transaction it creates a client (or links an existing one) with a contact from the lead, creates an event with status `inquiry` pre-filled from the lead (date, guest count, event type, location as the address, message as the internal notes), marks the lead `converted` with links to both, and emits `lead.converted` (`clientId`, `eventId`) plus the usual `client.created` / `event.created`. If anything fails, nothing is kept. The start time is entered at conversion (the lead has none); the date defaults to the lead's. A matching client email or phone answers `409 POSSIBLE_DUPLICATE`, and the form offers to link to the match or create anyway. A salesperson converts only their own leads, into clients and events assigned to them. The same transaction creates the event's first proposal (FLOW-163) in Client communication, titled like the event and assigned to the event's salesperson, and returns it as `proposal`; `lead.converted` carries its `proposalId`.
- **Duplicates** (FLOW-110, `worker/records/lead-duplicates.ts`): `createLead` matches each new lead in this order: (1) the same source and source lead id is the same lead again, so it updates the stored lead's details (and raw payload) instead of creating one and emits `lead.updated`; (2) email (case-insensitive) or phone (digits only, without a leading 1) against earlier leads and client contacts; (3) the same event date and a similar name (pg_trgm similarity ≥ 0.6). Each match is stored in `lead_duplicates` as an open possible duplicate and `lead.duplicates_found` is emitted. The lead detail lists the matches the caller can see; a client match offers "Convert and link". **Cross-owner:** a salesperson never sees a match they can't open; cross-owner existence is hidden (`assignedElsewhere` remains false), and the pair waits in Admin's and the Sales Manager's **Duplicates** tab, flagged "Different salespeople". Merging keeps the chosen lead: the other is archived with `merged_into_lead_id`, `merged_at` and `merged_by`, keeps its source record and raw payload, and appears in the kept lead's `sourceLinks`; details only the other lead had are copied over, its other open duplicates move to the kept lead, a converted lead can only be the one kept, and `lead.merged` is emitted. Admin, Technical, Sales Manager and salespeople may merge or dismiss (`leads.merge`), but only pairs whose records they can all see.
- **History** (FLOW-185, `worker/records/lead-audit.ts`): assignment (one row per lead whose salesperson changes), status changes, conversion, merges and dismissed duplicates each write an audit row on the lead in the same transaction. A merge writes one row on the kept lead (`mergedLeadIds` and the details it took) and an `archive` row on the merged one. Converting into an existing client writes a row on that client for the contact it adds. Raw payloads are never in lead history; contact details follow the lead's visibility.
- **Dashboard** (FLOW-113, `worker/records/lead-dashboard.ts`, `/#/leads/dashboard`): leads received in the range by source, channel, status and salesperson, with conversion rate (converted ÷ leads), closed leads (converted leads whose event reached Closed, Preparation or Finished), median first-response time and leads awaiting action (status New). Per source it also shows purchased vs not purchased, for sources that have any purchased lead. **Money is an estimate** until proposals carry real totals (FLOW-122): a closed lead counts at its stated budget, or at the average budget of the leads in range when it gave none (decided by Ash, 2026-10-23). Admin, Technical and the Sales Manager see everyone's numbers; a salesperson sees only their own leads. Merged-away leads are not counted.

## Global search

`GET /api/search?q=<text>` (FLOW-46, `worker/records/search.ts`, ADR-24) powers the header search (`src/features/search.tsx`). It searches client names and contact names, lead names, event titles, venue names inventory item names and vendor names (FLOW-84) with Postgres full-text search plus pg_trgm, so one typo still matches (trigram word similarity ≥ 0.4); emails, item codes and phone numbers (4+ digits, punctuation ignored) match any part as typed. It returns up to 20 results, at most 5 per type, best first (`{type, id, title, subtitle, path, score}`); queries under 2 characters return nothing. Every type is filtered by the caller's own visibility (the same rules as the lists: a salesperson sees only their own clients, leads and events, staff only the events they work), client contact email and phone and vendor contacts are matched only for FT+ users; lead email and phone match for anyone with access to the lead, and archived records are left out. Migration `0013` enables `pg_trgm` (`CREATE EXTENSION IF NOT EXISTS`, available on Supabase Free) and adds trigram indexes. Recipes join the search with FLOW-217.

## Time tracking

Automatic activity time tracking (FLOW-119) measures in-app time per record and per type of work, without a timer. Schemas and constants live in `shared/time-tracking.ts`, the browser logic in `src/services/time-tracking.ts` (`ActivityTracker`) and `src/app/useActivityTracking.ts`, and the API in `worker/routes/time-tracking.ts` with logic in `worker/records/time-tracking.ts`.

| Route | Purpose |
| --- | --- |
| `POST /api/time/sessions` | `{sessions: [{id, startedAt, endedAt, recordType, recordId, activity}]}`, up to 100. Always the caller's own time |
| `GET /api/time/report?from=&to=&userId=` | Effort per event and workload per user and activity type, for New York dates (the last 30 days by default) |

- **What counts:** time accrues only while a Flowbase tab is visible and the user has typed or clicked within the idle cutoff (5 minutes by default; Admin changes it in business settings, FLOW-45, and open tabs pick it up when they next load settings). An idle session ends when the cutoff passes; hiding the tab ends it at once, and time starts again with the next input. Only time inside Flowbase is measured.
- **What it's credited to:** the screen decides (`contextForPath`): leads, clients and events credit the record on screen; proposals (demo data until FLOW-122), venues and inventory credit only the activity type (proposal work, event planning, inventory, kitchen for the ingredient catalog); everything else is "general". BEO and task records and the delegating type are ready for when those modules exist.
- **Requests:** the browser sends at most one request a minute (`FLUSH_INTERVAL_MS`). An open session is resent with a later end under the same id and stays one row (`activity_sessions`, unique on user and session id); its end only ever grows. A 401 or 403 stops tracking for that page, so until sign-in (FLOW-36) nothing is recorded. Closing the tab can lose up to a minute that wasn't sent yet.
- **Who sees what** (`timeReportScope` in `worker/policy.ts`): Admin and Sales Manager see everyone's time and can narrow to one user; everyone else sees only their own. Events in the effort report also follow event visibility. Until the users table exists (FLOW-37) users show as ids.
- **Notice:** a "Time tracking is on" notice shows on first use (remembered per browser until sign-in exists) and on the Settings page.

## Staff directory

`/staff` (FLOW-40, `src/features/staff.tsx`, API `worker/routes/staff.ts` with logic in `worker/records/staff.ts`) lists every invited user except revoked invitations: name, email, mobile number, role, employment type, active flag (`status` is active), notes, qualified positions (labels from the `staff_position` list in business settings) and SMS consent (`users.sms_consent_at`, the opt-in date; STOP replies are the SMS channel's job, FLOW-52). The directory filters by position, employment type and inactive staff, and exports to CSV.

| Route | Purpose |
| --- | --- |
| `GET /api/staff` | The directory, for every signed-in role (`staff.read`) |
| `GET /api/staff/<id>` | One profile |
| `PATCH /api/staff/<id>` | `{name, mobile, role, employmentType, positions, notes, smsConsent}`, any subset. Anyone may change their own `mobile` and `smsConsent` (`staff.update_self`); everything else, and other people's profiles, needs `users.manage` (Admin). Positions must be active list values, except ones the profile already has. You can't change your own role. Audited as `user` |

A mobile number shows to FT+ and to the person themselves (`staff_contact` in `shared/visibility.ts`); notes show to FT+ only. Email stays the sign-in identity and isn't editable here: revoke and re-invite to change it. A name Admin sets before the first sign-in is kept; otherwise the Google name is used. The profile page shows the signed-in user's own profile.

## Business settings

`/settings` (FLOW-45, `src/features/settings.tsx`, API `worker/routes/settings.ts` with logic in `worker/records/settings.ts`, schemas in `shared/settings.ts`). Everyone reads the settings (`settings.read`); only Admin changes them (`settings.manage`). Every change writes an audit row (`setting` or `list_value`); the screen shows the last 100.

- **Company profile:** name, website, sales contact block and logo for printed documents (`PrintLayout`). The browser scales the logo to fit 600 × 240 and re-encodes it as PNG or JPEG; it is stored inline in the profile (at most 200,000 characters), and the audit records only that it changed.
- **Lists** (`list_values`): staff positions, event types, service types, food service styles, dress code presets, lead sources, vehicles, recipe categories, and rental, decor, kitchen equipment, ingredient and supply categories. Migration `0021` seeds them from `defaultListValues` (the 10 BEO positions, Corporate/Wedding, Full Service, Stationed/Buffet/Plated, the lead sources, Truck 1–3, the ingredient categories). Admin adds, renames, reorders, archives and restores values; labels are unique per list among active values. Records store the label: archived values stay on old records and show as "(archived)", but forms offer only active values. The event form picks event type, service type and food service style from their lists and suggests dress code presets; the inventory item form suggests its kind's categories; the lead inbox filters by lead source; staff profiles pick positions. Inventory sections keep their own screen (FLOW-70); bar categories stay built in because bar count rounding depends on them.
- **Defaults** (`settings` rows `company` and `defaults`): rental buffer days before and after (1 and 1), per-guest ratio defaults by category (a new item in that category starts with the ratio), default payment terms, urgent (SMS) notification types, the monthly SMS cap (0 sends none), the time-tracking idle cutoff (5 minutes, the FLOW-119 answer), and the BEO key fields that trigger re-approval. No tax rates. A missing or no-longer-valid row reads as the built-in defaults.

| Route | Purpose |
| --- | --- |
| `GET /api/settings` | `{company, defaults, lists}`; lists include archived values, flagged |
| `PUT /api/settings/company`, `PUT /api/settings/defaults` | Replace a settings group |
| `POST /api/settings/lists/<key>` | `{label}` adds a value |
| `PUT /api/settings/lists/<key>/order` | `{ids}` sets the display order |
| `PATCH /api/settings/values/<id>` | `{label}` renames; saved records keep the old label |
| `POST /api/settings/values/<id>/archive`, `/restore` | Archive or restore a value |
| `GET /api/settings/history` | Recent changes (Admin) |

The browser loads settings once per page (`useBusinessSettings`, `src/services/settings.ts`) and refreshes them after Admin's changes; until they load, or if they can't, it uses the same built-in defaults.

## Data import

`/imports` (FLOW-47, ADR-09; `src/features/imports.tsx`, API `worker/routes/imports.ts` with logic in `worker/records/imports.ts`, schemas and pure helpers in `shared/imports.ts`). The browser reads the CSV or XLSX file (`src/services/import-files.ts`; XLSX through `fflate`, first worksheet only, numbers and dates as stored), maps columns to the importer's fields (matched by label, key or alias), applies the importer's row transforms (`category_headers`, `fill_down`), runs a dry run and commits, both in requests of at most 100 rows.

| Route | Purpose |
| --- | --- |
| `GET /api/imports/modules`, `/modules/<key>` | The importers the caller may run, with their fields and transforms |
| `POST /api/imports/dry-run` | `{module, rows}`: per row `create`, `update`, `skip` or `error`, with errors and possible duplicates. Writes nothing |
| `POST /api/imports` | Start an import: `{module, fileName, rowCount}` → the log entry |
| `POST /api/imports/<id>/rows` | Commit up to 100 `{rowNumber, values}` rows; returns each row's outcome and the log |
| `POST /api/imports/<id>/complete`, `GET /api/imports?module=`, `GET /api/imports/<id>` | Finish the import; the import log |

- **Module importers** (`ImportModule`, registered in `importModules`; tests pass their own through `createApp({ importModules })`): `parse` one row, name its `externalKey`, `check` it against the database, find possible duplicates, say whether a re-imported row `wouldChange` its record, and `create` or `update` it. Each importer names the permission it needs; importers the caller can't run are not listed. Master Inventory (FLOW-78), Kitchen Ingredients (FLOW-89), Bar Inventory (FLOW-91), Recipes (FLOW-99) and Leads (FLOW-101) register their own; none is registered yet, so `/imports` lists nothing until the first one lands. Inventory importers enter quantities with `recordImportedStock` (FLOW-168); a re-run overwrites the section's stock with the file's quantity.
- **Re-runs** (AC1): `import_keys` records the record each `(module, external key)` imported to, so a re-run updates it, or skips it when nothing changed. Rows sharing a key in one file update the first row's record.
- **Errors** (AC2): each row runs in its own savepoint; a row that fails its checks or its write is reported with its row number and rolled back alone, and the other rows still import.
- **Log:** `import_logs` keeps who, when, the file name and the created, updated, unchanged and failed counts. Stock movements for imported quantities link to it.

## List export

Lists with an **Export CSV** button (FLOW-48: inventory, ingredients, bar, low stock, clients, venues, events, leads, staff, time reports and lead sources) build the file in the browser from the rows on screen (`DataTable` `exportName`, `src/services/csv.ts`, ADR-09): every row that matches the current filters, in the current sort, not just the visible page. Columns are the table's columns (action and checkbox columns are left out); a column can give a plainer CSV value through `meta.csv`. A column that holds a field group (`meta.fieldGroup`, e.g. unit cost as `internal_cost`, client contact details, staff phone numbers) is left out of the file entirely for anyone who may not see that group, so Kitchen Staff exports have no client contacts and Staff exports no costs. Files are UTF-8 with a byte order mark, comma-separated with CRLF line endings, quoted per RFC 4180, and text that starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe so spreadsheets don't run it as a formula. File names are `<list>-<New York date>.csv`.

## Attachments

Photos and documents attach to clients, venues and events (FLOW-42, ADR-08) through `/api/attachments` (`worker/routes/attachments.ts`) and the `Attachments` component (`src/features/attachments.tsx`). Venues use two groups, Floor plans and Aerial images.

- **In the browser** (`src/services/attachments.ts`): a file is checked before anything uploads (photos JPEG/PNG/WebP/HEIC up to 25 MB, PDF and .docx up to 20 MB). A photo is resized on a canvas to a 320 px thumbnail and a 1600 px display JPEG; only those two are uploaded, never the original. Documents upload as they are.
- **Upload:** `POST /api/attachments` checks the record (same visibility as the record itself; records you can't see answer 404) and the declared variants, stores a pending row, and returns signed R2 `PUT` URLs valid for 5 minutes. Each URL is signed for the exact content type and length declared. The browser `PUT`s straight to R2, then `POST /api/attachments/<id>/complete` marks it ready (in production the `FILES` binding first confirms each object arrived at its declared size). The Worker never handles file bytes. Object keys are generated (`<record type>/<record id>/<attachment id>/<variant>.<ext>`); file names are only metadata.
- **Download:** `GET /api/attachments?recordType=&recordId=` returns ready files with signed `GET` URLs that expire after 5 minutes. `PATCH /api/attachments/<id>` changes caption or order; `POST /api/attachments/<id>/archive` hides a file.
- **Config:** `R2_ACCOUNT_ID` and `R2_BUCKET` (`flowbase-files`) are production vars in `wrangler.jsonc`; `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (the R2 API token's S3 key pair) are Worker secrets. Without them the routes answer `503 STORAGE_NOT_CONFIGURED`, which is the case in dev and CI. Signing is in `worker/attachments/presign.ts` (SigV4, checked against AWS's published example).
- **Bucket CORS** (one-time, Cloudflare dashboard → R2 → `flowbase-files` → Settings → CORS): allow origin `https://flowbase.sybertechlabs.workers.dev`, methods `GET` and `PUT`, header `Content-Type`.

## Printable documents

`PrintLayout` (`src/components/print/PrintLayout.tsx`, FLOW-49, ADR-17) is the shared print layout for the recipe book, order list and BEO: a company header block (logo, name, sales contact and website from the company profile in business settings, FLOW-45; built-in placeholders until Admin fills it in), US Letter pages with the header repeated on every page, and page numbers where the browser supports CSS page margin boxes (Chrome; Safari prints without them). Users print or "Save as PDF" from the browser; there is no PDF server or library. `/#/print/sample` is a sample multi-page document for checking the layout.

## Tasks

One task model for every module (FLOW-58, `shared/tasks.ts`; service in `worker/records/tasks.ts`, API `worker/routes/tasks.ts`). A task has a title, description, type (`general | delegated | kitchen | production | truck_load | misc`), status (`todo | in_progress | blocked | done`), priority, due time, assignees, an overseer, its creator, links to an event, client, inventory item or BEO, a checklist, comments and attachments (`recordType: "task"`). Kitchen, production and truck-loading tasks are rows of the same `tasks` table, so they appear in the same lists.

- **Service API:** other modules call `createTask(tx, actor, input)` and `updateTask(tx, actor, id, patch)` inside their own transaction (`actor` is `null` for system changes); there are no task tables per module. Linked records must exist, and a person may link only records they can open.
- **Status rules:** moving to `done` records who completed it and when (`completedBy`, `completedAt`); saving `done` again keeps them; reopening clears them.
- **Who sees and changes what** (`shared/policy.ts`): FT+ see every task, everyone else the tasks they are assigned to, oversee or created (`taskScope`). Anyone who can see a task changes its status, works its checklist and comments. Its details, assignees and overseer need `mayManageTask` (its creator, its overseer, or `tasks.delegate`: Admin, Sales Manager, Kitchen Lead and FT+). Without `tasks.delegate` you can only assign tasks to yourself.
- **Audit and events:** every change writes an audit row (`task`; checklist changes are task updates, comments `task_comment`). A change of assignees emits `task.assigned` with `addedUserIds`, `removedUserIds` and `actorId`. Each cron run emits `task.due` once per open task and due time (`emitDueTaskEvents`; tasks more than 7 days overdue when first seen are skipped).
- `/tasks/<id>` shows one task: status, checklist, comments and files. Lists, saved views and delegation screens are FLOW-59 and FLOW-60.

| Route | Purpose |
| --- | --- |
| `GET /api/tasks?type=&status=&assigneeId=&eventId=&mine=true&includeDone=true` | Tasks the caller can see, newest first, paged; done tasks only with `status=done` or `includeDone=true` |
| `GET /api/tasks/<id>` | One task with checklist, comments and `canManage` |
| `POST /api/tasks`, `PATCH /api/tasks/<id>` | Create, or change any subset |
| `POST /api/tasks/<id>/archive` | Archive (needs `mayManageTask`) |
| `POST /api/tasks/<id>/checklist`, `PATCH`/`POST …/checklist/<itemId>[/archive]` | Add, tick, rename or remove a checklist item |
| `POST /api/tasks/<id>/comments` | Add a comment |

## Notifications

In-app and email notifications (FLOW-43, ADR-12; catalog in `shared/notifications.ts`, fan-out in `worker/notifications/fanout.ts`, API `worker/routes/notifications.ts`). Each notification type subscribes to one domain event through the job registry:

| Type | Domain event | Who is told |
| --- | --- | --- |
| `task_assigned` | `task.assigned` | People added as assignees, except whoever assigned them |
| `task_due` | `task.due` | The task's assignees and overseer, while it is still open |
| `staff_assigned` | `event.staff_assigned` (FLOW-140) | The person put on the roster slot |
| `approval_requested`, `approval_decided`, `inventory_conflict`, `production_alert`, `proposal_approved`, `payment_due`, `payment_overdue`, `collector_failure` | `approval.requested`, `approval.decided`, `inventory.conflict_detected`, `production.alert_raised`, `proposal.approved`, `payment.due`, `payment.overdue`, `collector.failed` | The producing module decides: its event's data carries `recipientIds`, `title`, `body` and an in-app `link` (`notifyPayloadSchema`). A payload without them fails the job so an admin sees it |

- **Exactly once (AC1):** each notification stores its event job's idempotency key, and `(source_key, user_id)` is unique, so a retried or reclaimed job notifies nobody twice. Only active staff are notified.
- **Email (AC2, AC3):** in-app is always on. Unless the person turned email off for that type (`notification_preferences`; no row means on), each notification queues its own `notification.email` job in the same transaction. That job sends through the `EmailProvider` interface (`worker/notifications/email.ts`; Resend's free tier, FLOW-33) with the job's key as Resend's `Idempotency-Key`, so a retry after a successful send emails nobody twice. A failed send logs `notification_email_failed` (no recipient address) and is retried by the jobs system with its usual backoff; preferences are checked again at send time. Without `EMAIL_API_KEY` and `EMAIL_FROM` emails are skipped and logged (`notification_email_skipped`), which is the case in dev and CI.
- **Urgent:** business settings mark types as urgent (Settings → Defaults, one checkbox per type); the SMS channel (FLOW-52) reads that flag.
- **In the app:** the header bell shows the unread count and the 50 newest notifications; opening one marks it read and goes to its record. The bell checks every minute while the page is visible, because the cron sends no "changed" ping. Reading notifications and changing preferences send no ping either (`worker/realtime.ts`). Email settings are on the profile page.

| Route | Purpose |
| --- | --- |
| `GET /api/notifications` | `{unreadCount, notifications}` for the caller |
| `POST /api/notifications/<id>/read`, `POST /api/notifications/read-all` | Mark one or all read |
| `GET /api/notifications/preferences`, `PUT …` `{email: {<type>: boolean}}` | Email on or off per type, with the urgent flag |

**Email setup (production, after FLOW-33):** `npx wrangler secret put EMAIL_API_KEY --env production` (the Resend API key), and set `EMAIL_FROM` (the verified sender, e.g. `Flowbase <notifications@notifications.eventsbydmvcater.com>`) as a production var in `wrangler.jsonc` or a secret. `APP_URL` must be set for emails to link into the app.

## Background jobs

`worker/jobs/queue.ts` (FLOW-27) is the outbox and work queue, stored in the `jobs` table.

- **Enqueue inside the change's transaction.** `enqueueJob(tx, { type, payload, idempotencyKey })` and `emitDomainEvent(tx, { name, entityId, data })` take the caller's transaction, so a rolled-back change never leaves a job behind. A repeated idempotency key is ignored. Domain events are jobs of type `event:<name>` (`<entity>.<past-tense verb>`, e.g. `client.created`).
- **Handlers** register by type in `createJobRegistry()` (`worker/jobs/cron.ts`). Handlers must be idempotent. An event with no subscriber succeeds as a no-op; any other job type without a handler fails.
- **Cron.** One Cron Trigger (`*/5 * * * *` in `wrangler.jsonc`) first emits `task.due` for tasks that came due (FLOW-58), then runs `runDueJobs`, which claims at most 10 due jobs (`FOR UPDATE SKIP LOCKED`) so each run stays within the 10 ms CPU budget. A throwing handler retries after 30 s, 1 min, 2 min, … (capped at 1 h) and is marked `failed` after 5 attempts. A job stuck in `running` for 10 minutes is reclaimed. Without a Hyperdrive binding the cron logs `jobs_skipped` and does nothing.
- **Admin API:** `GET /api/admin/jobs?status=failed` lists jobs; `POST /api/admin/jobs/<id>/retry` re-queues a failed job with fresh attempts.

## Machine ingestion

`POST /api/ingest/<source>` (FLOW-28) is how outside systems push data in. Each request must authenticate, be at most 256 KB, and name its record; otherwise nothing is stored (401, 413 or 400). The raw body is stored once per source + record id in `ingest_receipts` with an `ingest.process` job in the same transaction; a repeat answers `200` with `duplicate: true` and creates nothing.

| Source | Auth | Record id | Worker secret |
| --- | --- | --- | --- |
| `leads` (lead collector, FLOW-102) | `Authorization: Bearer <token>` | `sourceRecordId` in the JSON body | `INGEST_TOKEN_LEADS` |
| `collector-runs` (FLOW-102) | `Authorization: Bearer <token>` | `sourceRecordId` (`<runId>:<site>`) | `INGEST_TOKEN_LEADS` |
| `thumbtack` (FLOW-108) | the token as `Authorization: Bearer`, an `X-Flowbase-Token` header, or the path (`/api/ingest/thumbtack/<token>`) | Thumbtack lead id + event id | `INGEST_TOKEN_THUMBTACK` |
| `shopify` (FLOW-109) | Shopify HMAC (`X-Shopify-Hmac-Sha256`) | `X-Shopify-Webhook-Id` header | `SHOPIFY_WEBHOOK_SECRET` |

Each source's ticket registers the processor that turns a receipt into records (`ingestProcessors` in `worker/ingest/processors.ts`); a source without one keeps its receipts unprocessed (Shopify until FLOW-109).

- **Lead collector** (FLOW-102, [collector/README.md](collector/README.md)): each `leads` receipt is one lead (`shared/collector.ts`), created through `createLead` with channel `collector`; a changed version of the same lead updates it. Each `collector-runs` receipt is stored in `collector_runs` (site, start, finish, leads found, `ok | needs_login | blocked | error`) for FLOW-107. The ops workflow template is `ops-templates/collector.yml`.
- **Thumbtack** (FLOW-108, `worker/ingest/thumbtack.ts`): Thumbtack's self-serve lead webhooks (FLOW-115 sets them up). Thumbtack documents no signature, so the webhook carries a long random token, in the URL path when no custom header is possible (request logs show the path as `/api/ingest/thumbtack/[token]`). The mapper reads Thumbtack's documented lead fields (`negotiationID`, `customer.displayName`/contact details, `customer.location`, `category.name`, the `details` questions for date, guests and budget, `createTime`) into a `webhook` lead with source Thumbtack; anything missing is left for review. A status update for a stored lead updates it (same source lead id); the Thumbtack status stays in the raw payload. The tests use the hand-made sample in `tests/fixtures/thumbtack/`, which FLOW-115 replaces with a captured payload.

**Rotating a secret:** set the secret to `old,new` (`npx wrangler secret put INGEST_TOKEN_LEADS --env production`), switch the sender to the new value, then set it to `new` alone.

**Admin API:** `GET /api/admin/ingest-receipts?status=failed&source=leads` lists receipts with their job status; `POST /api/admin/ingest-receipts/<id>/replay` queues a new processing job for a receipt whose job failed.

**Sign-in.** Admin routes check permissions through the shared role/action matrix in `shared/policy.ts` (FLOW-38). The Worker verifies the Supabase JWT and loads the caller from the allowlist on every staff API request. User management is Admin only.

## Deploy

Cloudflare Workers Builds deploys from `main`; GitHub Actions is not involved, so merges use no Actions minutes. CI on the PR remains the gate.

**Production (every merge to `main`).** Workers Builds installs dependencies from `package-lock.json`, then runs `npm run deploy`, which stops at the first failing step:

1. `npm run build`: type checks and builds the SPA into `dist/`.
2. `npm run deploy:migrate`: refuses to run without `DATABASE_URL`, then applies committed Drizzle migrations to the production database with `drizzle-kit migrate`.
3. `wrangler deploy --env production`: uploads and activates the new Worker version.

If the build or a migration fails, nothing is deployed and the previous version keeps serving. Drizzle applies the pending migrations in one transaction, so a failing migration leaves the schema as it was. Migrations run before the new code goes live, so they must stay compatible with the version currently serving (add columns and tables first; remove them in a later release).

**Non-production branches are not deployed** (FLOW-176). Worker secrets belong to the Worker, not to a version, so a preview version of `flowbase` would run unmerged code at a public URL with the production runtime secrets (`INGEST_TOKEN_LEADS`, `INGEST_TOKEN_THUMBTACK`, `SHOPIFY_WEBHOOK_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SENTRY_DSN`). Non-production branch builds are therefore off and there is no `deploy:preview` script. Check a branch with CI and `wrangler dev --remote --env dev` (see [Database](#database)). If previews are needed later, give them a separate Worker (for example `flowbase-preview`) bound to the dev database with dev-only secrets; never upload versions of `flowbase` from an unmerged branch.

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

**Manual verification.** Merge a trivial change, then in the Cloudflare dashboard confirm the build log shows the build, migrate and deploy steps and that the new version is active. A failing step ends the build before `wrangler deploy`, so the active version in the dashboard stays the same.

## Observability

Worker API requests emit JSON logs and return `X-Request-ID`. All API errors use `{ error: { code, message, requestId } }`; unexpected failures return a generic message and send the exception to Sentry tagged with that same ID. The SPA displays request references on API failures. Set `SENTRY_DSN` as a Worker secret and `VITE_SENTRY_DSN` as a public SPA build variable to enable Sentry; without DSNs, reporting is disabled. `APP_VERSION` optionally overrides the Worker release; both targets otherwise use the package version. Browser errors are captured by Sentry's React integration and error boundary. Request/user objects are stripped from Sentry events, and tracing/replays are disabled. Cloudflare request logs are enabled in Wrangler. Use only the Sentry free plan; monitor its event quota and Cloudflare usage before go-live.

Health reports Worker liveness plus version and `database: reachable | unreachable | not_configured`. With an optional `HYPERDRIVE` binding it executes `select 1` using a request-local Postgres.js client, then closes it. A missing binding is reported as `not_configured`; it is never treated as a verified database connection. Hyperdrive binding IDs and the connection decision are in [Database](#database); live dev verification is a manual check there.

Manual telemetry check after developer setup: configure both DSNs, trigger a controlled Worker failure in a development environment, and confirm the event's request ID matches its response header and Cloudflare log. Trigger a browser render error and confirm the fallback and Sentry event. No failure-trigger route is shipped. Confirm both projects remain on free tiers and inspect quotas. CI verifies middleware, SDK wiring, and DB-probe states without contacting Sentry or production resources.
