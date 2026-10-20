import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import { apiErrorSchema, healthSchema } from "../../shared/api";

it("formats malformed records, unknown routes and unsupported methods consistently", async () => {
  const app = createApp();
  for (const [path, init] of [
    ["/api/unknown", undefined],
    ["/api/demo/clients/cli-1", { method: "PUT", body: "{" }],
    ["/api/health", { method: "POST" }],
  ] as const) {
    const response = await app.request(path, init);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const parsed = apiErrorSchema.parse(await response.json());
    expect(response.headers.get("X-Request-ID")).toBe(parsed.error.requestId);
  }
});
it("captures an unhandled error with the response request ID without exposing internals", async () => {
  const captureError = vi.fn();
  const failure = new Error("private database credential");
  const app = createApp({
    captureError,
    checkDatabase: async () => {
      throw failure;
    },
  });
  const response = await app.request("/api/health");
  expect(response.status).toBe(500);
  const parsed = apiErrorSchema.parse(await response.json());
  expect(parsed.error.code).toBe("INTERNAL_ERROR");
  expect(parsed.error.message).not.toContain("credential");
  expect(captureError).toHaveBeenCalledWith(failure, parsed.error.requestId);
});
it("returns independent request IDs and structured request logs", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const app = createApp();
    const first = await app.request("/api/health");
    const second = await app.request("/api/health");
    expect(first.headers.get("X-Request-ID")).not.toBe(
      second.headers.get("X-Request-ID"),
    );
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: "api_request",
      status: 200,
      requestId: first.headers.get("X-Request-ID"),
    });
  } finally {
    log.mockRestore();
  }
});
it.each(["reachable", "unreachable", "not_configured"] as const)(
  "reports version and database status: %s",
  async (database) => {
    const app = createApp({ checkDatabase: async () => database });
    const response = await app.request(
      "/api/health",
      {},
      { APP_VERSION: "test-release", ASSETS: { fetch } },
    );
    expect(healthSchema.parse(await response.json())).toEqual({
      ok: true,
      version: "test-release",
      database,
    });
  },
);
