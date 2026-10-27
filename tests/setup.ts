import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { queryClient } from "../src/app/queryClient";
afterEach(cleanup);
// Each test starts with an empty data cache (FLOW-189).
afterEach(() => queryClient.clear());
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;

import { createApp } from "../worker/app";
const app = createApp({
  resolveActor: async () => ({
    userId: "36000000-0000-4000-8000-000000000003",
    role: "admin",
    employmentType: "full_time",
  }),
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) =>
      app.request(`http://localhost${input}`, init),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
