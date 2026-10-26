// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { roleSchema, type Actor, type Role } from "../../shared/access";
import { can, clientScope, eventScope } from "../../worker/policy";
import { businessTimeToUtc, utcToBusinessTime } from "../../shared/time";

const env = { ASSETS: { fetch } };
const actor = (role: Role): Actor => ({
  userId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
  role,
  employmentType: "full_time",
});
const mockDb = () => {
  const mock = vi.fn<RunWithDb>();
  return { mock, withDb: mock as unknown as RunWithDb };
};

it.each([
  ["GET", "/api/clients"],
  ["POST", "/api/clients"],
  ["GET", "/api/venues"],
  ["PUT", "/api/venues/8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54"],
  ["GET", "/api/events"],
  ["POST", "/api/events/8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54/archive"],
])("%s %s answers 401 without a signed-in user", async (method, path) => {
  const { mock, withDb } = mockDb();
  const response = await createApp({ withDb }).request(path, { method }, env);
  expect(response.status).toBe(401);
  expect(mock).not.toHaveBeenCalled();
});
it("leaves health open and protects demo records", async () => {
  const app = createApp();
  expect((await app.request("/api/health", {}, env)).status).toBe(200);
  expect((await app.request("/api/demo/clients", {}, env)).status).toBe(401);
});
it("answers 404 for a malformed record id", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  for (const path of ["/api/clients/x", "/api/venues/x", "/api/events/x"])
    expect((await app.request(path, {}, env)).status).toBe(404);
  expect(mock).not.toHaveBeenCalled();
});
it("validates bodies before touching the database", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  const response = await app.request(
    "/api/events",
    {
      method: "POST",
      body: JSON.stringify({
        title: "",
        date: "2026-11-14",
        startTime: "18:00",
      }),
    },
    env,
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.message).toBe("Title is required.");
  expect(mock).not.toHaveBeenCalled();
});
it("answers 400 for an impossible event date before touching the database (FLOW-191)", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  const response = await app.request(
    "/api/events",
    {
      method: "POST",
      body: JSON.stringify({
        title: "Fall gala",
        date: "2026-02-31",
        startTime: "18:00",
        clientId: "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
      }),
    },
    env,
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.message).toBe("Enter a date.");
  expect(mock).not.toHaveBeenCalled();
});
it("refuses record writes to roles that don't sell", async () => {
  const { mock, withDb } = mockDb();
  for (const role of ["kitchen_lead", "kitchen_staff", "staff"] as const) {
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    for (const path of ["/api/clients", "/api/venues", "/api/events"])
      expect(
        (await app.request(path, { method: "POST", body: "{}" }, env)).status,
      ).toBe(403);
  }
  expect(mock).not.toHaveBeenCalled();
});
it("scopes records by role", () => {
  const scopes = Object.fromEntries(
    roleSchema.options.map((role) => [
      role,
      [
        clientScope(actor(role)),
        eventScope(actor(role)),
        can(actor(role), "events.write"),
      ],
    ]),
  );
  expect(scopes).toEqual({
    admin: ["all", "all", true],
    technical: ["all", "all", true],
    sales_manager: ["all", "all", true],
    salesperson: ["own", "own", true],
    kitchen_lead: ["none", "staffed", false],
    kitchen_staff: ["none", "staffed", false],
    staff: ["none", "staffed", false],
  });
});
it("converts New York wall-clock times across daylight saving", () => {
  expect(businessTimeToUtc("2026-07-04", "18:00").toISOString()).toBe(
    "2026-07-04T22:00:00.000Z",
  );
  expect(businessTimeToUtc("2026-12-31", "23:30").toISOString()).toBe(
    "2027-01-01T04:30:00.000Z",
  );
  expect(utcToBusinessTime(new Date("2027-01-01T04:30:00.000Z"))).toEqual({
    date: "2026-12-31",
    time: "23:30",
  });
  // The day DST starts: 3:30 am exists only as EDT.
  expect(businessTimeToUtc("2026-03-08", "03:30").toISOString()).toBe(
    "2026-03-08T07:30:00.000Z",
  );
});
