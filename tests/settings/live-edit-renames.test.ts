import { describe, expect, it } from "vitest";
import { placeholdersMatch, trimLineBreaks } from "../../shared/copy";
import { findOrphans, moveOrphan, withoutOrphan, type LiveEditManifest } from "../../shared/live-edit-orphans";
import {
  copyAliases,
  liveEditRenames,
  renameCopyOverrides,
  renameLayoutDoc,
  resolveCopyKey,
  type LiveEditRenames,
} from "../../shared/live-edit-renames";
import type { LayoutDocV1 } from "../../shared/layout";

// FLOW-277: saved wording and layouts follow keys renamed in code.
const renames: LiveEditRenames = {
  copy: {
    "staff.staff-form.save-profile": "staff.staff-form.save",
    "task-lists.task-list.my-tasks": "task-lists.task-dashboard-page.my-tasks",
    "a.b.one": "a.b.two",
    "a.b.two": "a.b.three",
    "loop.a.x": "loop.a.y",
    "loop.a.y": "loop.a.x",
  },
  blocks: { "events.detail/notes": "event-notes", "leads.detail/old-facts": "lead-facts" },
  removed: { copy: [], blocks: [] },
};
const block = (id: string, kind: "builtin" | "text" = "builtin") =>
  kind === "builtin"
    ? ({ kind, id, x: 0, y: 0, w: 12, h: 8 } as const)
    : ({ kind, id, x: 0, y: 0, w: 12, h: 2, variant: "text", text: "Hi" } as const);
const doc = (blocks: LayoutDocV1["blocks"], fieldBoxes: LayoutDocV1["fieldBoxes"] = {}): LayoutDocV1 => ({
  version: 1,
  blocks,
  tables: {},
  fieldBoxes,
});

describe("wording renames (AC1)", () => {
  it("shows an override saved under the old key under the new one", () => {
    expect(renameCopyOverrides({ "staff.staff-form.save-profile": "Save staff", "nav.legacy": "Today" }, renames)).toEqual({
      "staff.staff-form.save": "Save staff",
      "nav.legacy": "Today",
    });
  });

  it("lets a row saved under the new key win", () => {
    expect(
      renameCopyOverrides({ "staff.staff-form.save-profile": "Old", "staff.staff-form.save": "New" }, renames),
    ).toEqual({ "staff.staff-form.save": "New" });
  });

  it("follows a chain and stops on a loop", () => {
    expect(resolveCopyKey("a.b.one", renames)).toBe("a.b.three");
    expect(["loop.a.x", "loop.a.y"]).toContain(resolveCopyKey("loop.a.x", renames));
    expect(copyAliases("a.b.three", renames).sort()).toEqual(["a.b.one", "a.b.two"]);
  });

  it("ships with no rename that points at itself", () => {
    expect(Object.entries(liveEditRenames.copy).filter(([from, to]) => from === to)).toEqual([]);
  });
});

describe("block renames", () => {
  it("moves a renamed block and field card to the new id on its page only", () => {
    const renamed = renameLayoutDoc(
      "events.detail",
      doc([block("notes"), block("files"), block("text-1", "text")], { "event-facts": { boxes: [] } }),
      renames,
    );
    expect(renamed.blocks.map((b) => b.id)).toEqual(["event-notes", "files", "text-1"]);
    expect(renameLayoutDoc("leads.detail", doc([block("notes")]), renames).blocks[0].id).toBe("notes");
    expect(Object.keys(renameLayoutDoc("leads.detail", doc([], { "old-facts": { boxes: [] } }), renames).fieldBoxes)).toEqual([
      "lead-facts",
    ]);
  });

  it("keeps a block already saved under the new id", () => {
    const renamed = renameLayoutDoc("events.detail", doc([{ ...block("notes"), x: 6, w: 6 }, block("event-notes")]), renames);
    expect(renamed.blocks).toEqual([block("event-notes")]);
  });
});

describe("orphans (AC3)", () => {
  const manifest: LiveEditManifest = {
    version: 1,
    copy: { "staff.staff-form.save": [], "nav.legacy": [] },
    copyPrefixes: ["labels.task-status."],
    layout: { "events.detail": { blocks: ["event-notes", "files"], fieldCards: ["event-facts"] } },
    tables: [],
  };

  it("finds rows and blocks no screen matches", () => {
    expect(
      findOrphans(
        {
          "staff.staff-form.save-profile": "Save staff",
          "nav.legacy": "Today",
          "labels.task-status.done": "Finished",
          "retired.screen.title": "Old",
        },
        [
          { pageKey: "events.detail", layout: doc([block("notes"), block("gone"), block("text-1", "text")], { "old-card": { boxes: [] } }) },
          { pageKey: "retired.page", layout: doc([block("list")]) },
        ],
        manifest,
        renames,
      ),
    ).toEqual({
      copy: [{ key: "retired.screen.title", text: "Old" }],
      blocks: [
        { pageKey: "events.detail", id: "gone", kind: "block" },
        { pageKey: "events.detail", id: "old-card", kind: "fieldCard" },
        { pageKey: "retired.page", id: "list", kind: "block" },
      ],
    });
  });

  it("calls a renamed row an orphan when the new key has its own row", () => {
    expect(
      findOrphans({ "staff.staff-form.save-profile": "Old", "staff.staff-form.save": "New" }, [], manifest, renames).copy,
    ).toEqual([{ key: "staff.staff-form.save-profile", text: "Old" }]);
  });

  it("deletes or moves an orphaned block", () => {
    const saved = doc([block("gone"), block("files")], { "old-card": { boxes: [] } });
    expect(withoutOrphan(saved, "gone").blocks.map((b) => b.id)).toEqual(["files"]);
    expect(Object.keys(withoutOrphan(saved, "old-card").fieldBoxes)).toEqual([]);
    expect(moveOrphan(saved, "gone", "files").blocks.map((b) => b.id)).toEqual(["files"]);
    expect(Object.keys(moveOrphan(saved, "old-card", "event-facts").fieldBoxes)).toEqual(["event-facts"]);
  });
});

describe("text checks", () => {
  it("trims line breaks but keeps spaces (AC6)", () => {
    expect(trimLineBreaks("Save Changes\n\n")).toBe("Save Changes");
    expect(trimLineBreaks("Add Position\n")).toBe("Add Position");
    expect(trimLineBreaks("\r\nStatus\n")).toBe("Status");
    expect(trimLineBreaks(" · automatic")).toBe(" · automatic");
    expect(trimLineBreaks("Line one\nline two")).toBe("Line one\nline two");
  });

  it("compares an override's placeholders with the current default (AC4)", () => {
    expect(placeholdersMatch("{count} leads", "{count} open leads")).toBe(true);
    expect(placeholdersMatch("{count} leads", "{total} leads")).toBe(false);
    expect(placeholdersMatch("{count} of {total}", "{count} leads")).toBe(false);
    expect(placeholdersMatch("Leads", "Open leads")).toBe(true);
  });
});
