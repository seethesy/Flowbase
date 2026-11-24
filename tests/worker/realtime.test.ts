// @vitest-environment node
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import { ApiError, type AppEnv } from "../../worker/hono";
import { announceChanges, publishChanged, routeAreas, touches, unchanged } from "../../worker/realtime";
import type { Bindings } from "../../worker/bindings";
import { CHANGED_AREAS_HEADER, CHANGED_EVENT, CHANGES_CHANNEL, type ChangeArea } from "../../shared/realtime";

// FLOW-206 (ADR-11): a committed write sends one data-free "changed" ping;
// reads, failed and rolled-back writes send none.
const env = {
  ASSETS: { fetch },
  SUPABASE_URL: "https://project.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_test",
} as Bindings;

it("broadcasts a ping that carries no record fields", async () => {
  const send = vi.fn(async () => new Response(null, { status: 202 }));
  await publishChanged(env, null, send as typeof fetch);
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
  await publishChanged({ ASSETS: { fetch } }, null, send as typeof fetch);
  await publishChanged(undefined, null, send as typeof fetch);
  expect(send).not.toHaveBeenCalled();
  await expect(publishChanged(env, null, send as typeof fetch)).rejects.toThrow(
    "401",
  );
});

// A router shaped like the app's: the ping middleware, then handlers that
// commit, roll back (throw before responding) or only read.
function testApp(publish: (env: Bindings | undefined, areas: ChangeArea[] | null) => Promise<void>) {
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
  // FLOW-304: area-declaring writes, no-op writes and writes that ping nothing.
  app.put("/api/leads/:id", (c) => c.json({ ok: true }));
  app.post("/api/events/:id", (c) => {
    touches(c, "kitchen");
    return c.json({ ok: true });
  });
  app.delete("/api/layout/:key", (c) => {
    unchanged(c);
    return c.body(null, 204);
  });
  app.post("/api/time/sessions", (c) => c.json({ ok: true }, 201));
  app.post("/api/events/:id/planning/outputs/:kind/preview", (c) => c.json({ ok: true }));
  app.post("/api/events/:id/pull-list/regenerate/preview", (c) => c.json({ ok: true }));
  app.post("/api/events/:id/kitchen-menu/regenerate/preview", (c) => c.json({ ok: true }));
  app.post("/api/events/:id/kitchen-menu/regenerate", (c) => c.json({ ok: true }));
  app.post("/api/unmapped-things", (c) => c.json({ ok: true }));
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

// FLOW-304: a ping names only the areas the write changed (never record data),
// and writes that change nothing shared send none.
it("puts only area names in the ping", async () => {
  const send = vi.fn(async () => new Response(null, { status: 202 }));
  await publishChanged(env, ["leads"], send as typeof fetch);
  const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
  const { payload } = JSON.parse(String(init.body)).messages[0];
  expect(Object.keys(payload).sort()).toEqual(["areas", "at"]);
  expect(payload.areas).toEqual(["leads"]);
});

it("pings the areas a write declares and answers them in a header", async () => {
  const publish = vi.fn(async () => {});
  const app = testApp(publish);
  const lead = await app.request("/api/leads/1", { method: "PUT" });
  expect(publish).toHaveBeenLastCalledWith(undefined, ["leads"]);
  expect(lead.headers.get(CHANGED_AREAS_HEADER)).toBe("leads");
  // The router's areas, plus the ones the handler adds.
  const event = await app.request("/api/events/1", { method: "POST" });
  const areas = (publish.mock.lastCall as unknown as [unknown, ChangeArea[]])[1];
  expect(areas).toEqual(expect.arrayContaining(["events", "kitchen"]));
  expect(areas).not.toContain("leads");
  expect(event.headers.get(CHANGED_AREAS_HEADER)?.split(",")).toEqual(areas);
  // A write no area covers pings without areas: everyone refetches everything.
  const other = await app.request("/api/unmapped-things", { method: "POST" });
  expect(publish).toHaveBeenLastCalledWith(undefined, null);
  expect(other.headers.get(CHANGED_AREAS_HEADER)).toBeNull();
});

it("sends no ping for tracker sessions, previews and no-op writes (AC2)", async () => {
  const publish = vi.fn(async () => {});
  const app = testApp(publish);
  for (const path of [
    "/api/time/sessions",
    "/api/events/1/planning/outputs/pull_list/preview",
    "/api/events/1/pull-list/regenerate/preview",
    "/api/events/1/kitchen-menu/regenerate/preview",
  ]) {
    const response = await app.request(path, { method: "POST" });
    expect(response.status).toBeLessThan(300);
    // Nothing changed: the browser that sent it marks nothing stale either.
    expect(response.headers.get(CHANGED_AREAS_HEADER)).toBe("");
  }
  expect((await app.request("/api/layout/leads.detail", { method: "DELETE" })).status).toBe(204);
  expect(publish).not.toHaveBeenCalled();
  // The regeneration itself still pings.
  await app.request("/api/events/1/kitchen-menu/regenerate", { method: "POST" });
  expect(publish).toHaveBeenCalledTimes(1);
});

it("covers role, status and permission changes with the areas sessions re-check (AC3)", () => {
  expect(routeAreas("/api/admin/users/36000000-0000-4000-8000-000000000003")).toContain("users");
  expect(routeAreas("/api/permissions")).toContain("settings");
  expect(routeAreas("/api/leads/36000000-0000-4000-8000-000000000003")).toEqual(["leads"]);
  expect(routeAreas("/api/leads/36000000-0000-4000-8000-000000000003/convert")).toEqual(
    expect.arrayContaining(["leads", "clients", "events"]),
  );
  expect(routeAreas("/api/imports/events")).toBeNull();
});
