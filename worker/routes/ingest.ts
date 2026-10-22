import { Hono } from "hono";
import { fail, runDb, type AppEnv, type RunWithDb } from "../hono";
import { storeReceipt } from "../ingest/receipts";
import {
  INGEST_MAX_BYTES,
  ingestSources,
  type IngestSource,
} from "../ingest/sources";

// POST /api/ingest/<source> (FLOW-28). Nothing is stored unless the sender
// authenticates, the payload fits the size limit, and it names its record.
export function ingestRoutes(options: {
  withDb?: RunWithDb;
  sources?: Map<string, IngestSource>;
}) {
  const ingest = new Hono<AppEnv>();
  ingest.post("/:source", async (c) => {
    const name = c.req.param("source");
    const source = (options.sources ?? ingestSources).get(name);
    if (!source) return fail(c, 404, "NOT_FOUND", "API route not found.");
    const tooLarge = () =>
      fail(c, 413, "PAYLOAD_TOO_LARGE", "The payload is too large.");
    if (Number(c.req.header("Content-Length") ?? 0) > INGEST_MAX_BYTES)
      return tooLarge();
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > INGEST_MAX_BYTES) return tooLarge();
    const request = {
      body: new TextDecoder().decode(bytes),
      headers: c.req.raw.headers,
    };
    if (!(await source.authenticate(request, c.env ?? {})))
      return fail(c, 401, "UNAUTHENTICATED", "Invalid credentials.");
    let json: unknown;
    try {
      json = JSON.parse(request.body);
    } catch {
      return fail(c, 400, "INVALID_REQUEST", "Invalid request.");
    }
    const sourceRecordId = source.recordId(request, json);
    if (!sourceRecordId || sourceRecordId.length > 200)
      return fail(c, 400, "INVALID_REQUEST", "The record id is missing.");
    const stored = await runDb(options.withDb, c.env, (db) =>
      storeReceipt(db, { source: name, sourceRecordId, body: request.body }),
    );
    return c.json(stored, stored.duplicate ? 200 : 202);
  });
  return ingest;
}
