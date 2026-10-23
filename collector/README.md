# Lead collector

Reads new and updated leads from the lead sites that have no official integration
(Bark, Perfect Venue, WeddingPro, Eventective) and posts them to Flowbase (FLOW-102,
ADR-13, ADR-14). It runs on a schedule in the private **ops repo**, never in Flowbase
CI, and never with credentials in this repo (ADR-21, ADR-26).

## How it works

- `src/main.ts` is the entry point. Node 24 runs the TypeScript directly:
  `node collector/src/main.ts` (scheduled) or `node collector/src/main.ts --any-time`
  (manual run, ignores the time window).
- It runs only at 8am, 10am, … 8pm New York time (`src/window.ts`). Outside those
  slots it exits before opening a browser.
- Each site is a module (`src/types.ts`, registered in `src/sites/index.ts`) with
  `checkLogin`, optional `logIn`, `listLeads` (new or updated since the last
  successful run) and `readLead(id)`, which returns the normalized lead fields
  (F-09-01). FLOW-103 to FLOW-106 add the four site modules.
- `src/run.ts` drives them with one Chromium and one page at a time, a 2–6 s pause
  between pages and a page limit per site (40). Leads left over at the limit wait
  for the next run. No new site starts after 4 minutes, inside the workflow's
  5-minute time box.
- **Read-only:** modules only open and read pages. They never buy, answer or dismiss
  a lead.
- **Stops, never bypasses:** a CAPTCHA, block (403/429, "unusual traffic") or
  two-factor prompt stops that site with `blocked` or `needs_login`
  (`src/blocked.ts`). The other sites still run.
- Leads post one per request to `POST /api/ingest/leads` with the collector token.
  Each version of a lead has its own record id (site, lead id and a hash of its
  details), so unchanged leads are ignored and changed ones update the stored lead.
- After each site, a `CollectorRun` (start, finish, leads found, status
  `ok | needs_login | blocked | error`) posts to `POST /api/ingest/collector-runs`
  and is stored in `collector_runs` for FLOW-107.
- **Sessions:** each site's Playwright `storageState` and last successful run are
  saved in `.collector-state/<site>.state`, encrypted with AES-256-GCM under
  `COLLECTOR_STATE_KEY`; the workflow caches the folder between runs, so a site
  logs in again only when its session expires. A changed key just starts signed out.
- **Failures:** screenshots and HTML of a failed page go to `collector-artifacts/`,
  uploaded only when the run fails and kept 3 days, because they contain client
  details.

## Ops repo setup

Copy `ops-templates/collector.yml` to `.github/workflows/collector.yml` in the ops
repo and add these Actions secrets (names only here; values never enter Flowbase):

| Secret | What it is |
| --- | --- |
| `FLOWBASE_READ_TOKEN` | Fine-grained PAT with read-only access to `seethesy/Flowbase` contents |
| `FLOWBASE_URL` | The production Worker URL, e.g. `https://flowbase.<account>.workers.dev` |
| `INGEST_TOKEN_LEADS` | Same value as the Worker secret `INGEST_TOKEN_LEADS` |
| `COLLECTOR_STATE_KEY` | A long random string that encrypts saved sessions |
| `COLLECTOR_<SITE>_USERNAME`, `COLLECTOR_<SITE>_PASSWORD` | Each site's login, for `BARK`, `PERFECT_VENUE`, `WEDDINGPRO`, `EVENTECTIVE` (added as each site module lands) |

## Tests

Flowbase CI tests the framework against sanitized fixture pages in
`collector/fixtures/<site>/` only (`tests/e2e/collector.spec.ts`,
`tests/collector.test.ts`); it never signs in to a live site or uses a secret.
