// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { roleSchema, type Actor, type Role } from "../../shared/access";
import {
  leadBulkAssignSchema,
  leadConvertSchema,
  leadIntakeSchema,
  leadNeedsReview,
  leadStatusChangeSchema,
  leadStatusTransitions,
  lostReasonRequired,
} from "../../shared/leads";
import { can, leadScope } from "../../worker/policy";

const env = { ASSETS: { fetch } };
const id = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";
const actor = (role: Role): Actor => ({
  userId: id,
  role,
  employmentType: "full_time",
});
const mockDb = () => {
  const mock = vi.fn<RunWithDb>();
  return { mock, withDb: mock as unknown as RunWithDb };
};
const post = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

it.each([
  ["GET", "/api/leads"],
  ["GET", `/api/leads/${id}`],
  ["POST", "/api/leads/assign"],
  ["POST", `/api/leads/${id}/assign`],
  ["POST", `/api/leads/${id}/status`],
  ["POST", `/api/leads/${id}/convert`],
  ["GET", "/api/leads/duplicates"],
  ["POST", `/api/leads/duplicates/${id}/merge`],
  ["POST", `/api/leads/duplicates/${id}/dismiss`],
])("%s %s answers 401 without a signed-in user", async (method, path) => {
  const { mock, withDb } = mockDb();
  const response = await createApp({ withDb }).request(path, { method }, env);
  expect(response.status).toBe(401);
  expect(mock).not.toHaveBeenCalled();
});

it("answers 404 for a malformed lead id", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  expect((await app.request("/api/leads/x", {}, env)).status).toBe(404);
  expect(
    (await app.request("/api/leads/x/assign", post({}), env)).status,
  ).toBe(404);
  expect(mock).not.toHaveBeenCalled();
});

it("scopes leads by role", () => {
  const rows = Object.fromEntries(
    roleSchema.options.map((role) => [
      role,
      [
        leadScope(actor(role)),
        can(actor(role), "leads.assign"),
        can(actor(role), "leads.update"),
        can(actor(role), "leads.convert"),
      ],
    ]),
  );
  expect(rows).toEqual({
    admin: ["all", true, true, true],
    technical: ["all", false, true, true],
    sales_manager: ["all", false, true, true],
    salesperson: ["own", false, true, true],
    kitchen_lead: ["none", false, false, false],
    kitchen_staff: ["none", false, false, false],
    staff: ["none", false, false, false],
  });
});

it("allows only Admin to assign, before touching the database", async () => {
  const { mock, withDb } = mockDb();
  for (const role of [
    "technical",
    "sales_manager",
    "salesperson",
    "kitchen_lead",
  ] as const) {
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    const body = { assignedSalespersonId: id };
    expect(
      (await app.request(`/api/leads/${id}/assign`, post(body), env)).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/api/leads/assign",
          post({ leadIds: [id], assignedSalespersonId: id }),
          env,
        )
      ).status,
    ).toBe(403);
  }
  expect(mock).not.toHaveBeenCalled();
});

it("refuses status changes and conversion to roles that don't sell", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("staff") });
  for (const path of [`/api/leads/${id}/status`, `/api/leads/${id}/convert`])
    expect((await app.request(path, post({}), env)).status).toBe(403);
  expect(mock).not.toHaveBeenCalled();
});

it("requires a reason to mark a lead lost, before touching the database", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  for (const body of [
    { status: "lost" },
    { status: "lost", reason: "   " },
  ]) {
    const response = await app.request(
      `/api/leads/${id}/status`,
      post(body),
      env,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(lostReasonRequired);
  }
  // Converted is reached only through convert.
  expect(
    (
      await app.request(
        `/api/leads/${id}/status`,
        post({ status: "converted" }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});

it("validates assign and convert bodies before touching the database", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  expect(
    (
      await app.request(
        "/api/leads/assign",
        post({ leadIds: [], assignedSalespersonId: id }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request(
        `/api/leads/${id}/convert`,
        post({ event: { startTime: "9am" } }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});

it("flags leads missing a date or a contact method for review", () => {
  const base = { eventDate: "2026-11-14", email: "a@b.co", phone: "" };
  expect(leadNeedsReview(base)).toBe(false);
  expect(leadNeedsReview({ ...base, email: "", phone: "2025550101" })).toBe(false);
  expect(leadNeedsReview({ ...base, eventDate: null })).toBe(true);
  expect(leadNeedsReview({ ...base, email: "" })).toBe(true);
});

it("accepts a sparse intake and rejects a bad one", () => {
  const lead = leadIntakeSchema.parse({ channel: "manual", source: "Phone" });
  expect(lead).toMatchObject({
    name: "",
    email: "",
    phone: "",
    eventDate: null,
    guestCount: null,
    purchased: false,
  });
  expect(() => leadIntakeSchema.parse({ channel: "fax", source: "x" })).toThrow();
  expect(() => leadIntakeSchema.parse({ channel: "manual", source: "" })).toThrow();
  expect(() =>
    leadIntakeSchema.parse({ channel: "manual", source: "x", eventDate: "2026-02-31" }),
  ).toThrow();
  expect(() =>
    leadIntakeSchema.parse({ channel: "manual", source: "x", email: "nope" }),
  ).toThrow();
});

it("allows only the documented status moves", () => {
  expect(leadStatusTransitions).toEqual({
    new: ["contacted", "lost"],
    contacted: ["qualified", "lost"],
    qualified: ["lost"],
    converted: [],
    lost: [],
  });
  expect(leadStatusChangeSchema.safeParse({ status: "lost", reason: "Booked elsewhere" }).success).toBe(true);
  expect(leadBulkAssignSchema.safeParse({ leadIds: [id], assignedSalespersonId: id }).success).toBe(true);
  const convert = leadConvertSchema.parse({ event: { startTime: "18:00" } });
  expect(convert.client).toEqual({
    mode: "create",
    name: "",
    kind: "person",
    allowDuplicate: false,
  });
});

it("lets only roles that sell resolve duplicates, before touching the database", async () => {
  expect(
    roleSchema.options.filter((role) => can(actor(role), "leads.merge")),
  ).toEqual(["admin", "technical", "sales_manager", "salesperson"]);
  const { mock, withDb } = mockDb();
  const staff = createApp({ withDb, resolveActor: async () => actor("staff") });
  for (const action of ["merge", "dismiss"])
    expect(
      (
        await staff.request(
          `/api/leads/duplicates/${id}/${action}`,
          post({ keepLeadId: id }),
          env,
        )
      ).status,
    ).toBe(403);
  const admin = createApp({ withDb, resolveActor: async () => actor("admin") });
  expect(
    (await admin.request("/api/leads/duplicates/x/merge", post({ keepLeadId: id }), env))
      .status,
  ).toBe(404);
  expect(
    (await admin.request(`/api/leads/duplicates/${id}/merge`, post({}), env)).status,
  ).toBe(400);
  expect(mock).not.toHaveBeenCalled();
});
