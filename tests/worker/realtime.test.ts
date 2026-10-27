// @vitest-environment node
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import { ApiError, type AppEnv } from "../../worker/hono";
import { announceChanges, publishChanged } from "../../worker/realtime";
import type { Bindings } from "../../worker/bindings";
import { CHANGED_EVENT, CHANGES_CHANNEL } from "../../shared/realtime";

// FLOW-206 (ADR-11): a committed write sends one data-free "changed" ping;
// reads, failed and rolled-back writes send none.
const env = {
  ASSETS: { fetch },
  SUPABASE_URL: "https://project.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_test",
} as Bindings;

it("broadcasts a ping that carries no record fields", async () => {
  const send = vi.fn(async () => new Response(null, { status: 202 }));
  await publishChanged(env, send as typeof fetch);
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://project.supabase.co/realtime/v1/api/broadcast");
  expect(new Headers(init.headers).get("apikey")).toBe("sb_secret_test");
  const body = JSON.parse(String(init.body));
  expect(body.messages).toHaveLength(1);
  const [message] = body.messages;
  expect(message.topic).toBe(CHANGES_CHANNEL);
  expect(message.event).toBe(CHANGED_EVENT);
  expect(Object.keys(message.payload)).toEqual(["at"]);
});

it("sends nothing when Supabase isn't configured and reports a refused broadcast", async () => {
  const send = vi.fn(async () => new Response(null, { status: 401 }));
  await publishChanged({ ASSETS: { fetch } }, send as typeof fetch);
  await publishChanged(undefined, send as typeof fetch);
  expect(send).not.toHaveBeenCalled();
  await expect(publishChanged(env, send as typeof fetch)).rejects.toThrow(
    "401",
  );
});

// A router shaped like the app's: the ping middleware, then handlers that
// commit, roll back (throw before responding) or only read.
function testApp(publish: (env: Bindings | undefined) => Promise<void>) {
  const app = new Hono<AppEnv>();
  app.onError((error, c) =>
    c.json(
      { error: { code: "X", message: error.message, requestId: "r" } },
      error instanceof ApiError ? error.status : 500,
    ),
  );
  app.use("/api/*", announceChanges(publish));
  app.get("/api/things", (c) => c.json([]));
  app.post("/api/things", (c) => c.json({ id: "1" }, 201));
  app.put("/api/things/1", () => {
    throw new ApiError(409, "CONFLICT", "Changed by someone else.");
  });
  app.post("/api/things/1/archive", () => {
    throw new Error("Transaction rolled back");
  });
  app.post("/api/demo/things", (c) => c.json({ ok: true }));
  return app;
}

it("pings after a committed write only", async () => {
  const publish = vi.fn(async () => {});
  const app = testApp(publish);
  expect((await app.request("/api/things")).status).toBe(200);
  expect(publish).not.toHaveBeenCalled();
  expect((await app.request("/api/things/1", { method: "PUT" })).status).toBe(
    409,
  );
  expect(
    (await app.request("/api/things/1/archive", { method: "POST" })).status,
  ).toBe(500);
  expect((await app.request("/api/demo/things", { method: "POST" })).status).toBe(
    200,
  );
  expect(publish).not.toHaveBeenCalled();
  expect((await app.request("/api/things", { method: "POST" })).status).toBe(
    201,
  );
  expect(publish).toHaveBeenCalledTimes(1);
});

it("never fails or delays the response when the ping fails", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = testApp(async () => {
    throw new Error("Realtime down");
  });
  const response = await app.request("/api/things", { method: "POST" });
  expect(response.status).toBe(201);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("realtime_ping_failed"),
  );
  error.mockRestore();
});

it("is wired into the app: a refused write sends no ping", async () => {
  const publish = vi.fn(async () => {});
  const app = createApp({
    publishChanged: publish,
    resolveActor: async () => ({
      userId: "36000000-0000-4000-8000-000000000003",
      role: "admin",
      employmentType: "full_time",
    }),
  });
  // No database: the write fails with 503 and must not announce anything.
  const response = await app.request(
    "/api/clients",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Juniper & Co.", kind: "organization" }),
    },
    env,
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(publish).not.toHaveBeenCalled();
});
