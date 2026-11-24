// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { JWTPayload } from "jose";
import { createApp } from "../../worker/app";
import { createActorResolver } from "../../worker/auth";
import { requestDb } from "../../worker/db/request";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";
import { invalidatePolicy } from "../../worker/records/permissions";
import { flushUsage, pendingUsage, resetPendingUsage } from "../../worker/records/usage";
import { fakeDb } from "./fake-db";

const sub = "30600000-0000-4000-8000-000000000001";
const userId = "30600000-0000-4000-8000-000000000002";
const verify = async (): Promise<JWTPayload> => ({ sub, email: "active@example.test" });
const request = (app: ReturnType<typeof createApp>, path: string, env: Record<string, unknown>) =>
  app.request(path, { headers: { Authorization: "Bearer test-token" } }, { ASSETS: { fetch }, ...env });
const activeUser = { id: userId, role: "admin", status: "active", authId: sub };

beforeEach(() => {
  resetPendingUsage();
  invalidatePolicy();
});

it("shares one client across a request's uses and closes it after the response (FLOW-306)", async () => {
  const closed = vi.fn();
  let opened = 0;
  const withDb: RunWithDb = async (_env, run) => {
    opened++;
    try {
      return await run({} as Db);
    } finally {
      closed();
    }
  };
  const scope = requestDb(withDb, { ASSETS: { fetch } });
  expect(scope.opened).toBe(false);
  const [a, b] = await Promise.all([scope.run({ ASSETS: { fetch } }, async () => 1), scope.run({ ASSETS: { fetch } }, async () => 2)]);
  expect([a, b]).toEqual([1, 2]);
  expect(await scope.run({ ASSETS: { fetch } }, async () => 3)).toBe(3);
  expect(opened).toBe(1);
  expect(closed).not.toHaveBeenCalled();
  await scope.close();
  expect(closed).toHaveBeenCalledTimes(1);
});

it("passes on a missing database as the request's error", async () => {
  const error = new Error("not configured");
  const scope = requestDb(async () => { throw error; }, { ASSETS: { fetch } });
  await expect(scope.run({ ASSETS: { fetch } }, async () => 1)).rejects.toBe(error);
  await scope.close();
});

it("calls a withDb that answers without running the work once per use", async () => {
  const withDb = vi.fn<RunWithDb>().mockResolvedValue("answer");
  const scope = requestDb(withDb as unknown as RunWithDb, { ASSETS: { fetch } });
  expect(await scope.run({ ASSETS: { fetch } }, async () => "unused")).toBe("answer");
  expect(withDb).toHaveBeenCalledTimes(1);
  expect(await scope.run({ ASSETS: { fetch } }, async () => "unused")).toBe("answer");
  expect(withDb).toHaveBeenCalledTimes(2);
  await scope.close();
});

it("serves an active user's GET with one connection and one plain auth query (FLOW-306 AC1)", async () => {
  const fake = fakeDb({ users: [activeUser], settings: [], list_values: [] });
  const app = createApp({ withDb: fake.withDb, resolveActor: createActorResolver(fake.withDb, verify) });
  const response = await request(app, "/api/settings", {});
  expect(response.status).toBe(200);
  expect(fake.connections).toBe(1);
  expect(fake.statements.filter((row) => row.table === "users")).toEqual([{ kind: "select", table: "users" }]);
  expect(fake.statements.some((row) => row.kind === "transaction")).toBe(false);
});

it("keeps the policy reload, the handler and the auth lookup on that one connection", async () => {
  const fake = fakeDb({ users: [activeUser], settings: [], list_values: [], role_permissions: [] });
  const app = createApp({ withDb: fake.withDb, resolveActor: createActorResolver(fake.withDb, verify), loadPolicy: true });
  expect((await request(app, "/api/settings", {})).status).toBe(200);
  expect(fake.connections).toBe(1);
  expect(fake.statements.some((row) => row.table === "role_permissions")).toBe(true);
});

it("writes no usage counter for an API request (FLOW-305 AC1)", async () => {
  const fake = fakeDb({ users: [activeUser], settings: [], list_values: [], role_permissions: [] });
  const app = createApp({ withDb: fake.withDb, resolveActor: createActorResolver(fake.withDb, verify) });
  // A flush just happened in this isolate: the next is a minute away.
  await flushUsage(fake.db);
  const env = { HYPERDRIVE: { connectionString: "postgres://unused" } };
  for (let i = 0; i < 3; i++) expect((await request(app, "/api/settings", env)).status).toBe(200);
  expect(fake.statements.filter((row) => row.table === "usage_counters")).toEqual([]);
  expect(pendingUsage()).toEqual([expect.objectContaining({ metric: "worker_requests", value: 3 })]);
});

it("counts nothing in the isolate once Cloudflare's figures are configured", async () => {
  const fake = fakeDb({ users: [activeUser], settings: [], list_values: [], role_permissions: [] });
  const app = createApp({ withDb: fake.withDb, resolveActor: createActorResolver(fake.withDb, verify) });
  const env = { HYPERDRIVE: { connectionString: "postgres://unused" }, CF_ANALYTICS_TOKEN: "token", CF_ACCOUNT_ID: "account" };
  expect((await request(app, "/api/settings", env)).status).toBe(200);
  expect(fake.statements.filter((row) => row.table === "usage_counters")).toEqual([]);
  expect(pendingUsage()).toEqual([]);
});
