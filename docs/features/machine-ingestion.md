## Machine ingestion

`POST /api/ingest/<source>` (FLOW-28) is how outside systems push data in. Each request must authenticate, be at most 256 KB, and name its record; otherwise nothing is stored (401, 413 or 400). The raw body is stored once per source + record id in `ingest_receipts` with an `ingest.process` job in the same transaction; a repeat answers `200` with `duplicate: true` and creates nothing.

| Source | Auth | Record id | Worker secret |
| --- | --- | --- | --- |
| `leads` (lead collector, FLOW-102) | `Authorization: Bearer <token>` | `sourceRecordId` in the JSON body | `INGEST_TOKEN_LEADS` |
| `collector-runs` (FLOW-102) | `Authorization: Bearer <token>` | `sourceRecordId` (`<runId>:<site>`) | `INGEST_TOKEN_LEADS` |
| `thumbtack` (FLOW-108) | the token as `Authorization: Bearer`, an `X-Flowbase-Token` header, or the path (`/api/ingest/thumbtack/<token>`) | Thumbtack lead id + event id | `INGEST_TOKEN_THUMBTACK` |
| `website` (FLOW-109) | none (public form); honeypot and rate limit instead | `submissionId` in the JSON body | none |

Each source's ticket registers the processor that turns a receipt into records (`ingestProcessors` in `worker/ingest/processors.ts`); a source without one keeps its receipts unprocessed.

- **Lead collector** (FLOW-102, [collector/README.md](../../collector/README.md)): each `leads` receipt is one lead (`shared/collector.ts`), created through `createLead` with channel `collector`; a changed version of the same lead updates it. Each `collector-runs` receipt is stored in `collector_runs` (site, start, finish, leads found, `ok | needs_login | blocked | error`) for FLOW-107. The ops workflow template is `ops-templates/collector.yml`.
- **Website inquiry form** (FLOW-109, `public/inquiry.html`, `shared/website-inquiry.ts`): a small form Flowbase hosts at `/inquiry.html`, embedded on the Shopify site with `<iframe src="https://<flowbase host>/inquiry.html" title="Inquiry" style="width:100%;height:760px;border:0"></iframe>`. It posts one JSON submission to `/api/ingest/website`, which needs no credentials, so the endpoint screens it instead: a payload that fails `websiteInquirySchema` (a name, and an email or phone) answers 400; a filled `company` honeypot field answers 202 and stores nothing; more than 5 submissions per client (a hash of the IP) or 100 in total per 10 minutes answers 429 and stores nothing. The form makes one `submissionId` per submission, so a retry or redelivery names the same receipt (`duplicate: true`) and the lead (source lead id) and creates nothing new. The processor creates a `webhook` lead with source Website. Shopify orders and customer webhooks are not used. The tests use synthetic submissions in `tests/fixtures/website/`; FLOW-115 may replace them with sanitized real ones.
- **Thumbtack** (FLOW-108, `worker/ingest/thumbtack.ts`): Thumbtack's self-serve lead webhooks (FLOW-115 sets them up). Thumbtack documents no signature, so the webhook carries a long random token, in the URL path when no custom header is possible (request logs show the path as `/api/ingest/thumbtack/[token]`). The mapper reads Thumbtack's documented lead fields (`negotiationID`, `customer.displayName`/contact details, `customer.location`, `category.name`, the `details` questions for date, guests and budget, `createTime`) into a `webhook` lead with source Thumbtack; anything missing is left for review. A status update for a stored lead updates it (same source lead id); the Thumbtack status stays in the raw payload. The tests use the hand-made sample in `tests/fixtures/thumbtack/`, which FLOW-115 replaces with a captured payload.

**Rotating a secret:** set the secret to `old,new` (`npx wrangler secret put INGEST_TOKEN_LEADS --env production`), switch the sender to the new value, then set it to `new` alone.

**Admin API:** `GET /api/admin/ingest-receipts?status=failed&source=leads` lists receipts with their job status; `POST /api/admin/ingest-receipts/<id>/replay` queues a new processing job for a receipt whose job failed.

**Sign-in.** Admin routes check permissions through the shared role/action matrix in `shared/policy.ts` (FLOW-38). The Worker verifies the Supabase JWT and loads the caller from the allowlist on every staff API request. User management is Admin only.

