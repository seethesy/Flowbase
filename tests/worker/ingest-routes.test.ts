// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { INGEST_MAX_BYTES } from "../../worker/ingest/sources";

const withDb = vi.fn<RunWithDb>();
const app = createApp({ withDb });
const env = {
  ASSETS: { fetch },
  // Two accepted values: a token mid-rotation.
  INGEST_TOKEN_LEADS: "old-lead-token, new-lead-token",
  SHOPIFY_WEBHOOK_SECRET: "old-shop-secret,new-shop-secret",
};
const lead = JSON.stringify({ sourceRecordId: "bark-123", name: "Jo" });
const postLead = (body: string, headers: Record<string, string> = {}) =>
  app.request(
    "/api/ingest/leads",
    { method: "POST", body, headers },
    env,
  );
const sign = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return btoa(String.fromCharCode(...signature));
};
const postShopify = (body: string, headers: Record<string, string>) =>
  app.request("/api/ingest/shopify", { method: "POST", body, headers }, env);

beforeEach(() => {
  withDb.mockReset().mockResolvedValue({ receiptId: "r-1", duplicate: false });
});

it.each([
  ["no token", {}],
  ["a wrong token", { Authorization: "Bearer guessed" }],
  ["a non-bearer scheme", { Authorization: "Basic bmV3LWxlYWQtdG9rZW4=" }],
])("answers 401 and stores nothing with %s", async (_label, headers) => {
  const response = await postLead(lead, headers);
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  expect(withDb).not.toHaveBeenCalled();
});
it("refuses every request when the source's secret isn't configured", async () => {
  const response = await app.request(
    "/api/ingest/leads",
    { method: "POST", body: lead, headers: { Authorization: "Bearer " } },
    { ASSETS: { fetch } },
  );
  expect(response.status).toBe(401);
  expect(withDb).not.toHaveBeenCalled();
});
it.each(["old-lead-token", "new-lead-token"])(
  "accepts the rotated token %s and queues the record",
  async (token) => {
    const response = await postLead(lead, { Authorization: `Bearer ${token}` });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      receiptId: "r-1",
      duplicate: false,
    });
    expect(withDb).toHaveBeenCalledTimes(1);
  },
);
it("answers 200 for a record it already holds", async () => {
  withDb.mockResolvedValue({ receiptId: "r-1", duplicate: true });
  const response = await postLead(lead, {
    Authorization: "Bearer new-lead-token",
  });
  expect(response.status).toBe(200);
  expect((await response.json()).duplicate).toBe(true);
});
it("rejects an oversized payload before storing it", async () => {
  const big = JSON.stringify({
    sourceRecordId: "bark-1",
    note: "x".repeat(INGEST_MAX_BYTES),
  });
  const response = await postLead(big, {
    Authorization: "Bearer new-lead-token",
  });
  expect(response.status).toBe(413);
  expect(withDb).not.toHaveBeenCalled();
});
it.each([
  ["malformed JSON", "{"],
  ["a missing record id", JSON.stringify({ name: "Jo" })],
  ["an over-long record id", JSON.stringify({ sourceRecordId: "x".repeat(201) })],
])("rejects %s with 400", async (_label, body) => {
  const response = await postLead(body, {
    Authorization: "Bearer new-lead-token",
  });
  expect(response.status).toBe(400);
  expect(withDb).not.toHaveBeenCalled();
});
it("answers 404 for an unknown source", async () => {
  const response = await app.request(
    "/api/ingest/unknown",
    { method: "POST", body: lead },
    env,
  );
  expect(response.status).toBe(404);
});
it("accepts a Shopify webhook signed with either rotated secret", async () => {
  const body = JSON.stringify({ id: 1 });
  for (const secret of ["old-shop-secret", "new-shop-secret"]) {
    const response = await postShopify(body, {
      "X-Shopify-Hmac-Sha256": await sign(secret, body),
      "X-Shopify-Webhook-Id": "wh-1",
    });
    expect(response.status).toBe(202);
  }
});
const badSignatures: [string, (body: string) => Promise<string>][] = [
  ["a wrong secret", (body) => sign("wrong", body)],
  ["a signature of another body", () => sign("new-shop-secret", "{}")],
  ["a non-base64 signature", async () => "%%%"],
  ["no signature", async () => ""],
];
it.each(badSignatures)("refuses a Shopify webhook with %s", async (_label, signature) => {
  const body = JSON.stringify({ id: 1 });
  const response = await postShopify(body, {
    "X-Shopify-Hmac-Sha256": await signature(body),
    "X-Shopify-Webhook-Id": "wh-1",
  });
  expect(response.status).toBe(401);
  expect(withDb).not.toHaveBeenCalled();
});
it("rejects a signed Shopify webhook without a webhook id", async () => {
  const body = JSON.stringify({ id: 1 });
  const response = await postShopify(body, {
    "X-Shopify-Hmac-Sha256": await sign("new-shop-secret", body),
  });
  expect(response.status).toBe(400);
});
