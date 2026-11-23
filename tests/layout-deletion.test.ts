import { describe, expect, it } from "vitest";
import { emptyLayout, layoutDocSchema, layoutProblems, MAX_BLOCKS, MAX_CARDS, type LayoutDoc } from "../shared/layout";
import { changeDeletedItem, layoutItems, layoutLifecycleChanges } from "../shared/layout-deletion";
import { withBuiltins } from "../src/app/layout-state";
const deleted = { at: "2026-11-23T20:00:00.000Z", by: "Admin", name: "Facts" };
const builtin = { kind: "builtin" as const, id: "facts", x: 3, y: 7, w: 6, h: 9, style: { background: "#ffffff" }, visibleTo: ["admin" as const] };
const fixture = (): LayoutDoc => ({ ...emptyLayout(), blocks: [{ ...builtin, deleted }, { kind: "text", id: "note-1", x: 0, y: 20, w: 12, h: 2, variant: "note", text: "Keep me", deleted }],
  tables: { "leads.inbox.table": { columns: [{ key: "name", width: 240 }], deleted } }, headers: { "facts.title": { deleted } },
  fieldBoxes: { "lead-facts": { boxes: [{ id: "field-1", kind: "field", field: "name", x: 0, y: 0, w: 6, h: 2, deleted }, { id: "note-1", kind: "note", text: "Inner note", x: 0, y: 2, w: 12, h: 2, deleted }] } },
});
describe("layout deletion lifecycle", () => {
  it("restores the exact position, dimensions, styles and visibleTo without mutating the input", () => {
    const doc = fixture(); const restored = changeDeletedItem(doc, "block/facts", "restore");
    expect(restored.blocks[0]).toEqual(builtin); expect(doc.blocks[0].deleted).toEqual(deleted);
    expect(layoutLifecycleChanges(doc, restored)).toEqual([{ key: "block/facts", action: "restore" }]);
  });
  it("retains built-in tombstones across code merging and physically removes custom text", () => {
    const doc = changeDeletedItem(changeDeletedItem(fixture(), "block/facts", "permanent"), "block/note-1", "permanent");
    expect(doc.blocks).toEqual([{ ...builtin, removed: true }]);
    expect(withBuiltins(doc, [{ id: "facts", name: "Facts", w: 12, h: 8 }])).toEqual(doc.blocks);
    expect(layoutLifecycleChanges(fixture(), doc)).toEqual([{ key: "block/facts", action: "permanent-delete" }, { key: "block/note-1", action: "permanent-delete" }]);
    expect(changeDeletedItem(doc, "block/facts", "restore")).toBe(doc);
  });
  it("restores tables and headers, permanently removes custom inner text, retains field tombstones", () => {
    let doc = fixture();
    for (const key of ["table/leads.inbox.table", "header/facts.title"]) doc = changeDeletedItem(doc, key, "restore");
    expect(doc.tables["leads.inbox.table"]).toEqual({ columns: [{ key: "name", width: 240 }] });
    doc = changeDeletedItem(changeDeletedItem(doc, "field-box/lead-facts/field-1", "permanent"), "field-box/lead-facts/note-1", "permanent");
    expect(doc.fieldBoxes["lead-facts"].boxes).toHaveLength(1);
    expect(doc.fieldBoxes["lead-facts"].boxes[0].removed).toBe(true);
    expect(layoutItems(doc).filter((item) => item.state.deleted)).toHaveLength(2);
  });
  it("excludes deleted blocks and cards from active limits but still validates their content and metadata", () => {
    const doc = emptyLayout();
    doc.blocks = Array.from({ length: MAX_BLOCKS + MAX_CARDS }, (_, i) => ({ kind: "card", id: `card-${i}`, x: 0, y: 0, w: 6, h: 8, deleted,
      card: { title: "Card", source: { type: "list", list: "events" }, filters: [], limit: 10, display: { type: "table", columns: [{ key: "title" }] } } }));
    expect(layoutDocSchema.safeParse(doc).success).toBe(true);
    expect(layoutProblems("dashboard.home", doc)).toEqual([]);
    doc.blocks[0].removed = true;
    expect(layoutProblems("dashboard.home", doc)[0].message).toMatch(/Invalid deleted/);
    expect(layoutDocSchema.safeParse({ ...doc, headers: { title: { deleted: { ...deleted, at: "yesterday" } } } }).success).toBe(false);
  });
});
