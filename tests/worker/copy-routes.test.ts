// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { listCopy, resetCopy, saveCopy } from "../../worker/records/copy";

// Admin live text editing (FLOW-240): routes, permission and placeholder checks.
vi.mock("../../worker/records/copy", () => ({
  listCopy: vi.fn(),
  saveCopy: vi.fn(),
  resetCopy: vi.fn(),
  deleteCopyRow: vi.fn(),
  moveCopy: vi.fn(),
}));

const userId = "41000000-0000-4000-8000-000000000001";
const admin: Actor = { userId, role: "admin", employmentType: "full_time" };
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

beforeEach(() => {
  vi.clearAllMocks();
  actor = admin;
  vi.mocked(listCopy).mockResolvedValue({ "nav.sales": "Selling" });
  vi.mocked(saveCopy).mockImplementation(async (_db, _actor, edits) =>
    Object.fromEntries(edits.map((edit) => [edit.key, edit.text])),
  );
  vi.mocked(resetCopy).mockResolvedValue(true);
});

it("gives every signed-in role the saved wording", async () => {
  for (const role of ["admin", "salesperson", "kitchen_staff", "staff"] as const) {
    actor = { userId, role, employmentType: "part_time" };
    const response = await send("/api/copy");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ "nav.sales": "Selling" });
  }
});

it("lets only the admin save or reset wording (AC1)", async () => {
  for (const role of ["technical", "sales_manager", "salesperson", "kitchen_lead", "kitchen_staff", "staff"] as const) {
    actor = { userId, role, employmentType: "full_time" };
    expect((await send("/api/copy", "PUT", [{ key: "nav.sales", text: "Selling" }])).status).toBe(403);
    expect((await send("/api/copy/nav.sales", "DELETE")).status).toBe(403);
  }
  expect(saveCopy).not.toHaveBeenCalled();
  expect(resetCopy).not.toHaveBeenCalled();
});

it("saves a batch in one call", async () => {
  const edits = [
    { key: "nav.sales", text: "Selling", placeholders: [] },
    { key: "shared.empty-state.title", text: "Nothing here yet", placeholders: [] },
  ];
  const response = await send("/api/copy", "PUT", edits);
  expect(response.status).toBe(200);
  expect(saveCopy).toHaveBeenCalledTimes(1);
  expect(vi.mocked(saveCopy).mock.calls[0][2]).toEqual(edits);
  expect(await response.json()).toEqual({ "nav.sales": "Selling", "shared.empty-state.title": "Nothing here yet" });
});

it("rejects text that drops, misspells or adds a placeholder (AC5)", async () => {
  for (const text of ["Showing rows", "Showing {cuont} rows", "Showing {count} rows of {total}"]) {
    const response = await send("/api/copy", "PUT", [
      { key: "shared.data-table.showing", text, placeholders: ["count"] },
    ]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_PLACEHOLDERS");
  }
  expect(saveCopy).not.toHaveBeenCalled();
  expect((await send("/api/copy", "PUT", [
    { key: "shared.data-table.showing", text: "{count} rows shown", placeholders: ["count"] },
  ])).status).toBe(200);
});

it("rejects bad keys, empty or overlong text and empty batches", async () => {
  for (const body of [
    [{ key: "Not A Key", text: "Hi" }],
    [{ key: "nokey", text: "Hi" }],
    [{ key: "nav.sales", text: "   " }],
    [{ key: "nav.sales", text: "x".repeat(501) }],
    [],
  ])
    expect((await send("/api/copy", "PUT", body)).status).toBe(400);
  expect((await send("/api/copy/Not%20a%20key", "DELETE")).status).toBe(400);
});

it("stores <script> text as plain text (AC7)", async () => {
  const text = "<script>alert(1)</script><b>Bold</b>";
  const response = await send("/api/copy", "PUT", [{ key: "nav.sales", text }]);
  expect(response.status).toBe(200);
  expect(vi.mocked(saveCopy).mock.calls[0][2][0].text).toBe(text);
});

it("resets a key to its default (AC6)", async () => {
  const response = await send("/api/copy/nav.sales", "DELETE");
  expect(response.status).toBe(204);
  expect(resetCopy).toHaveBeenCalledWith(expect.anything(), "nav.sales");
});

it("saves wording without its leading and trailing line breaks (FLOW-277 AC6)", async () => {
  const response = await send("/api/copy", "PUT", [
    { key: "staff.form.save", text: "Save Changes\n\n" },
    { key: "planning.auto", text: " · automatic" },
  ]);
  expect(response.status).toBe(200);
  expect(vi.mocked(saveCopy).mock.calls[0][2]).toEqual([
    { key: "staff.form.save", text: "Save Changes", placeholders: [] },
    { key: "planning.auto", text: " · automatic", placeholders: [] },
  ]);
  expect((await send("/api/copy", "PUT", [{ key: "staff.form.save", text: "\n\n" }])).status).toBe(400);
});
