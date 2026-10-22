// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { roleSchema, type Actor, type Role } from "../../shared/access";
import { can } from "../../worker/policy";

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
});

it.each([
  ["GET", "/api/inventory/items"],
  ["POST", "/api/inventory/items"],
  ["GET", `/api/inventory/items/${id}`],
  ["POST", `/api/inventory/items/${id}/transfers`],
  ["GET", "/api/inventory/sections"],
  ["POST", `/api/inventory/sections/${id}/archive`],
])("%s %s answers 401 without a signed-in user", async (method, path) => {
  const { mock, withDb } = mockDb();
  const response = await createApp({ withDb }).request(path, { method }, env);
  expect(response.status).toBe(401);
  expect(mock).not.toHaveBeenCalled();
});

it("answers 404 for a malformed item or section id", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  for (const path of [
    "/api/inventory/items/x",
    "/api/inventory/items/x/transfers",
  ])
    expect(
      (await app.request(path, path.endsWith("transfers") ? post({}) : {}, env))
        .status,
    ).toBe(404);
  expect(
    (await app.request("/api/inventory/sections/x/archive", post({}), env))
      .status,
  ).toBe(404);
  expect(mock).not.toHaveBeenCalled();
});

it("validates items and transfers before touching the database", async () => {
  const { mock, withDb } = mockDb();
  const app = createApp({ withDb, resolveActor: async () => actor("admin") });
  const cases: [string, unknown, string][] = [
    [
      "/api/inventory/items",
      { kind: "service", subtype: "linen", name: "Setup" },
      "Services have no subtype.",
    ],
    ["/api/inventory/items", { kind: "rental", name: "" }, "Name is required."],
    [
      `/api/inventory/items/${id}/transfers`,
      { fromSectionId: id, toSectionId: id, quantity: 5 },
      "Pick two different sections.",
    ],
    [
      `/api/inventory/items/${id}/transfers`,
      {
        fromSectionId: id,
        toSectionId: "9d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54",
        quantity: 0,
      },
      "Enter a quantity above zero.",
    ],
  ];
  for (const [path, body, message] of cases) {
    const response = await app.request(path, post(body), env);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(message);
  }
  expect(mock).not.toHaveBeenCalled();
});

it("refuses inventory writes to staff and section changes to non-admins", async () => {
  const { mock, withDb } = mockDb();
  for (const role of ["salesperson", "kitchen_staff", "staff"] as const) {
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    expect(
      (await app.request("/api/inventory/items", post({}), env)).status,
    ).toBe(403);
    expect(
      (await app.request(`/api/inventory/items/${id}/counts`, post({}), env))
        .status,
    ).toBe(403);
  }
  for (const role of ["technical", "sales_manager", "kitchen_lead"] as const) {
    const app = createApp({ withDb, resolveActor: async () => actor(role) });
    expect(
      (await app.request("/api/inventory/sections", post({}), env)).status,
    ).toBe(403);
  }
  expect(mock).not.toHaveBeenCalled();
});

it("lets managers and the kitchen lead manage inventory, and only Admin sections", () => {
  expect(
    Object.fromEntries(
      roleSchema.options.map((role) => [
        role,
        [
          can(actor(role), "inventory.write"),
          can(actor(role), "inventory.sections"),
        ],
      ]),
    ),
  ).toEqual({
    admin: [true, true],
    technical: [true, false],
    sales_manager: [true, false],
    salesperson: [false, false],
    kitchen_lead: [true, false],
    kitchen_staff: [false, false],
    staff: [false, false],
  });
});
