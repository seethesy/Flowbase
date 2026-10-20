# Flowbase architecture

Source: [FLOW-1](https://sybertechlabs.atlassian.net/browse/FLOW-1).

## Architecture decisions (ADRs) — binding for every FLOW issue

| ADR | Decision |
| --- | --- |
| ADR-01 | Frontend: the existing Vite + React 19 + strict TypeScript SPA. Keep current libs (Tailwind 4, Radix/shadcn-style, React Router, TanStack Table, Recharts, dnd-kit); add TanStack Query, React Hook Form, Zod. |
| ADR-02 | Hosting: one Cloudflare Worker (Workers Free) serves the SPA as static assets and the API on the same origin. Deploys run in **Cloudflare Workers Builds** from `main` (Free: 3,000 build minutes/month). |
| ADR-03 | API: Hono on the Worker; Zod schemas/types shared between app and API. |
| ADR-04 | Database: Supabase Free Postgres (prod + dev projects). Drizzle ORM + drizzle-kit is the only migration path. RLS on for every table with no browser-facing policies; the browser never queries the database directly. |
| ADR-05 | DB connection: Worker → Hyperdrive (Free, 100k queries/day) with caching disabled. Use Supabase's direct connection if reachable (IPv6), else the session pooler (IPv4). Never buy the IPv4 add-on. |
| ADR-06 | Sign-in: Supabase Auth, Google only, invite-only allowlist; the Worker verifies the Supabase JWT on every API request. |
| ADR-07 | Authorization: one TypeScript policy module (role, employment type, record assignment, field visibility), enforced in the API and tested per role. Admin can do everything. |
| ADR-08 | Files: R2 (Free 10 GB) via short-lived presigned uploads; the browser resizes images before upload. |
| ADR-09 | CPU budget: Workers Free = 10 ms CPU per request and per cron run. Heavy work runs in the browser (proposal .docx parsing, image resizing, CSV/XLSX parsing, printable documents). API requests validate and write; cron runs process small batches. |
| ADR-10 | Scheduled jobs: Workers Cron Triggers (max 5 per account) + a `jobs` outbox table. |
| ADR-11 | Realtime: Supabase Realtime broadcast "changed" pings (no data); clients refetch via the API; 30 s polling fallback. |
| ADR-12 | Outbound email: a free provider (decided in the notifications ticket). |
| ADR-13 | Lead intake: official channels where they exist (Thumbtack lead webhooks, Shopify webhooks); Playwright collector for Bark, Perfect Venue, WeddingPro and Eventective. No email intake. No AI. |
| ADR-14 | Lead collector: Node + Playwright code in `collector/` (Flowbase repo). It runs on a schedule in the **ops repo** (every 2 h, 8am–8pm ET, ≤5 min per run): the ops workflow checks out Flowbase `main` read-only and posts to the Worker ingestion endpoint with a service token. Read-only; stops and alerts on 2FA/CAPTCHA/blocks and never tries to bypass them. |
| ADR-15 | SMS: provider interface with a stub provider (dev outbox) now; Twilio adapter is deferred (it costs money). |
| ADR-16 | Proposal intake: the Google Docs proposal exported as .docx, parsed in the browser + template rules + manual review/mapping. Optional PDF stored for reference. No AI. |
| ADR-17 | Printable documents (BEO, client recipe book, order list) are generated in the browser. |
| ADR-18 | Offline: vite-plugin-pwa (Workbox) + IndexedDB (Dexie) read-only BEO cache; works in a normal Safari tab. |
| ADR-19 | Calendar: FullCalendar standard (MIT) views only + ICS subscription feed. |
| ADR-20 | Venue layouts: uploaded images + notes per layout area, with optional Excalidraw annotation (lazy-loaded). |
| ADR-21 | CI: the existing GitHub Actions workflow + Worker tests + DB integration tests on a Postgres service container. Flowbase CI never uses secrets. The account's 2,000 free Actions minutes/month are shared by Flowbase CI and the ops repo's schedules. |
| ADR-22 | Backups: nightly `pg_dump` of production to R2, run from the ops repo, 30-day retention, restore tested before go-live. |
| ADR-23 | Observability: Sentry free plan + Cloudflare Workers logs + free-tier usage guardrails. |
| ADR-24 | Search: Postgres full-text search + pg_trgm. |
| ADR-25 | Rich text: TipTap free core only (no Pro extensions). |
| ADR-26 | Secrets isolation: no production or lead-site secrets in the Flowbase repo or its Actions. Production secrets live in Cloudflare (Worker secrets and Workers Builds variables). Scheduled jobs that need secrets (backups, collector) run in a separate private **ops repo** that only the developer controls. Flowbase holds the scripts and workflow templates (`ops-templates/`), which the developer copies into the ops repo. Agents never touch the ops repo. |

**Cost rule:** everything runs on free tiers ($0/month). Anything that would cost money must be raised to the developer as a question before it's added.

## Design principles

1. The Event is the spine: Lead → Client Communication → Proposal/Menu Curation → Proposal Revisions → Finalize Proposal → Contract → Payments → BEO, with the pull list, production timeline and truck log attached to one Event.
2. One inventory core: rentals, decor, consumables (ingredients, bar, supplies) and services share one item model, one stock ledger and one reservation/allocation model; they differ by `kind` and category.
3. One task engine: communal, delegated, kitchen, production, truck-loading and miscellaneous tasks are all `Task` records with a `type`.
4. One approval engine: rental Master changes, finalized proposals, order lists and BEO approval/re-approval.
5. Client-facing views are projections of internal records (field-visibility rules), not copies.
6. Uploaded proposal versions and signed contracts are immutable. Approved BEOs stay editable with every change logged.
7. Automations suggest; humans confirm. Automations are idempotent; "Regenerate" shows a diff and never duplicates.
8. Money in integer cents; times stored in UTC, shown in America/New_York.
9. Card data never touches Flowbase (at most "card on file: yes/no" + last 4).
10. Stay on free tiers: heavy work in the browser; every request within 10 ms CPU.

## Terms

Use the business's terms: **Client** (prototype: Customer), **Proposal** (prototype: Contract pipeline), **Vendor** (prototype: Supplier). Roles: **Admin**, **Technical**, Sales Manager, Salesperson, Kitchen Lead, Kitchen Staff, Staff; full-time/part-time is a separate field. "FT+" = any full-time user plus Admin, Technical and Sales Manager.
