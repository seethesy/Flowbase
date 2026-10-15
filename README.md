# Flowbase v0.1

A small, fictional CRM and inventory management demo for a catering team of 15–20 employees. Forest & Sage branding, a responsive sidebar, and browser-local interactions. **This is an interactive frontend prototype. All records are fictional. Changes reset on refresh.**

## Setup

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Build with `npm run build`. Serve `dist/` with any static host. Hash routing supports direct record URLs and browser back/forward navigation without server rewrite rules. Fonts are bundled locally.

## Explore

- **Dashboard:** date-range sample datasets, KPI navigation, activity links, contract status chart, stock alerts, and upcoming events.
- **CRM:** customer/contact search, status and owner filters, sorting, pagination, create/edit forms, and customer details with Overview, Contacts, Contracts, Events, Notes, and Files tabs. Archiving requires confirmation.
- **Contracts:** pipeline/table toggle, shared filters, numeric sorting, date filtering, pagination, drag-and-drop cards, and detail/edit drawers. The status selector is the keyboard-accessible alternative to dragging. Lost requires confirmation and a reason. Signed is final; Draft cannot jump straight to Signed. Lost may reopen as Draft.
- **Inventory:** SKU/name search, category/status filters, numeric quantity sorting, pagination, item forms, detailed stock/history/purchasing/usage/notes/files tabs, and simulated receipts/adjustments. Available = on hand − reserved; <=0 means Out of Stock; <=reorder point means Low Stock.
- Global search finds customers, contract IDs/names, and inventory; notifications link to sample records. Purchasing, Events, Reports, Settings, and Help are labeled placeholders. Employee profile is fictional.

Seeded data: 35 customers, 45 contacts, 40 contracts, 50 items, 15 suppliers, 12 purchase orders, 10 events, 8 employee profiles, activity and attachment metadata. Dashboard date ranges intentionally select different mock subsets rather than querying a backend.

## Architecture

React + strict TypeScript + Vite; Tailwind CSS; shadcn-style Button built with Radix Slot/CVA and Radix Dialog primitives; Lucide; React Router; TanStack Table; Recharts; @dnd-kit. `components.json` holds the shadcn convention settings. Shared components live in `src/components`; feature screens in `src/features`; typed fixtures in `src/data/mock`; context owns in-memory records. Typed `RecordService<T>` interfaces and `createRecordService` in `src/services` isolate record access from components for future API adapters. No backend is implemented.

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

No real authentication, database, API integrations, uploads, email delivery, signatures, PDF generation, or production inventory transactions. Attachments are filename/size metadata only. Purchase orders are read-only sample records. Simulated operations update only React memory. No Supabase, Cloudflare Workers, or R2 integration. The deployable output is static assets only. No secrets or real customer data are stored in the repository. This prototype targets WCAG 2.2 AA, but does not claim an independent accessibility audit.
