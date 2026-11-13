// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { Actor, Role } from "../../shared/access";
import type { RunWithDb } from "../../worker/hono";

const env = { ASSETS: { fetch } };
const actor = (role: Role): Actor => ({ userId: "a1590000-0000-4000-8000-000000000001", role, employmentType: "full_time" });
const path = "/api/operational-reports?from=2026-10-01&to=2026-10-31";

it.each(["technical", "salesperson", "kitchen_lead", "kitchen_staff", "staff"] as Role[])(
  "denies operational reports to %s before opening the database", async (role) => {
    const withDb = vi.fn() as unknown as RunWithDb;
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    expect((await app.request(path, {}, env)).status).toBe(403);
    expect(withDb).not.toHaveBeenCalled();
  },
);

it("rejects malformed and reversed date ranges before opening the database", async () => {
  const withDb = vi.fn() as unknown as RunWithDb;
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  expect((await app.request("/api/operational-reports?from=2026-02-31&to=2026-03-01", {}, env)).status).toBe(400);
  expect((await app.request("/api/operational-reports?from=2026-11-01&to=2026-10-31", {}, env)).status).toBe(400);
  expect(withDb).not.toHaveBeenCalled();
});
