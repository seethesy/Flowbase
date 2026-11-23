// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import { ApiError, type AppEnv, type RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { fieldProjection } from "../../worker/fields";
import { getLayout, resetLayout, saveLayout } from "../../worker/records/layout";

// Page layouts (FLOW-253): routes, the layout.edit permission and server-side
// validation; fields= projection and card queries (FLOW-256).
vi.mock("../../worker/records/layout", () => ({
  getLayout: vi.fn(),
  listLayouts: vi.fn(),
  saveLayout: vi.fn(),
  resetLayout: vi.fn(),
}));

const userId = "54000000-0000-4000-8000-000000000001";
const admin: Actor = { userId, role: "admin" };
let actor: Actor = admin;
const withDb: RunWithDb = (_env, run) => run({} as Db);
const app = createApp({ withDb, resolveActor: async () => actor });
const send = (path: string, method = "GET", body?: unknown) =>
  app.request(
    path,
    {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    },
    { ASSETS: { fetch } },
  );
const layout = {
  version: 1,
  blocks: [{ kind: "builtin", id: "notes", x: 0, y: 0, w: 6, h: 8, style: { background: "#edf3ee" } }],
  tables: {},
  fieldBoxes: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  actor = admin;
  vi.mocked(getLayout).mockResolvedValue(null);
  vi.mocked(saveLayout).mockImplementation(async (_db, _actor, pageKey, doc) => ({
    pageKey,
    layout: doc,
    updatedAt: "2026-11-20T12:00:00.000Z",
    updatedBy: userId,
  }));
  vi.mocked(resetLayout).mockResolvedValue();
});

it("gives every signed-in role the page's layout, or null for the code default", async () => {
  for (const role of ["admin", "salesperson", "kitchen_staff", "staff"] as const) {
    actor = { userId, role };
    const response = await send("/api/layout/leads.detail");
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  }
});

it("lets only an Admin save or reset a layout (AC: layout.edit)", async () => {
  for (const role of ["technical", "sales_manager", "salesperson", "kitchen_lead", "kitchen_staff", "staff", "part_time_staff"] as const) {
    actor = { userId, role };
    expect((await send("/api/layout/leads.detail", "PUT", layout)).status).toBe(403);
    expect((await send("/api/layout/leads.detail", "DELETE")).status).toBe(403);
  }
  expect(saveLayout).not.toHaveBeenCalled();
  expect(resetLayout).not.toHaveBeenCalled();
});

it("saves a valid layout and resets with 204", async () => {
  const saved = await send("/api/layout/leads.detail", "PUT", layout);
  expect(saved.status).toBe(200);
  expect(vi.mocked(saveLayout).mock.calls[0][2]).toBe("leads.detail");
  expect((await saved.json()).layout.blocks[0].id).toBe("notes");
  const reset = await send("/api/layout/leads.detail", "DELETE");
  expect(reset.status).toBe(204);
  expect(vi.mocked(resetLayout).mock.calls[0][2]).toBe("leads.detail");
});

it("rejects low contrast, unknown fields and bad keys with nothing saved", async () => {
  const lowContrast = { ...layout, blocks: [{ ...layout.blocks[0], style: { text: "#eeeeee" } }] };
  const unknownField = {
    ...layout,
    fieldBoxes: { "lead-facts": { boxes: [{ id: "field-1", kind: "field", field: "nope", x: 0, y: 0, w: 6, h: 2 }] } },
  };
  for (const body of [lowContrast, unknownField, { version: 1, blocks: [{ kind: "builtin", id: "x", x: 0, y: 0, w: 6, h: 2, style: { text: "red" } }] }]) {
    const response = await send("/api/layout/leads.detail", "PUT", body);
    expect(response.status).toBe(400);
  }
  expect((await send("/api/layout/Not%20A%20Key", "PUT", layout)).status).toBe(400);
  expect(saveLayout).not.toHaveBeenCalled();
});

// fields= and card queries, on a stand-in for the list and detail endpoints.
const leadRows = [
  { id: "54000000-0000-4000-8000-0000000000a1", name: "Avery", email: "avery@example.test", budgetCents: 5000, assignedSalespersonId: "someone-else", message: "Hi" },
  { id: "54000000-0000-4000-8000-0000000000a2", name: "Blake", email: "blake@example.test", budgetCents: 700, assignedSalespersonId: userId, message: "Hello" },
];
const mini = new Hono<AppEnv>();
mini.onError((error, c) =>
  error instanceof ApiError ? c.json({ error: error.message }, error.status) : c.json({ error: String(error) }, 500),
);
mini.use("*", async (c, next) => {
  c.set("actor", actor);
  await next();
});
mini.use("/api/*", fieldProjection(() => mini));
mini.get("/api/leads", (c) => c.json(leadRows));
mini.get("/api/leads/:id", (c) => c.json(leadRows.find((row) => row.id === c.req.param("id"))));

it("returns only asked-for fields the viewer may read", async () => {
  actor = { userId, role: "salesperson" };
  const list = await mini.request("/api/leads?fields=name,budgetCents");
  expect(await list.json()).toEqual([
    { id: leadRows[0].id, name: "Avery" },
    { id: leadRows[1].id, name: "Blake", budgetCents: 700 },
  ]);
  const one = await mini.request(`/api/leads/${leadRows[0].id}?fields=name,message`);
  expect(await one.json()).toEqual({ id: leadRows[0].id, name: "Avery", message: "Hi" });
  expect((await mini.request("/api/leads?fields=name,nope")).status).toBe(400);
});

it("filters, sorts and limits a card's rows on readable fields only", async () => {
  actor = admin;
  const sorted = await mini.request("/api/leads?fields=name&orderBy=budgetCents:asc&take=1");
  expect(await sorted.json()).toEqual([{ id: leadRows[1].id, name: "Blake" }]);
  actor = { userId, role: "salesperson" };
  // Avery's budget isn't the salesperson's to see: it sorts as empty, last.
  const hidden = await mini.request("/api/leads?fields=name&orderBy=budgetCents:desc&take=1");
  expect(await hidden.json()).toEqual([{ id: leadRows[1].id, name: "Blake" }]);
  const where = encodeURIComponent(JSON.stringify([{ field: "name", op: "contains", value: "av" }]));
  expect(await (await mini.request(`/api/leads?fields=name&where=${where}`)).json()).toEqual([{ id: leadRows[0].id, name: "Avery" }]);
  const unfilterable = encodeURIComponent(JSON.stringify([{ field: "budgetCents", op: "after", value: 1 }]));
  expect((await mini.request(`/api/leads?fields=name&where=${unfilterable}`)).status).toBe(400);
  expect((await mini.request("/api/leads?fields=name&take=500")).status).toBe(400);
});
