import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
afterEach(cleanup);
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;

import { app } from "../worker/app";
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) =>
      app.request(`http://localhost${input}`, init),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
