// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { INGEST_MAX_BYTES } from "../../worker/ingest/sources";

const withDb = vi.fn<RunWithDb>();
const app = createApp({ withDb: withDb as unknown as RunWithDb });
const env = {
  ASSETS: { fetch },
  // Two accepted values: a token mid-rotation.
  INGEST_TOKEN_LEADS: "old-lead-token, new-lead-token",
};
const lead = JSON.stringify({ sourceRecordId: "bark-123", name: "Jo" });
const postLead = (body: string, headers: Record<string, string> = {}) =>
  app.request(
    "/api/ingest/leads",
    { method: "POST", body, headers },
    env,
  );
const inquiry = JSON.parse(
  readFileSync("tests/fixtures/website/inquiry.json", "utf8"),
);
const postWebsite = (body: unknown, headers: Record<string, string> = {}) =>
  app.request(
    "/api/ingest/website",
    { method: "POST", body: JSON.stringify(body), headers },
    env,
  );

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
it("does not trust a misleading short Content-Length", async () => {
  const response = await postLead("x".repeat(INGEST_MAX_BYTES + 1), {
    Authorization: "Bearer new-lead-token", "Content-Length": "1",
  });
  expect(response.status).toBe(413);
  expect(withDb).not.toHaveBeenCalled();
});
it("cancels an oversized stream without reading the remaining chunks", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(pulls === 1 ? INGEST_MAX_BYTES : 1));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request("http://localhost/api/ingest/leads", {
    method: "POST", body, duplex: "half",
    headers: { Authorization: "Bearer new-lead-token" },
  } as RequestInit);
  const response = await app.fetch(request, env as never);
  expect(response.status).toBe(413);
  expect(pulls).toBe(2);
  expect(cancelled).toBe(true);
  expect(withDb).not.toHaveBeenCalled();
});
it("rejects an invalid bearer before reading its stream", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; controller.enqueue(new Uint8Array([123])); },
  }, { highWaterMark: 0 });
  const request = new Request("http://localhost/api/ingest/leads", {
    method: "POST", body, duplex: "half",
  } as RequestInit);
  const response = await app.fetch(request, env as never);
  expect(response.status).toBe(401);
  expect(pulls).toBe(0);
  expect(withDb).not.toHaveBeenCalled();
});
it("accepts a body exactly at the byte limit", async () => {
  const prefix = '{"sourceRecordId":"edge","note":"';
  const body = prefix + "x".repeat(INGEST_MAX_BYTES - prefix.length - 2) + '"}';
  const response = await postLead(body, { Authorization: "Bearer new-lead-token" });
  expect(response.status).toBe(202);
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
it("no longer accepts Shopify webhooks (FLOW-109 A1)", async () => {
  const response = await app.request(
    "/api/ingest/shopify",
    { method: "POST", body: "{}" },
    env,
  );
  expect(response.status).toBe(404);
});
it("stores a website inquiry without credentials (FLOW-109)", async () => {
  const response = await postWebsite(inquiry);
  expect(response.status).toBe(202);
  expect(withDb).toHaveBeenCalledTimes(1);
});
it("drops a submission that fills the honeypot without storing it", async () => {
  const spam = JSON.parse(readFileSync("tests/fixtures/website/spam.json", "utf8"));
  const response = await postWebsite(spam);
  expect(response.status).toBe(202);
  expect(withDb).not.toHaveBeenCalled();
});
it.each([
  ["no name", { ...inquiry, name: "" }],
  ["no way to reach them", { ...inquiry, email: "", phone: "" }],
  ["a bad email", { ...inquiry, email: "not-an-email" }],
  ["an impossible date", { ...inquiry, eventDate: "2027-02-31" }],
  ["a negative guest count", { ...inquiry, guestCount: -1 }],
  ["no submission id", { ...inquiry, submissionId: undefined }],
])("refuses a website inquiry with %s and stores nothing", async (_label, body) => {
  const response = await postWebsite(body);
  expect(response.status).toBe(400);
  expect(withDb).not.toHaveBeenCalled();
});
it("answers 429 and stores nothing when the rate limit is reached", async () => {
  withDb.mockReset().mockResolvedValue(undefined);
  const response = await postWebsite(inquiry);
  expect(response.status).toBe(429);
  expect((await response.json()).error.code).toBe("RATE_LIMITED");
});
