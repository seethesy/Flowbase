// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { Actor, Role } from "../../shared/access";
import type { RunWithDb } from "../../worker/hono";
import { can } from "../../worker/policy";
import { roleSchema } from "../../shared/access";

const env = { ASSETS: { fetch } };
const actor = (role: Role): Actor => ({
  userId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
  role,
  employmentType: "full_time",
});
const paths = [
  ["GET", "/api/admin/jobs"],
  ["POST", "/api/admin/jobs/8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54/retry"],
  ["GET", "/api/admin/ingest-receipts"],
  [
    "POST",
    "/api/admin/ingest-receipts/8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54/replay",
  ],
] as const;

it.each(paths)("%s %s answers 401 without a signed-in user", async (method, path) => {
  const withDb = vi.fn<RunWithDb>();
  const response = await createApp({ withDb }).request(path, { method }, env);
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
  expect(withDb).not.toHaveBeenCalled();
});
it.each(roleSchema.options.filter((role) => role !== "admin"))(
  "refuses the %s role on every admin route",
  async (role) => {
    const withDb = vi.fn<RunWithDb>();
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    for (const [method, path] of paths) {
      const response = await app.request(path, { method }, env);
      expect(response.status).toBe(403);
    }
    expect(withDb).not.toHaveBeenCalled();
    expect(can(actor(role), "jobs.manage")).toBe(false);
    expect(can(actor(role), "ingest.manage")).toBe(false);
  },
);
it("lets an admin list failed jobs", async () => {
  const withDb = vi.fn<RunWithDb>().mockResolvedValue([]);
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  const response = await app.request("/api/admin/jobs", {}, env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
});
it("rejects an unknown job status filter", async () => {
  const app = createApp({ resolveActor: async () => actor("admin") });
  const response = await app.request("/api/admin/jobs?status=lost", {}, env);
  expect(response.status).toBe(400);
});
it("answers 404 for a malformed job id without touching the database", async () => {
  const withDb = vi.fn<RunWithDb>();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  const response = await app.request(
    "/api/admin/jobs/not-a-uuid/retry",
    { method: "POST" },
    env,
  );
  expect(response.status).toBe(404);
  expect(withDb).not.toHaveBeenCalled();
});
it("reports an unwired database as 503", async () => {
  const app = createApp({ resolveActor: async () => actor("admin") });
  const response = await app.request("/api/admin/jobs", {}, env);
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe("DATABASE_NOT_CONFIGURED");
  expect(body.error.requestId).toBe(response.headers.get("X-Request-ID"));
});
