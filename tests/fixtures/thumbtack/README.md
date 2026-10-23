# Thumbtack webhook fixtures (FLOW-108)

Hand-made from Thumbtack's documented lead (negotiation) fields, with made-up
values. FLOW-115 replaces `lead.json` with a sanitized payload captured from the
real webhook; if its shape differs, adjust `worker/ingest/thumbtack.ts` and these
tests together.
