// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import { ApiError, type AppEnv, type RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { builtinCard } from "../../shared/layout";
import { fieldProjection } from "../../worker/fields";
import { getLayout, saveLayout } from "../../worker/records/layout";

// FLOW-279: an edited built-in card is saved through the layout route with its
// fields checked, and a viewer gets only the card's fields they may read (AC4).
vi.mock("../../worker/records/layout", () => ({
  getLayout: vi.fn(),
  listLayouts: vi.fn(),
  saveLayout: vi.fn(),
  resetLayout: vi.fn(),
}));

const userId = "54100000-0000-4000-8000-000000000001";
const admin: Actor = { userId, role: "admin" };
let actor: Actor = admin;
const withDb: RunWithDb = (_env, run) => run({} as Db);
const app = createApp({ withDb, resolveActor: async () => actor });
const put = (pageKey: string, body: unknown) =>
  app.request(
    `/api/layout/${pageKey}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { ASSETS: { fetch } },
  );
const data = {
  filters: [{ field: "status", op: "is_not", value: "lost" }],
  sort: { field: "name", dir: "desc" },
  limit: 5,
  display: { type: "table", columns: [{ key: "name" }, { key: "budgetCents" }] },
};
const withData = (id: string, override: unknown) => ({
  version: 1,
  blocks: [{ kind: "builtin", id, x: 0, y: 0, w: 6, h: 12, data: override }],
  tables: {},
  fieldBoxes: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  actor = admin;
  vi.mocked(getLayout).mockResolvedValue(null);
  vi.mocked(saveLayout).mockImplementation(async (_db, _actor, pageKey, doc) => ({
    pageKey,
    layout: doc,
    updatedAt: "2026-11-23T12:00:00.000Z",
    updatedBy: userId,
  }));
});

it("saves an edited My Leads card and refuses unknown fields or a card that can't be edited", async () => {
  expect((await put("dashboard.home", withData("my-leads", data))).status).toBe(200);
  expect(vi.mocked(saveLayout).mock.calls[0][3].blocks[0]).toMatchObject({ id: "my-leads", data: { limit: 5 } });
  const unknown = { ...data, display: { type: "table", columns: [{ key: "nope" }] } };
  expect((await put("dashboard.home", withData("my-leads", unknown))).status).toBe(400);
  expect((await put("dashboard.home", withData("my-tasks", data))).status).toBe(400);
  expect(saveLayout).toHaveBeenCalledTimes(1);
  actor = { userId, role: "sales_manager" };
  expect((await put("dashboard.home", withData("my-leads", data))).status).toBe(403);
});

// The card asks the list endpoint for its columns with fields=; a stand-in for
// the leads endpoint behind the real projection middleware.
const leadRows = [
  { id: "54100000-0000-4000-8000-0000000000a1", name: "Avery", budgetCents: 5000, assignedSalespersonId: "someone-else", status: "new" },
  { id: "54100000-0000-4000-8000-0000000000a2", name: "Blake", budgetCents: 700, assignedSalespersonId: userId, status: "new" },
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

it("never gives a restricted role a field it can't read from an edited card (AC4)", async () => {
  const card = builtinCard("dashboard.home", "my-leads", data as never)!;
  const fields = card.display.type === "table" ? card.display.columns.map((column) => column.key).join(",") : "";
  actor = { userId, role: "salesperson" };
  const rows = (await (await mini.request(`/api/leads?fields=${fields}`)).json()) as Record<string, unknown>[];
  // Another salesperson's lead budget isn't theirs to see.
  expect(rows).toEqual([
    { id: leadRows[0].id, name: "Avery" },
    { id: leadRows[1].id, name: "Blake", budgetCents: 700 },
  ]);
});

mini.get("/api/recipes", (c) => c.json([{ id: userId, name: "Sample soup", category: "Soup", cost: { batchCents: 900 }, steps: ["Private preparation"] }]));
mini.get("/api/sops", (c) => c.json([{ id: userId, title: "Loading", version: 1, content: { type: "doc" } }]));
mini.get("/api/home/working-staff", (c) => c.json([{ id: userId, name: "Test worker", position: "Loader", since: "2026-11-23T12:00:00Z", mobile: "private" }]));
mini.get("/api/sales/clients/:id/proposals", (c) => c.json([{ id: userId, eventId: userId, title: "Sample proposal", stage: "inquiry", currentVersion: 2, secret: "private" }]));

it("FLOW-281: new sources project only registered readable fields", async () => {
  actor = { userId, role: "part_time_staff" };
  expect(await (await mini.request("/api/recipes?fields=name,category&take=10")).json()).toEqual([{ id: userId, name: "Sample soup", category: "Soup" }]);
  expect(await (await mini.request("/api/sops?fields=title,version&take=10")).json()).toEqual([{ id: userId, title: "Loading", version: 1 }]);
  expect(await (await mini.request("/api/home/working-staff?fields=name,position&take=10")).json()).toEqual([{ id: userId, name: "Test worker", position: "Loader" }]);
  expect((await mini.request("/api/recipes?fields=cost")).status).toBe(400);
});

it("FLOW-281: related client proposals retain the client endpoint instead of querying all sales", async () => {
  const result = await mini.request(`/api/sales/clients/${userId}/proposals?fields=title,stage&take=10`);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual([{ id: userId, eventId: userId, title: "Sample proposal", stage: "inquiry" }]);
});
