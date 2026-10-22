// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import { DatabaseNotConfiguredError } from "../../worker/db/errors";
import type { ConnectionCheck } from "../../shared/api";

const check: ConnectionCheck = {
  id: "2f1c6f0e-6b0a-4c55-9d52-0b6a4c0f1a11",
  note: "hello",
  createdAt: "2026-10-22T06:00:00.000Z",
};
const dbCheck = {
  list: vi.fn(),
  create: vi.fn(),
};
const enabled = { ASSETS: { fetch }, DB_CHECK_ROUTE: "enabled" };
const app = createApp({ dbCheck });
const post = (body: string, env: object | undefined, a = app) =>
  a.request("/api/dev/db-check", { method: "POST", body }, env);

beforeEach(() => {
  dbCheck.list.mockReset().mockResolvedValue([check]);
  dbCheck.create.mockReset().mockResolvedValue(check);
});
it.each([
  ["no environment bindings", undefined],
  ["the flag missing", { ASSETS: { fetch } }],
  ["the flag set to another value", { ...enabled, DB_CHECK_ROUTE: "disabled" }],
])("answers 404 for both methods with %s", async (_label, env) => {
  const get = await app.request("/api/dev/db-check", {}, env);
  expect(get.status).toBe(404);
  expect((await get.json()).error.code).toBe("NOT_FOUND");
  expect((await post(JSON.stringify({ note: "x" }), env)).status).toBe(404);
  expect(dbCheck.list).not.toHaveBeenCalled();
  expect(dbCheck.create).not.toHaveBeenCalled();
});
it("lists checks when the route is enabled", async () => {
  const response = await app.request("/api/dev/db-check", {}, enabled);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([check]);
  expect(dbCheck.list).toHaveBeenCalledWith(enabled);
});
it("creates a check from a trimmed note", async () => {
  const response = await post(JSON.stringify({ note: "  hello  " }), enabled);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(check);
  expect(dbCheck.create).toHaveBeenCalledWith(enabled, "hello");
});
it.each([
  ["malformed JSON", "{"],
  ["a missing note", JSON.stringify({})],
  ["a blank note", JSON.stringify({ note: "   " })],
  ["an over-long note", JSON.stringify({ note: "x".repeat(201) })],
])("rejects %s without touching the database", async (_label, body) => {
  const response = await post(body, enabled);
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  expect(dbCheck.create).not.toHaveBeenCalled();
});
it("reports a missing database binding as 503 with the request id", async () => {
  dbCheck.list.mockRejectedValue(new DatabaseNotConfiguredError());
  dbCheck.create.mockRejectedValue(new DatabaseNotConfiguredError());
  const get = await app.request("/api/dev/db-check", {}, enabled);
  const created = await post(JSON.stringify({ note: "x" }), enabled);
  for (const response of [get, created]) {
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("DATABASE_NOT_CONFIGURED");
    expect(body.error.requestId).toBe(response.headers.get("X-Request-ID"));
  }
  const unwired = await post(JSON.stringify({ note: "x" }), enabled, createApp());
  expect(unwired.status).toBe(503);
});
it("sends unexpected database failures through the standard 500 handler", async () => {
  const captureError = vi.fn();
  dbCheck.list.mockRejectedValue(new Error("connection reset"));
  const response = await createApp({ dbCheck, captureError }).request(
    "/api/dev/db-check",
    {},
    enabled,
  );
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.error.code).toBe("INTERNAL_ERROR");
  expect(JSON.stringify(body)).not.toContain("connection reset");
  expect(captureError).toHaveBeenCalledWith(
    expect.any(Error),
    response.headers.get("X-Request-ID"),
  );
});
