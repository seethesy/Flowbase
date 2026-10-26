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
- **Inventory:** real items from the API (see [Inventory](#inventory)): rentals, decor, ingredients, bar stock, supplies and services, with per-section stock, the stock ledger (movement history, transfers, counts, receipts, adjustments and corrections) on the item page, the kitchen ingredient catalog, the bar screen, count mode, the low-stock list, cost history, and Admin-managed sections. The Dashboard stock alerts still use the demo item fixtures.
- Global search (header, see [Global search](#global-search)) finds real clients, leads, events, venues and inventory items; demo proposals are no longer in it. Notifications link to sample records. Purchasing and Help are labeled placeholders; Reports holds the time-tracking reports and Settings the time-tracking notice (see [Time tracking](#time-tracking)). Proposals and the Dashboard still use the demo client fixtures. Employee profile is fictional.

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

Supabase Free Postgres (`flowbase-prod` `lfsznrmrzxiohzydetbd`, `flowbase-dev` `qlnjdckcrawrcgcoecpl`), reached from the Worker through Hyperdrive with caching disabled. The browser never queries the database. Schema and migrations are Drizzle only: `worker/db/schema.ts` defines tables and `drizzle/` holds the generated SQL and snapshots. Never edit generated migrations by hand, and never change the database any other way.

**Connection string type: direct connection.** Both Hyperdrive configs use Supabase's direct connection string (`db.<project-ref>.supabase.co:5432`), which Hyperdrive reaches over IPv6. The session pooler is not needed and the paid IPv4 add-on is never used. This is recorded from the developer's answer on FLOW-24; confirm it with the live check below. If that check fails to connect, recreate the Hyperdrive config with the session pooler string (`--caching-disabled`), then update this paragraph. Your own laptop may lack IPv6: for `db:migrate` only, use the dev project's session pooler string as `DATABASE_URL`.

**Conventions** (`worker/db/conventions.ts`; CI tests enforce them):

- UUID primary keys generated by the database (`gen_random_uuid()`).
- `created_at`, `updated_at` (set on every Drizzle update), `created_by`, `updated_by`. The two `*_by` columns are nullable and have no foreign key until the users table exists.
- Soft delete through `archived_at`; list queries exclude archived rows.
- Money as integer cents (`moneyCents`), all times as `timestamptz` (`timestamptz`).
- RLS on every table with no browser-facing policies.

**Adding a table:** spread `...baseColumns()` into `pgTable(...)`, end it with `.enableRLS()`, run `npm run db:generate`, and commit the SQL and snapshot together with the schema change. CI rejects a schema without a matching migration, and any table in `public` without RLS.

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
| Clients | `GET /api/clients?archived=&flagged=`, `GET/PUT /api/clients/<id>`, `POST /api/clients`, `POST /api/clients/<id>/archive` and `/restore` |
| Venues | the same shape under `/api/venues` |
| History | `GET /api/clients/<id>/history`, and the same under `/api/venues` and `/api/events` |
| Event status | `POST /api/events/<id>/status`, `GET /api/events/<id>/status-history` |
| Events | the same shape under `/api/events`, with `?clientId=&venueId=&from=&to=` (New York dates). Lead conversion creates events in Inquiry; see Lifecycle below |

- **Who sees what** (`worker/policy.ts`, a stand-in for FLOW-38): Admin, Technical and Sales Manager see every client and event; a salesperson sees the clients and events assigned to them (their new clients are assigned to them); other staff see the events they lead or assist and no clients. Records a user can't see answer 404. Venues are visible to everyone. Writes are open to Admin, Technical, Sales Manager and salespeople.
- **Contact details** (F-01-04): client contact email/phone and venue contacts come back as `null` for anyone who isn't FT+. An update that omits a contact's email or phone keeps the stored value.
- **Duplicates:** creating a client whose contact email or phone matches an existing contact answers `409 POSSIBLE_DUPLICATE` with the matches, and the form offers "Create anyway" (`allowDuplicate: true`). A salesperson is only warned about their own clients; a match they can't see is saved as `possibleDuplicateOf`, which only Admin, Technical and Sales Manager see (`?flagged=true`), and emits `client.duplicate_flagged`.
- **Events:** only title, date, start time and client are required. Times are entered as New York wall-clock times and stored as UTC (`shared/time.ts`); an end time before the start runs past midnight. Picking a venue copies its address (when the address is empty) and its areas; per-event areas can be added. `booked_at` records the first time the event reaches Negotiation (or a later status other than Lost, if it skipped Negotiation). People fields (salesperson, Production Lead, assistants) are user ids until the users table exists.
- Every create, update, archive and restore emits a domain event (`client.created`, `event.updated`, …) in the same transaction.
- **Lifecycle** (FLOW-56, `shared/event-lifecycle.ts`): Inquiry → Pitching → P creation → Initial P sent → Negotiation → Closing → Closed (paid and signed) → Preparation → Finished | Lost. An event can be created in any status. After that the status never changes through `PUT`: Admin or the event's salesperson changes it with `POST /api/events/<id>/status` (`{ status, reason? }`) to any other status, and the system moves it with `advanceEventStatus` (in `worker/records/events.ts`, for the features that drive it), which allows only the next status or Lost and refuses anything else with `409 INVALID_TRANSITION`. Finished and Lost are final for the system. Every change writes a row to `event_status_history` (who, when, from, to, why, manual or automatic; `GET /api/events/<id>/status-history`), writes the audit row and emits exactly one domain event, `event.<new status>` with `{ from, to, reason, manual }`.
- **History** (FLOW-41, `worker/audit/log.ts`): every create, update, archive and restore of a client, venue or event (FLOW-161) writes one row to the append-only `audit_log` in the same transaction: actor, time, and a before/after diff of only the changed fields, keyed by their API names (a client's contacts, a venue's areas and contacts, and an event's area names are fields of their record). An update that changes nothing writes no row. `GET /api/{clients,venues,events}/<id>/history` returns it newest first to anyone who can see the record, hiding what the record itself hides from them (contact details from part-time users, the possible-duplicate match from salespeople); a change made only to hidden fields doesn't appear. No route updates or deletes audit rows.
- **Event hub** (FLOW-57): `/events/<id>` is one page per event, loaded from `GET /api/events/<id>/hub`, which returns the event, its client (or `null`), the sections to show whether the user may edit, and whether they may change the status (FLOW-56). The full set of sections is defined in `shared/event-hub.ts`. Only the sections whose module exists are listed (`builtSections` in `worker/records/events.ts`: details, client and files), and each module ticket adds its own. The client section needs access to the client record, so staff who only work the event see the client's name in the details but not the client, and contact details follow F-01-04. Edit and Archive appear only for roles with `events.write`.

## Inventory

Inventory items (FLOW-69), sections and stock (FLOW-70), the ingredient catalog (FLOW-81), the stock ledger (FLOW-71), count mode (FLOW-82), cost history (FLOW-83) and bar stock (FLOW-90) live in Postgres and are served by `worker/routes/inventory.ts`; Zod schemas in `shared/inventory.ts` are shared by the API and the screens in `src/features/inventory.tsx` (`/inventory`, `/inventory/ingredients`, `/inventory/bar`, `/inventory/sections`, `/inventory/<id>`) and `src/features/stock-counts.tsx` (`/inventory/counts`, `/inventory/counts/<id>`, `/inventory/low-stock`).

| Resource | Routes |
| --- | --- |
| Items | `GET /api/inventory/items?kind=&subtype=&category=&sectionId=&vendor=&belowPar=&search=&tier=&subcategory=&archived=`, `GET/PUT /api/inventory/items/<id>`, `POST /api/inventory/items`, `POST /api/inventory/items/<id>/archive` and `/restore`, `GET /api/inventory/items/<id>/cost-history` (FT+) |
| Stock | `GET /api/inventory/items/<id>/movements`, `POST /api/inventory/items/<id>/movements` (`type`, `sectionId`, `quantity`, `reason`, optional `eventId`), `POST /api/inventory/items/<id>/transfers` (`fromSectionId`, `toSectionId`, `quantity`, `reason`), `POST /api/inventory/items/<id>/counts` (`sectionId`, counted `quantity`, `reason`), `POST /api/inventory/movements/<id>/corrections` (what it should have been, `reason`) |
| Counts | `GET /api/inventory/counts?status=`, `POST /api/inventory/counts` (`sectionId`; resumes the open count), `GET /api/inventory/counts/<id>`, `POST /api/inventory/counts/<id>/lines` (`itemId`, counted `quantity`, `reason`), `POST /api/inventory/counts/<id>/complete` |
| Sections | `GET /api/inventory/sections?kind=&archived=`, `POST /api/inventory/sections`, `PUT /api/inventory/sections/<id>` (rename), `POST /api/inventory/sections/<id>/archive` and `/restore` |

- **Items:** `kind` is `rental`, `consumable` or `service`, with a subtype for rentals (equipment, furniture, linen, tableware, glassware, bar, decor) and consumables (ingredient, bar, supply). Every item has a code, name, category, stock unit, optional display group, tier and color/finish, and an optional ratio (e.g. 2 per guest). Kind-specific fields live in their own tables (`inventory_rental_details`, `inventory_consumable_details`, `inventory_service_details`). An item's kind can't change, and a live code is unique. Photos attach through [Attachments](#attachments) (`inventory_item`). Categories and allergen flags are built-in lists until business settings (FLOW-45) and allergen tags (FLOW-95) exist; the preferred vendor is free text until vendors are records.
- **Units** (`shared/units.ts`, FLOW-51): count (each, dozen, case), weight (oz, lb, g, kg) and volume (tsp, tbsp, cup, fl oz, qt, gal, ml, l). `convert()` handles the standard conversions plus each item's pack count (a case of 12) and "one each is about" size (750 ml a bottle, 8 oz a chicken breast), and returns `cannot_convert` instead of guessing (weight ↔ volume never converts). `orderQuantity()` rounds up to whole purchase units. A recipe unit an ingredient can't be converted to is flagged on the form (`recipeUnitProblem`).
- **Stock:** quantities are per item and section. Rentals live in rental sections (Warehouse, Jamie's, Cafe, Vendor for sub-rentals, and Unlabeled for rentals with no location label), consumables in storage sections (Kitchen – Dry Storage, – Refrigerated, – Freezer, Bar Storage, Supplies); the defaults are seeded by migration.
- **Stock ledger (FLOW-71):** every quantity change is a `stock_movements` row: one item, one section, a signed quantity, a type (`receive`, `adjust`, `count`, `transfer`, `pull`, `return`, `damage_loss`, `consume`), the reason, the user and time, and an optional link to an event, order or import. A transfer is two rows sharing a `transfer_id`. `inventory_stock` caches on-hand per item and section; `recordMovement` (`worker/records/inventory.ts`) is the only writer and updates it in the same transaction as the movements, never lets a section go below zero, and rejects service items. No route sets a quantity. Movements are append-only (a database trigger rejects updates and deletes); a correction is a new movement of the difference that points at the original (`corrects_id`), and a transfer is corrected by transferring back. Each movement emits `stock.moved`. Movements aren't written to an audit log yet (there's no audit log in `main`), and imported starting quantities arrive with the import tickets; both are FLOW-168.
- **Count mode (FLOW-82):** a count covers one storage section: its consumables (kept there, holding stock there, or already counted) listed in shelf order (`storageOrder` on the item). Each saved count writes a `count` movement for the difference (bar counts round to the nearest 0.5 for beer, wine and champagne and the nearest 0.25 for liquor and cordials, `barCountStep`) and replaces the item's line in the count (`stock_counts`, `stock_count_lines`), so a count left part-way resumes where it stopped; starting a count where one is open resumes it. Consumable counts need no approval; rentals are counted from the item page. The low-stock list (`/inventory/low-stock`) shows consumables below par.
- **Cost history (FLOW-83):** every change to a consumable's unit cost is logged in `inventory_cost_history` with the previous and new cost, the source (`manual` from the item form; `receiving` from FLOW-88 through `recordCostChange`) and the user, and emits `inventory_item.cost_changed` for recipe costing (FLOW-94) to recalculate recipes.
- **Bar stock (FLOW-90):** consumables of subtype `bar`, with a category from the bar inventory masterlist (Beer, Wine, Champagne, Liquor, Cordials, Mixers & Juices, Garnishes, Soft Beverages), a subcategory for wine (White, Red) and liquor (Vodka, Tequila, Gin, Rum, Whiskey, Cognac), all built-in until FLOW-45, brand or varietal and container (`inventory_bar_details`), tier `rail`, `mid`, `high` or `premium`, size (each size), pack size (case count), distributor (preferred vendor), unit cost, par and storage section (Bar Storage by default). The bar screen filters by category, subcategory, tier and distributor.
- **Who can do what** (`worker/policy.ts`): every signed-in user can read inventory. Admin, Technical, Sales Manager and the kitchen lead can change items and consumable stock and correct movements. Rental stock (counts, receipts, transfers, corrections) is also updated by salespeople, kitchen staff and FT+ (`canMoveItem`, `canCountItem`); editing the rental item itself stays with the managers. Ingredients are counted by Admin, the kitchen lead and kitchen staff; bar stock and supplies by Admin and FT+. Only Admin adds, renames and archives sections; a section that still holds stock can't be archived. Consumable costs and cost history are FT+ only (F-01-04): costs come back `null` (with `costHidden`) for anyone else, and an update that omits the cost keeps it.

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

- **Entering a lead:** there is no create route. Collectors (FLOW-102), webhooks (FLOW-108), manual entry (FLOW-101) and import (FLOW-109) call `createLead(db, input)`, which stores the lead and emits `lead.collected` (collector) or `lead.received` (everything else) in the same transaction. Only `channel` and `source` are required; a lead with no event date, or with neither email nor phone, appears in the **Needs review** view.
- **Who sees what:** Admin, Technical and Sales Manager see every lead; a salesperson sees only the leads assigned to them, and any other lead answers 404 (Q-41). Other roles get 403. The raw payload is returned only on the detail response and only to FT+ users.
- **Triage and assignment:** the triage queue is every open lead (new, contacted or qualified) with no salesperson. Only Admin can assign or reassign (FLOW-111 Q-41a; `leads.assign` in `worker/policy.ts` is the one rule to widen if the Sales Manager should assign too). Bulk assign is all or nothing. Each change of salesperson emits `lead.assigned` with the new and previous salesperson; the notification (FLOW-43) subscribes to it. Until the users table exists (FLOW-37) the salesperson is a user id typed into the form.
- **Status:** `new → contacted → qualified`, and `lost` from any open status with a required reason. Lost and converted are final; `converted` is reached only by converting. The first move to `contacted` stamps `firstRespondedAt`; first-response time is the gap from `receivedAt` to that moment. Each change emits `lead.status_changed`.
- **Convert:** needs a `qualified` lead. In one transaction it creates a client (or links an existing one) with a contact from the lead, creates an event with status `inquiry` pre-filled from the lead (date, guest count, event type, location as the address, message as the internal notes), marks the lead `converted` with links to both, and emits `lead.converted` (`clientId`, `eventId`) plus the usual `client.created` / `event.created`. If anything fails, nothing is kept. The start time is entered at conversion (the lead has none); the date defaults to the lead's. A matching client email or phone answers `409 POSSIBLE_DUPLICATE`, and the form offers to link to the match or create anyway. A salesperson converts only their own leads, into clients and events assigned to them. The proposal that FLOW-112 also asks for is not created yet: proposals do not exist until FLOW-122.
- **Duplicates** (FLOW-110, `worker/records/lead-duplicates.ts`): `createLead` matches each new lead in this order: (1) the same source and source lead id is the same lead again, so it updates the stored lead's details (and raw payload) instead of creating one and emits `lead.updated`; (2) email (case-insensitive) or phone (digits only, without a leading 1) against earlier leads and client contacts; (3) the same event date and a similar name (pg_trgm similarity ≥ 0.6). Each match is stored in `lead_duplicates` as an open possible duplicate and `lead.duplicates_found` is emitted. The lead detail lists the matches the caller can see; a client match offers "Convert and link". **Cross-owner:** a salesperson never sees a match they can't open; when it belongs to another salesperson the detail only says so (`assignedElsewhere`), and the pair waits in Admin's and the Sales Manager's **Duplicates** tab, flagged "Different salespeople". Merging keeps the chosen lead: the other is archived with `merged_into_lead_id`, `merged_at` and `merged_by`, keeps its source record and raw payload, and appears in the kept lead's `sourceLinks`; details only the other lead had are copied over, its other open duplicates move to the kept lead, a converted lead can only be the one kept, and `lead.merged` is emitted. Admin, Technical, Sales Manager and salespeople may merge or dismiss (`leads.merge`), but only pairs whose records they can all see.
- **Dashboard** (FLOW-113, `worker/records/lead-dashboard.ts`, `/#/leads/dashboard`): leads received in the range by source, channel, status and salesperson, with conversion rate (converted ÷ leads), closed leads (converted leads whose event reached Closed, Preparation or Finished), median first-response time and leads awaiting action (status New). Per source it also shows purchased vs not purchased, for sources that have any purchased lead. **Money is an estimate** until proposals carry real totals (FLOW-122): a closed lead counts at its stated budget, or at the average budget of the leads in range when it gave none (decided by Ash, 2026-10-23). Admin, Technical and the Sales Manager see everyone's numbers; a salesperson sees only their own leads. Merged-away leads are not counted.

## Global search

`GET /api/search?q=<text>` (FLOW-46, `worker/records/search.ts`, ADR-24) powers the header search (`src/features/search.tsx`). It searches client names and contact names, lead names, event titles, venue names and inventory item names with Postgres full-text search plus pg_trgm, so one typo still matches (trigram word similarity ≥ 0.4); emails, item codes and phone numbers (4+ digits, punctuation ignored) match any part as typed. It returns up to 20 results, at most 5 per type, best first (`{type, id, title, subtitle, path, score}`); queries under 2 characters return nothing. Every type is filtered by the caller's own visibility (the same rules as the lists: a salesperson sees only their own clients, leads and events, staff only the events they work), contact email and phone are matched only for FT+ users, and archived records are left out. Migration `0013` enables `pg_trgm` (`CREATE EXTENSION IF NOT EXISTS`, available on Supabase Free) and adds trigram indexes. Recipes and vendors join the search when their tables exist.

## Time tracking

Automatic activity time tracking (FLOW-119) measures in-app time per record and per type of work, without a timer. Schemas and constants live in `shared/time-tracking.ts`, the browser logic in `src/services/time-tracking.ts` (`ActivityTracker`) and `src/app/useActivityTracking.ts`, and the API in `worker/routes/time-tracking.ts` with logic in `worker/records/time-tracking.ts`.

| Route | Purpose |
| --- | --- |
| `POST /api/time/sessions` | `{sessions: [{id, startedAt, endedAt, recordType, recordId, activity}]}`, up to 100. Always the caller's own time |
| `GET /api/time/report?from=&to=&userId=` | Effort per event and workload per user and activity type, for New York dates (the last 30 days by default) |

- **What counts:** time accrues only while a Flowbase tab is visible and the user has typed or clicked within the idle cutoff (`IDLE_CUTOFF_MS`, 5 minutes, until business settings (FLOW-45) can hold it). An idle session ends when the cutoff passes; hiding the tab ends it at once, and time starts again with the next input. Only time inside Flowbase is measured.
- **What it's credited to:** the screen decides (`contextForPath`): leads, clients and events credit the record on screen; proposals (demo data until FLOW-122), venues and inventory credit only the activity type (proposal work, event planning, inventory, kitchen for the ingredient catalog); everything else is "general". BEO and task records and the delegating type are ready for when those modules exist.
- **Requests:** the browser sends at most one request a minute (`FLUSH_INTERVAL_MS`). An open session is resent with a later end under the same id and stays one row (`activity_sessions`, unique on user and session id); its end only ever grows. A 401 or 403 stops tracking for that page, so until sign-in (FLOW-36) nothing is recorded. Closing the tab can lose up to a minute that wasn't sent yet.
- **Who sees what** (`timeReportScope` in `worker/policy.ts`): Admin and Sales Manager see everyone's time and can narrow to one user; everyone else sees only their own. Events in the effort report also follow event visibility. Until the users table exists (FLOW-37) users show as ids.
- **Notice:** a "Time tracking is on" notice shows on first use (remembered per browser until sign-in exists) and on the Settings page.

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
| `collector-runs` (FLOW-102) | `Authorization: Bearer <token>` | `sourceRecordId` (`<runId>:<site>`) | `INGEST_TOKEN_LEADS` |
| `thumbtack` (FLOW-108) | the token as `Authorization: Bearer`, an `X-Flowbase-Token` header, or the path (`/api/ingest/thumbtack/<token>`) | Thumbtack lead id + event id | `INGEST_TOKEN_THUMBTACK` |
| `shopify` (FLOW-109) | Shopify HMAC (`X-Shopify-Hmac-Sha256`) | `X-Shopify-Webhook-Id` header | `SHOPIFY_WEBHOOK_SECRET` |

Each source's ticket registers the processor that turns a receipt into records (`ingestProcessors` in `worker/ingest/processors.ts`); a source without one keeps its receipts unprocessed (Shopify until FLOW-109).

- **Lead collector** (FLOW-102, [collector/README.md](collector/README.md)): each `leads` receipt is one lead (`shared/collector.ts`), created through `createLead` with channel `collector`; a changed version of the same lead updates it. Each `collector-runs` receipt is stored in `collector_runs` (site, start, finish, leads found, `ok | needs_login | blocked | error`) for FLOW-107. The ops workflow template is `ops-templates/collector.yml`.
- **Thumbtack** (FLOW-108, `worker/ingest/thumbtack.ts`): Thumbtack's self-serve lead webhooks (FLOW-115 sets them up). Thumbtack documents no signature, so the webhook carries a long random token, in the URL path when no custom header is possible (request logs show the path as `/api/ingest/thumbtack/[token]`). The mapper reads Thumbtack's documented lead fields (`negotiationID`, `customer.displayName`/contact details, `customer.location`, `category.name`, the `details` questions for date, guests and budget, `createTime`) into a `webhook` lead with source Thumbtack; anything missing is left for review. A status update for a stored lead updates it (same source lead id); the Thumbtack status stays in the raw payload. The tests use the hand-made sample in `tests/fixtures/thumbtack/`, which FLOW-115 replaces with a captured payload.

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
