import type { Bindings } from "../bindings";

// Machine ingestion (FLOW-28): how each outside system proves who it is and names
// its records. Secrets are Worker secrets; a comma-separated value accepts several,
// so a secret rotates by adding the new one, switching the sender, then removing the
// old one.
export const INGEST_MAX_BYTES = 256 * 1024;

export type IngestRequest = { body: string; headers: Headers };
export type IngestSource = {
  authenticate: (
    request: IngestRequest,
    env: Partial<Bindings>,
  ) => Promise<boolean>;
  // The sender's own id for the record; undefined when it is missing.
  recordId: (request: IngestRequest, json: unknown) => string | undefined;
};

const encode = (value: string) => new TextEncoder().encode(value);
const secretsOf = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);

// Compares fixed-length digests so the comparison time doesn't depend on the token.
async function sameSecret(given: string, expected: string) {
  const [a, b] = await Promise.all(
    [given, expected].map(
      async (value) =>
        new Uint8Array(await crypto.subtle.digest("SHA-256", encode(value))),
    ),
  );
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a[index] ^ b[index];
  return difference === 0;
}

export const bearerToken =
  (secret: (env: Partial<Bindings>) => string | undefined) =>
  async ({ headers }: IngestRequest, env: Partial<Bindings>) => {
    const token = /^Bearer (\S+)$/.exec(headers.get("Authorization") ?? "")?.[1];
    if (!token) return false;
    let accepted = false;
    for (const expected of secretsOf(secret(env)))
      accepted = (await sameSecret(token, expected)) || accepted;
    return accepted;
  };

const fromBase64 = (value: string) => {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
};

// Shopify signs the raw body: base64(HMAC-SHA256(secret, body)).
export const shopifyHmac =
  (secret: (env: Partial<Bindings>) => string | undefined) =>
  async ({ headers, body }: IngestRequest, env: Partial<Bindings>) => {
    const signature = fromBase64(headers.get("X-Shopify-Hmac-Sha256") ?? "");
    if (!signature?.length) return false;
    for (const expected of secretsOf(secret(env))) {
      const key = await crypto.subtle.importKey(
        "raw",
        encode(expected),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      if (await crypto.subtle.verify("HMAC", key, signature, encode(body)))
        return true;
    }
    return false;
  };

const stringField = (json: unknown, field: string) => {
  if (typeof json !== "object" || json === null) return undefined;
  const value = (json as Record<string, unknown>)[field];
  return typeof value === "string" && value ? value : undefined;
};

// Thumbtack (FLOW-108) adds its own entry once its payload and auth are known.
export const ingestSources = new Map<string, IngestSource>([
  // Lead collector (FLOW-102): one lead per request, named by its site's lead id.
  [
    "leads",
    {
      authenticate: bearerToken((env) => env.INGEST_TOKEN_LEADS),
      recordId: (_request, json) => stringField(json, "sourceRecordId"),
    },
  ],
  // Shopify webhooks (FLOW-109): redeliveries repeat the webhook id.
  [
    "shopify",
    {
      authenticate: shopifyHmac((env) => env.SHOPIFY_WEBHOOK_SECRET),
      recordId: ({ headers }) =>
        headers.get("X-Shopify-Webhook-Id") ?? undefined,
    },
  ],
]);
