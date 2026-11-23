// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../../worker/app";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { deleteCopyRow, listCopy, moveCopy } from "../../worker/records/copy";
import { getLayout, listLayouts, saveLayout } from "../../worker/records/layout";

// FLOW-277: a key renamed in code keeps the Admin's override (AC1), and saved
// edits that no longer match a screen can be listed, deleted or moved (AC3).
vi.mock("../../worker/records/copy", () => ({
  listCopy: vi.fn(),
  saveCopy: vi.fn(),
  resetCopy: vi.fn(),
  deleteCopyRow: vi.fn(),
  moveCopy: vi.fn(),
}));
vi.mock("../../worker/records/layout", () => ({
  getLayout: vi.fn(),
  listLayouts: vi.fn(),
  saveLayout: vi.fn(),
  resetLayout: vi.fn(),
}));
// A release that renamed a wording key and an event block.
vi.mock("../../shared/live-edit-renames", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/live-edit-renames")>();
  return {
    ...original,
    liveEditRenames: {
      copy: { "staff.staff-form.save-profile": "nav.staff-directory" },
      blocks: { "events.detail/old-details": "details" },
      removed: { copy: [], blocks: [] },
    },
  };
});

const userId = "41000000-0000-4000-8000-000000000077";
const admin: Actor = { userId, role: "admin", employmentType: "full_time" };
let actor: Actor = admin;
const withDb: RunWithDb = (_env, run) => run({} as Db);
const app = createApp({ withDb, resolveActor: async () => actor });
const send = (path: string, method = "GET", body?: unknown) =>
  app.request(
    path,
    {
      method,
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    },
    { ASSETS: { fetch } },
  );
const layout = (blocks: { id: string }[], fieldBoxes: Record<string, unknown> = {}) => ({
  version: 1 as const,
  blocks: blocks.map((block, index) => ({ kind: "builtin" as const, id: block.id, x: 0, y: index * 8, w: 12, h: 8 })),
  tables: {},
  fieldBoxes: fieldBoxes as never,
});

beforeEach(() => {
  vi.clearAllMocks();
  actor = admin;
  vi.mocked(listCopy).mockResolvedValue({
    "staff.staff-form.save-profile": "Save staff",
    "nav.approvals": "Today",
    "retired.screen.title": "Old title",
  });
  vi.mocked(listLayouts).mockResolvedValue([
    { pageKey: "events.detail", layout: layout([{ id: "old-details" }, { id: "gone-section" }]) },
    { pageKey: "retired.page", layout: layout([{ id: "list" }]) },
  ]);
  vi.mocked(getLayout).mockResolvedValue({
    pageKey: "events.detail",
    layout: layout([{ id: "old-details" }, { id: "gone-section" }]),
    updatedAt: "2026-11-22T00:00:00.000Z",
    updatedBy: userId,
  });
  vi.mocked(saveLayout).mockResolvedValue(null);
  vi.mocked(moveCopy).mockResolvedValue(true);
  vi.mocked(deleteCopyRow).mockResolvedValue();
});

it("shows an override saved under a renamed key for everyone (AC1)", async () => {
  actor = { userId, role: "staff", employmentType: "part_time" };
  const body = (await (await send("/api/copy")).json()) as Record<string, string>;
  expect(body["nav.staff-directory"]).toBe("Save staff");
  expect(body["staff.staff-form.save-profile"]).toBeUndefined();
  expect(body["nav.approvals"]).toBe("Today");
});

it("reads a renamed block under its new id", async () => {
  const body = (await (await send("/api/layout/events.detail")).json()) as { layout: { blocks: { id: string }[] } };
  expect(body.layout.blocks.map((block) => block.id)).toEqual(["details", "gone-section"]);
});

it("lists saved edits no screen matches, for the Admin only (AC3)", async () => {
  const response = await send("/api/copy/orphans");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    copy: [{ key: "retired.screen.title", text: "Old title" }],
    blocks: [
      { pageKey: "events.detail", id: "gone-section", kind: "block" },
      { pageKey: "retired.page", id: "list", kind: "block" },
    ],
  });
  actor = { userId, role: "sales_manager", employmentType: "full_time" };
  expect((await send("/api/copy/orphans")).status).toBe(403);
  expect((await send("/api/copy/orphans", "POST", { action: "delete", type: "copy", key: "retired.screen.title" })).status).toBe(403);
});

it("deletes an orphaned wording row", async () => {
  expect((await send("/api/copy/orphans", "POST", { action: "delete", type: "copy", key: "retired.screen.title" })).status).toBe(204);
  expect(deleteCopyRow).toHaveBeenCalledWith(expect.anything(), "retired.screen.title");
});

it("moves an orphaned row to a key a screen renders, keeping placeholders right", async () => {
  expect((await send("/api/copy/orphans", "POST", { action: "move", type: "copy", key: "retired.screen.title", to: "nav.approvals" })).status).toBe(204);
  expect(moveCopy).toHaveBeenCalledWith(expect.anything(), admin, "retired.screen.title", "nav.approvals");
  // Not a key any screen renders.
  const unknown = await send("/api/copy/orphans", "POST", { action: "move", type: "copy", key: "retired.screen.title", to: "no.such.key" });
  expect(unknown.status).toBe(400);
});

it("deletes or moves an orphaned block in the saved layout", async () => {
  expect((await send("/api/copy/orphans", "POST", { action: "delete", type: "block", pageKey: "events.detail", id: "gone-section" })).status).toBe(204);
  expect(vi.mocked(saveLayout).mock.calls[0][3].blocks.map((block) => block.id)).toEqual(["old-details"]);
  expect((await send("/api/copy/orphans", "POST", { action: "move", type: "block", pageKey: "events.detail", id: "gone-section", to: "timeline" })).status).toBe(204);
  expect(vi.mocked(saveLayout).mock.calls[1][3].blocks.map((block) => block.id)).toEqual(["old-details", "timeline"]);
  expect((await send("/api/copy/orphans", "POST", { action: "move", type: "block", pageKey: "events.detail", id: "gone-section", to: "nowhere" })).status).toBe(400);
});
