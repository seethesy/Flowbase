// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { searchResultPath } from "../../shared/search";

const env = { ASSETS: { fetch } };
const id = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";

it("answers 401 without a signed-in user (FLOW-46)", async () => {
  const mock = vi.fn<RunWithDb>();
  const response = await createApp({
    withDb: mock as unknown as RunWithDb,
  }).request("/api/search?q=maya", {}, env);
  expect(response.status).toBe(401);
  expect(mock).not.toHaveBeenCalled();
});

it("opens each result type at its record's screen", () => {
  expect(searchResultPath("client", id)).toBe(`/clients/${id}`);
  expect(searchResultPath("lead", id)).toBe(`/leads/${id}`);
  expect(searchResultPath("event", id)).toBe(`/events/${id}`);
  expect(searchResultPath("venue", id)).toBe(`/venues/${id}`);
  expect(searchResultPath("item", id)).toBe(`/inventory/${id}`);
});
