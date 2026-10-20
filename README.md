# Flowbase v0.1

A small, fictional Clients and inventory management demo for a catering team of 15–20 employees. Forest & Sage branding, a responsive sidebar, and browser-local interactions. **This is an interactive frontend prototype. All records are fictional. Changes reset on refresh.**

## Setup

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run build
npm run dev:worker
```

The Worker serves the built SPA and `/api/*` at `http://localhost:8787`. `GET /api/health` returns `{ ok: true }`. For frontend hot reload, run `npm run dev` in another terminal; Vite proxies `/api` to the local Worker. Rebuild to update the SPA served by Wrangler. Hash routing supports direct record URLs and browser back/forward without server rewrites. Fonts are bundled locally.

No environment variables or credentials are needed for this demo. `.env.example` documents this baseline. Keep later local Worker secrets in ignored `.dev.vars`, and Vite variables in ignored `.env.local`. Never put secrets in `VITE_*`, which are shipped to the browser.

## Explore

- **Dashboard:** date-range sample datasets, KPI navigation, activity links, proposal status chart, stock alerts, and upcoming events.
- **Clients:** client/contact search, status and owner filters, sorting, pagination, create/edit forms, and client details with Overview, Contacts, Proposals, Events, Notes, and Files tabs. Archiving requires confirmation.
- **Proposals:** pipeline/table toggle, shared filters, numeric sorting, date filtering, pagination, drag-and-drop cards, and detail/edit drawers. The status selector is the keyboard-accessible alternative to dragging. Lost requires confirmation and a reason. Signed is final; Draft cannot jump straight to Signed. Lost may reopen as Draft.
- **Inventory:** SKU/name search, category/status filters, numeric quantity sorting, pagination, item forms, detailed stock/history/purchasing/usage/notes/files tabs, and simulated receipts/adjustments. Available = on hand − reserved; <=0 means Out of Stock; <=reorder point means Low Stock.
- Global search finds clients, proposal IDs/names, and inventory; notifications link to sample records. Purchasing, Events, Reports, Settings, and Help are labeled placeholders. Employee profile is fictional.

Seeded data: 35 clients, 45 contacts, 40 proposals, 50 items, 15 vendors, 12 purchase orders, 10 events, 8 employee profiles, activity and attachment metadata. Dashboard date ranges intentionally select different mock subsets rather than querying a backend.

## Architecture

React + strict TypeScript + Vite; Tailwind CSS; Radix/shadcn-style components; Lucide; React Router; TanStack Table; Recharts; dnd-kit. Shared components live in `src/components`, feature screens in `src/features`, and typed fixtures in `src/data/mock`.

A Hono Worker in `worker/` handles the API, and one `wrangler.jsonc` serves `dist/` as static assets on the same origin. App and API infer record types from Zod schemas in `shared/records.ts`. The build typechecks both targets before bundling. The async `RecordService<T>` adapter loads fixtures from `/api/demo/*`, validates writes through the API, and keeps changes in browser memory until refresh. Demo endpoints validate and echo writes; they do not persist records. Context publishes loaded snapshots for rendering; screens await mutations before reporting success. Database access is deferred to FLOW-24. Binding decisions, principles, and terms are copied from FLOW-1 in [docs/architecture.md](docs/architecture.md).

## CI and testing

GitHub Actions (`.github/workflows/ci.yml`) runs lint, strict type checking, Vitest/React Testing Library, a production build, and Playwright Chromium workflows at desktop and mobile widths. Failures retain browser artifacts. Tests cover navigation, searching/filtering, tabs and notes, stage transitions and loss reasons, stock labels, item navigation, form validation/save/close, mobile navigation, and keyboard focus restoration. Explicit focus rings, skip link, dialog focus trapping, accessible field labels, semantic badges, and reduced-motion handling are included.

The implementation session does **not** execute unit or browser tests locally, as requested. CI is the execution authority. Available commands:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

## Demo limitations

No real authentication, database, external API integrations, uploads, email delivery, signatures, PDF generation, or production inventory transactions. Attachments are filename/size metadata only. Purchase orders are read-only sample records. Simulated operations update only React memory. No database, authentication, or R2 integration is configured. The deployable unit is the Worker and its static SPA assets. No secrets or real client data are stored in the repository. This prototype targets WCAG 2.2 AA, but does not claim an independent accessibility audit.
