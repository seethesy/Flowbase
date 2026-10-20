import { afterEach, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";
import { initializeObservability } from "../src/observability";

vi.mock("@sentry/react", () => ({ init: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(Sentry.init).mockClear();
});
it("disables browser reporting without a configured DSN", () => {
  vi.stubEnv("VITE_SENTRY_DSN", "");
  initializeObservability();
  expect(Sentry.init).not.toHaveBeenCalled();
});
it("initializes browser errors with the configured DSN and package release", () => {
  vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.com/1");
  initializeObservability();
  expect(Sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      dsn: "https://public@example.com/1",
      release: "0.1.0",
      sendDefaultPii: false,
      tracesSampleRate: 0,
    }),
  );
});
