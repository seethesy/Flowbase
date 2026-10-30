import { Hono } from "hono";
import {
  fail,
  runDb,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
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
  // POST /api/ingest/<source>/<token> carries the token in the path, for senders
  // that can't set headers; only sources that accept it (Thumbtack) do.
  const handle = async (c: AppContext) => {
    const name = c.req.param("source") ?? "";
    const source = (options.sources ?? ingestSources).get(name);
    if (!source) return fail(c, 404, "NOT_FOUND", "API route not found.");
    const tooLarge = () =>
      fail(c, 413, "PAYLOAD_TOO_LARGE", "The payload is too large.");
    if (Number(c.req.header("Content-Length") ?? 0) > INGEST_MAX_BYTES)
      return tooLarge();
    const credentials = {
      body: "",
      rawBody: new Uint8Array(),
      headers: c.req.raw.headers,
      pathToken: c.req.param("token"),
    };
    if (source.authenticateBeforeBody && !(await source.authenticate(credentials, c.env ?? {})))
      return fail(c, 401, "UNAUTHENTICATED", "Invalid credentials.");
    const reader = c.req.raw.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > INGEST_MAX_BYTES) {
            await reader.cancel();
            return tooLarge();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const rawBody = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      rawBody.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const request = {
      ...credentials,
      body: new TextDecoder().decode(rawBody),
      rawBody,
    };
    if (!source.authenticateBeforeBody && !(await source.authenticate(request, c.env ?? {})))
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
  };
  ingest.post("/:source", handle);
  ingest.post("/:source/:token", handle);
  return ingest;
}
