import { expect, it, vi } from "vitest";
import { healthSchema } from "../../shared/api";

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  withSentry: vi.fn((_options, handler) => handler),
}));
vi.mock("@sentry/cloudflare", () => sentry);
import worker from "../../worker";

it("wires Worker failures to Sentry with the request ID", async () => {
  const failure = new Error("fixture adapter failed");
  const parse = vi.spyOn(healthSchema, "parse").mockImplementation(() => {
    throw failure;
  });
  try {
    const response = await worker.fetch!(
      new Request("http://localhost/api/health"),
      { ASSETS: { fetch } },
      {} as Parameters<NonNullable<typeof worker.fetch>>[2],
    );
    expect(response.status).toBe(500);
    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { requestId: response.headers.get("X-Request-ID") },
    });
  } finally {
    parse.mockRestore();
  }
});
