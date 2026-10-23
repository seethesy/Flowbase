// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import {
  parseEventDate,
  thumbtackLead,
  thumbtackRecordId,
} from "../../worker/ingest/thumbtack";

// Thumbtack lead webhooks (FLOW-108): mapping, record ids and auth, without a database.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/thumbtack/${name}.json`, "utf8"));
const token = "tt-token-0123456789abcdef";
const env = { ASSETS: { fetch }, INGEST_TOKEN_THUMBTACK: token };

it("maps the sample payload to a Thumbtack webhook lead", () => {
  expect(thumbtackLead(fixture("lead"))).toMatchObject({
    channel: "webhook",
    source: "Thumbtack",
    sourceLeadId: "500000000000000001",
    name: "Sample Customer",
    email: "",
    phone: "(202) 555-0100",
    eventDate: "2026-11-14",
    guestCount: 80,
    location: "Washington, DC 20001",
    eventType: "Wedding Catering",
    budgetCents: 1_200_000,
    receivedAt: "2026-10-20T14:05:00.000Z",
  });
  expect(thumbtackLead(fixture("lead"))?.message).toContain(
    "Project scope: Plated dinner and cocktail hour",
  );
});

it("names each delivery by lead and event, and finds the lead in any envelope", () => {
  expect(thumbtackRecordId(fixture("lead"))).toBe("500000000000000001:evt-0001");
  expect(thumbtackRecordId(fixture("status-update"))).toBe("500000000000000001:evt-0002");
  const bare = { negotiationID: "42", status: "active" };
  expect(thumbtackRecordId(bare)).toBe("42:active");
  expect(thumbtackLead({ negotiation: bare })?.sourceLeadId).toBe("42");
  expect(thumbtackRecordId({ hello: "world" })).toBeUndefined();
  expect(thumbtackLead([])).toBeUndefined();
});

it("leaves out what it can't read, for review", () => {
  const lead = thumbtackLead({
    negotiationID: "7",
    customer: { email: "not-an-email" },
    details: [{ question: "Event date", answer: "Sometime in spring" }],
  });
  expect(lead).toMatchObject({ email: "", eventDate: null, guestCount: null, budgetCents: null });
  expect(parseEventDate("11/14/2026")).toBe("2026-11-14");
  expect(parseEventDate("2026-02-31")).toBeNull();
  expect(parseEventDate("Nov 14 2026")).toBe("2026-11-14");
});

const post = (path: string, headers: Record<string, string> = {}) => {
  const mock = vi.fn<RunWithDb>(async () => ({ receiptId: "r", duplicate: false }) as never);
  const app = createApp({ withDb: mock as unknown as RunWithDb });
  return {
    mock,
    response: app.request(
      path,
      { method: "POST", body: JSON.stringify(fixture("lead")), headers },
      env,
    ),
  };
};

it("answers 401 without the token and stores nothing (AC3)", async () => {
  for (const attempt of [
    post("/api/ingest/thumbtack"),
    post("/api/ingest/thumbtack/wrong-token"),
    post("/api/ingest/thumbtack", { "X-Flowbase-Token": "wrong-token" }),
  ]) {
    expect((await attempt.response).status).toBe(401);
    expect(attempt.mock).not.toHaveBeenCalled();
  }
});

it("accepts the token in the path, a header or as a bearer token", async () => {
  for (const attempt of [
    post(`/api/ingest/thumbtack/${token}`),
    post("/api/ingest/thumbtack", { "X-Flowbase-Token": token }),
    post("/api/ingest/thumbtack", { Authorization: `Bearer ${token}` }),
  ]) {
    expect((await attempt.response).status).toBe(202);
    expect(attempt.mock).toHaveBeenCalledOnce();
  }
});

it("never logs a path token, and other sources refuse one", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  await post(`/api/ingest/thumbtack/${token}`).response;
  const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
  log.mockRestore();
  expect(logged).toContain("/api/ingest/thumbtack/[token]");
  expect(logged).not.toContain(token);
  const leads = createApp({ withDb: vi.fn() as unknown as RunWithDb }).request(
    "/api/ingest/leads/anything",
    { method: "POST", body: "{}" },
    { ...env, INGEST_TOKEN_LEADS: "anything" },
  );
  expect((await leads).status).toBe(401);
});
