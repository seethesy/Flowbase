// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { roleSchema, type Actor, type Role } from "../../shared/access";
import { timeReportScope } from "../../worker/policy";

// Time tracking (FLOW-119) and the event hub (FLOW-57) routes, without a database.
const env = { ASSETS: { fetch } };
const userId = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";
const actor = (role: Role): Actor => ({
  userId,
  role,
  employmentType: "full_time",
});
const mockDb = () => {
  const mock = vi.fn<RunWithDb>();
  return { mock, withDb: mock as unknown as RunWithDb };
};
const session = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  startedAt: "2026-11-02T14:00:00.000Z",
  endedAt: "2026-11-02T14:02:00.000Z",
  recordType: "event",
  recordId: "e0000000-0000-4000-8000-000000000001",
  activity: "event_planning",
  ...overrides,
});
const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request(
    "/api/time/sessions",
    { method: "POST", body: JSON.stringify(body) },
    env,
  );

it.each([
  ["POST", "/api/time/sessions"],
  ["GET", "/api/time/report"],
  ["GET", `/api/events/${userId}/hub`],
])("%s %s answers 401 without a signed-in user", async (method, path) => {
  const { mock, withDb } = mockDb();
  const response = await createApp({ withDb }).request(path, { method }, env);
  expect(response.status).toBe(401);
  expect(mock).not.toHaveBeenCalled();
});

it("answers 404 for a malformed event id on the hub", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("staff") });
  expect((await app.request("/api/events/x/hub", {}, env)).status).toBe(404);
  expect(mock).not.toHaveBeenCalled();
});

it.each([
  ["no sessions", { sessions: [] }],
  ["an end before the start", { sessions: [session({ endedAt: "2026-11-02T13:59:00.000Z" })] }],
  ["a session over 12 hours", { sessions: [session({ endedAt: "2026-11-03T03:00:00.000Z" })] }],
  ["a record type without an id", { sessions: [session({ recordId: null })] }],
  ["an unknown activity", { sessions: [session({ activity: "napping" })] }],
  ["a non-uuid id", { sessions: [session({ id: "s-1" })] }],
  ["more than 100 sessions", { sessions: Array.from({ length: 101 }, () => session()) }],
])("rejects %s before touching the database", async (_name, body) => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("staff") });
  expect((await post(app, body)).status).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});

it("accepts a session without a record from any signed-in role", async () => {
  for (const role of roleSchema.options) {
    const { mock, withDb } = mockDb();
    mock.mockResolvedValue({ recorded: 1 });
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    const response = await post(app, {
      sessions: [session({ recordType: null, recordId: null, activity: "general" })],
    });
    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  }
});

it("rejects a bad report range or user before touching the database", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  for (const query of [
    "from=2026-11-05&to=2026-11-01",
    "userId=someone",
    // An impossible date is refused, not rolled over to March 3 (FLOW-191).
    "from=2026-02-31&to=2026-03-05",
    "to=2026-02-31",
  ])
    expect(
      (await app.request(`/api/time/report?${query}`, {}, env)).status,
    ).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});

it("shows everyone's time only to Admin and Sales Manager", () => {
  expect(
    Object.fromEntries(
      roleSchema.options.map((role) => [role, timeReportScope(actor(role))]),
    ),
  ).toEqual({
    admin: "all",
    technical: "own",
    sales_manager: "all",
    salesperson: "own",
    kitchen_lead: "own",
    kitchen_staff: "own",
    staff: "own",
  });
});
