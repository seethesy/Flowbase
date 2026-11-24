# Flowbase v0.1

Flowbase is a catering operations workspace for a team of 15–20 employees. Clients, venues, events, leads, inventory, search, time tracking, attachments, jobs and ingestion use real Worker APIs and Postgres (with R2 for file content). Google-only, invite-only sign-in protects the workspace. Role home dashboards use permitted live records. Real proposals live on each event's hub and in the sales tracker (see Proposals below).

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

- **Dashboard:** role-specific home widgets link to the real task, lead, sales, production, kitchen and operations lists.
- **Clients, Venues, Events:** real records from the API (see [Core records](docs/features/core-records.md#core-records)), with search, show-archived filters, create/edit forms, archive/restore and detail pages. They require an invited Google account.
- **Proposals:** pipeline/table toggle, shared filters, numeric sorting, date filtering, pagination, drag-and-drop cards, and detail/edit drawers. The status selector is the keyboard-accessible alternative to dragging. Lost requires confirmation and a reason. Signed is final; Draft cannot jump straight to Signed. Lost may reopen as Draft.
- **Inventory:** real items from the API (see [Inventory](docs/features/inventory.md#inventory)): rentals, decor, ingredients, bar stock, supplies and services, in three lists (Master inventory, Bar Inventory and Kitchen Ingredients), with per-location stock, the stock ledger (movement history, transfers, counts, receipts, adjustments and corrections) on the item page, count mode, the Order tab, cost history, and Admin-managed locations.
- **Vendors:** the vendor and distributor directory (see [Vendors](docs/features/vendors.md#vendors)): distributors, rental vendors and event partners, how to order from each, and the items they supply.
- **Recipes:** the recipe book (see [Recipe book](docs/features/recipe-book.md#recipe-book)): dishes with ingredient lines, method, yield, cost, allergens and dietary tags, and a scaling tool.
- **Photos (FLOW-271, FLOW-298):** Marketing › Photos is a gallery of every photo (Documents of type Photo, and photos attached to events, BEO setup areas and inventory items; the same files, never copies) with Event, Tag, Uploaded by and "Approved for marketing only" filters, multi-select (approve, download as .zip, delete with Undo) and a lightbox (arrow keys move, Esc closes). Kitchen › Photos and Inventory › Photos hold each area's own photos with a label and date, and confirm every delete. `GET /api/photos?area=marketing|kitchen|inventory`, `PATCH /api/photos/<id>` (approval and tags need `marketing.write`; label and date need the gallery's write permission), `POST /api/photos/<id>/archive` and `/restore`. Uploads go through `/api/attachments`: a photo without a record is an unlinked document whose group names its gallery, and it follows that area's read and write permissions (Marketing photos, Recipes and Menus, Inventory). Photo tags are the Settings list "Photo tags". The grid shows thumbnails and the lightbox the display size, to keep R2 storage small.
- Global search (header, see [Global search](docs/features/global-search.md#global-search)) finds real clients, leads, events, venues, inventory items and vendors; demo proposals are no longer in it. The header bell shows the signed-in person's real notifications (see [Notifications](docs/features/notifications.md#notifications)). Purchasing and Help are labeled placeholders; Reports holds the time-tracking reports, and Admin and Sales Managers can open operational reports. Proposals still use demo client fixtures. The employee profile and header show the signed-in staff member. Admin manages invitations and access in Settings → Manage users.

Demo fixtures: 35 clients, 40 proposals, 50 items, 15 vendors, 10 events, 8 employee profiles, activity and attachment metadata. The separate development database seed is described in [Development](docs/development.md).

## Architecture

React + strict TypeScript + Vite; Tailwind CSS; Radix/shadcn-style components; Lucide; React Router; TanStack Table; Recharts; dnd-kit. Shared components live in `src/components`, feature screens in `src/features`, and typed fixtures in `src/data/mock`. `src/styles/globals.css` holds the tokens, base element styles and shared components; styles used by a single feature live next to it as `src/features/<feature>.css`, imported by its screens so they load after the global sheet (FLOW-193). Rich text (SOPs, setup and BEO notes) uses TipTap free core in `src/components/rich-text`: `RichTextEditor` stores TipTap JSON, and `RichTextView`/`renderRichText` render it to DOMPurify-sanitized HTML for screen and print. Headings, bold, italic, bulleted/numbered/checklist lists (nestable) and http(s)/mailto/tel links are supported; pasted Google Docs content keeps that formatting and drops everything else.

A Hono Worker in `worker/` handles the API, and one `wrangler.jsonc` serves `dist/` as static assets on the same origin. App and API infer record types from the Zod schemas in `shared/`; `shared/records.ts` describes only demo fixtures. The demo client and item schemas remain because Dashboard, Proposals and the development seed still consume those fixtures. Route screens load lazily; chart, editor, auth and observability dependencies have separate chunks. CI enforces a 500 kB JavaScript chunk budget. The build typechecks both targets before bundling. The async `RecordService<T>` adapter loads fixtures from `/api/demo/*`, validates writes through the API, and keeps changes in browser memory until refresh. Demo endpoints validate and echo writes; they do not persist records. Context publishes loaded snapshots for rendering; screens await mutations before reporting success. Database access lives in `worker/db/` (see [Database](docs/development.md#database)). Binding decisions, principles, and terms are copied from FLOW-1 in [docs/architecture.md](docs/architecture.md).


## Documentation map

- [Development, database and deployment](docs/development.md)
- [Core records](docs/features/core-records.md)
- [Calendar](docs/features/calendar.md)
- [Inventory](docs/features/inventory.md)
- [Vendors](docs/features/vendors.md)
- [Recipe book](docs/features/recipe-book.md)
- [Leads](docs/features/leads.md)
- [Global search](docs/features/global-search.md)
- [Time tracking](docs/features/time-tracking.md)
- [Staff directory](docs/features/staff-directory.md)
- [Business settings](docs/features/business-settings.md)
- [Data import](docs/features/data-import.md)
- [List export](docs/features/list-export.md)
- [Attachments](docs/features/attachments.md)
- [Printable documents](docs/features/printable-documents.md)
- [Tasks](docs/features/tasks.md)
- [Roles and permissions](docs/features/roles-and-permissions.md)
- [Approvals](docs/features/approvals.md)
- [Notifications](docs/features/notifications.md)
- [Background jobs](docs/features/background-jobs.md)
- [Machine ingestion](docs/features/machine-ingestion.md)
- [Closeout and returns](docs/features/closeout.md)
- [BEO print and offline reading (FLOW-149, FLOW-150)](docs/features/beo-print-and-offline-reading.md)
