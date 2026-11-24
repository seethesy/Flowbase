import { describe, expect, it } from "vitest";
import { emptyLayout, layoutDocSchema, layoutProblems, savedLayoutSchema, type LayoutBlock, type LayoutDoc } from "../../shared/layout";
import { renameLayoutDoc } from "../../shared/live-edit-renames";
import {
  addBlock,
  addTrack,
  apportion,
  asV2,
  codeDefaultGrid,
  convertV1,
  dragDivider,
  emptySlots,
  gridHeight,
  gridProblems,
  insertShare,
  keptPlace,
  keptTracks,
  mergeCells,
  MIN_SHARE,
  moveBlock,
  placementOf,
  removeShare,
  removeTrack,
  restoreBlock,
  setShare,
  SHARE_TOTAL,
  trackPixels,
  unmergeRegion,
  withCodeBlocks,
  type GridResult,
} from "../../shared/page-grid";

// The page grid model (FLOW-319): track math, editing operations, conversion
// of saved layouts and the schema's invariants; and the renderer's sizing
// helpers (FLOW-320).

const builtin = (id: string, x: number, y: number, w = 1, h = 1, extra: Partial<LayoutBlock> = {}): LayoutBlock =>
  ({ kind: "builtin", id, x, y, w, h, ...extra }) as LayoutBlock;
const grid = (cols: number[], rows: number[], blocks: LayoutBlock[], regions: LayoutDoc["grid"]["regions"] = []): LayoutDoc => ({
  ...emptyLayout(),
  grid: { cols, rows, regions },
  blocks,
});
const ok = (result: GridResult) => {
  if (!result.ok) throw new Error(`Refused: ${result.reason}`);
  return result;
};
const total = (shares: number[]) => shares.reduce((a, b) => a + b, 0);

describe("track math (AC3)", () => {
  it("dragging a divider changes only its two tracks and keeps their sum", () => {
    expect(dragDivider([3000, 7000], 0, 3500)).toEqual([3500, 6500]);
    expect(dragDivider([2000, 3000, 5000], 1, 4000)).toEqual([2000, 4000, 4000]);
    // Neither side goes under 1%.
    expect(dragDivider([3000, 7000], 0, -500)).toEqual([MIN_SHARE, 9900]);
    expect(dragDivider([3000, 7000], 0, 20000)).toEqual([9900, MIN_SHARE]);
  });

  it("an exact percentage rescales the other tracks proportionally", () => {
    expect(setShare([3333, 3333, 3334], 0, 3000)).toEqual({ ok: true, shares: [3000, 3500, 3500] });
    expect(setShare([2000, 2000, 6000], 2, 5000)).toEqual({ ok: true, shares: [2500, 2500, 5000] });
  });

  it("refuses a percentage that would push a track under 1%, with the reason", () => {
    expect(setShare([5000, 5000], 0, 50)).toMatchObject({ ok: false, reason: expect.stringMatching(/1%/) });
    expect(setShare([5000, 5000], 0, 9950)).toMatchObject({ ok: false });
    // The small track would scale under 1%.
    expect(setShare([150, 4850, 5000], 2, 9000)).toMatchObject({ ok: false, reason: expect.stringMatching(/Row 1/) });
    expect(setShare([10000], 0, 5000)).toMatchObject({ ok: false });
  });

  it("adding a track gives it 1/(n+1) and shrinks the others proportionally; removing gives its share back", () => {
    expect(insertShare([5000, 5000], 1)).toEqual({ ok: true, shares: [3334, 3333, 3333] });
    expect(insertShare([3000, 7000], 2)).toEqual({ ok: true, shares: [2000, 4667, 3333] });
    expect(removeShare([2000, 3000, 5000], 0)).toEqual({ ok: true, shares: [3750, 6250] });
    expect(removeShare([10000], 0)).toMatchObject({ ok: false });
  });

  it("splits by largest remainder, deterministically", () => {
    expect(apportion([3, 24], SHARE_TOTAL)).toEqual([1111, 8889]);
    expect(apportion([1, 1, 1], SHARE_TOTAL)).toEqual([3334, 3333, 3333]);
  });

  it("after 1000 random operations each axis totals exactly 10000 and every track is at least 1%", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let shares = [SHARE_TOTAL];
    for (let n = 0; n < 1000; n++) {
      const pick = Math.floor(random() * 4);
      const index = Math.floor(random() * shares.length);
      if (pick === 0) {
        const result = insertShare(shares, Math.floor(random() * (shares.length + 1)));
        if (result.ok) shares = result.shares;
      } else if (pick === 1 && shares.length > 1) {
        const result = removeShare(shares, index);
        if (result.ok) shares = result.shares;
      } else if (pick === 2 && index < shares.length - 1) {
        shares = dragDivider(shares, index, Math.floor(random() * SHARE_TOTAL));
      } else {
        const result = setShare(shares, index, Math.floor(random() * SHARE_TOTAL));
        if (result.ok) shares = result.shares;
      }
      expect(total(shares)).toBe(SHARE_TOTAL);
      expect(Math.min(...shares)).toBeGreaterThanOrEqual(MIN_SHARE);
    }
  });
});

describe("editing operations (AC4)", () => {
  // Two columns, two rows: a, b on top; c bottom left; bottom right empty.
  const base = () => grid([5000, 5000], [5000, 5000], [builtin("a", 0, 0), builtin("b", 1, 0), builtin("c", 0, 1)]);

  it("moves a block into an empty cell, describing the move", () => {
    const result = ok(moveBlock(base(), "c", 1, 1));
    expect(result.doc.blocks.find((b) => b.id === "c")).toMatchObject({ x: 1, y: 1, w: 1, h: 1 });
    expect(result.outcome.moves).toEqual([{ id: "c", from: { x: 0, y: 1, w: 1, h: 1 }, to: { x: 1, y: 1, w: 1, h: 1 } }]);
    expect(result.outcome.message).toBe("Move c to row 2, column 2.");
  });

  it("swaps with a block already in the destination", () => {
    const result = ok(moveBlock(base(), "a", 1, 0));
    expect(result.doc.blocks.map((b) => [b.id, b.x, b.y])).toEqual([["a", 1, 0], ["b", 0, 0], ["c", 0, 1]]);
    expect(result.outcome.message).toMatch(/^Swap a with b/);
  });

  it("merges cells holding no block or one block; refuses several, naming them, with no change", () => {
    const empty = ok(mergeCells(grid([5000, 5000], [5000, 5000], []), { x: 0, y: 0, w: 2, h: 2 }));
    expect(empty.doc.grid.regions).toEqual([{ x: 0, y: 0, w: 2, h: 2 }]);
    const one = ok(mergeCells(base(), { x: 1, y: 0, w: 1, h: 2 }));
    expect(one.doc.blocks.find((b) => b.id === "b")).toMatchObject({ x: 1, y: 0, w: 1, h: 2 });
    expect(one.outcome.message).toBe("Merge rows 1–2, column 2; b fills it.");
    const doc = base();
    const several = mergeCells(doc, { x: 0, y: 0, w: 2, h: 1 });
    expect(several).toMatchObject({ ok: false, reason: "Move a and b out first: a merged area holds one block." });
    expect(doc).toEqual(base());
  });

  it("absorbs an existing merged area the selection touches", () => {
    const doc = grid([3334, 3333, 3333], [10000], [], [{ x: 1, y: 0, w: 2, h: 1 }]);
    expect(ok(mergeCells(doc, { x: 0, y: 0, w: 2, h: 1 })).doc.grid.regions).toEqual([{ x: 0, y: 0, w: 3, h: 1 }]);
  });

  it("unmerges an occupied area; its block moves to the top-left cell", () => {
    const doc = grid([5000, 5000], [5000, 5000], [builtin("a", 0, 0, 2, 2)], [{ x: 0, y: 0, w: 2, h: 2 }]);
    const result = ok(unmergeRegion(doc, 1, 1));
    expect(result.doc.grid.regions).toEqual([]);
    expect(result.doc.blocks[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(unmergeRegion(result.doc, 0, 0)).toMatchObject({ ok: false });
  });

  it("removes a track a region crosses (it shrinks), and refuses one a block sits entirely in", () => {
    const doc = grid([5000, 5000], [3000, 3000, 4000], [builtin("tall", 0, 0, 1, 3), builtin("b", 1, 0)], [{ x: 0, y: 0, w: 1, h: 3 }]);
    const crossed = ok(removeTrack(doc, "rows", 2));
    expect(crossed.doc.grid.rows).toEqual([5000, 5000]);
    expect(crossed.doc.grid.regions).toEqual([{ x: 0, y: 0, w: 1, h: 2 }]);
    expect(crossed.doc.blocks[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 2 });
    expect(removeTrack(doc, "rows", 0)).toMatchObject({ ok: false, reason: "Move b out of row 1 first." });
    expect(removeTrack(doc, "cols", 1)).toMatchObject({ ok: false });
  });

  it("adds a track; a region spanning the insert point grows", () => {
    const doc = grid([5000, 5000], [5000, 5000], [builtin("tall", 0, 0, 1, 2)], [{ x: 0, y: 0, w: 1, h: 2 }]);
    const result = ok(addTrack(doc, "rows", 1));
    expect(result.doc.grid.rows).toEqual([3334, 3333, 3333]);
    expect(result.doc.grid.regions).toEqual([{ x: 0, y: 0, w: 1, h: 3 }]);
    expect(result.doc.blocks[0]).toMatchObject({ h: 3 });
  });

  it("adds a block into an empty cell, or into a new row at the bottom when none is empty", () => {
    const text: LayoutBlock = { kind: "text", id: "note-1", variant: "note", text: "Hi", x: 0, y: 0, w: 1, h: 1 };
    expect(ok(addBlock(base(), text, { x: 1, y: 1 })).doc.blocks.at(-1)).toMatchObject({ x: 1, y: 1 });
    expect(addBlock(base(), text, { x: 0, y: 0 })).toMatchObject({ ok: false });
    const full = grid([5000, 5000], [10000], [builtin("a", 0, 0), builtin("b", 1, 0)]);
    expect(emptySlots(full)).toEqual([]);
    const added = ok(addBlock(full, text, "bottom"));
    expect(added.doc.grid.rows).toEqual([5000, 5000]);
    expect(added.doc.grid.regions).toEqual([{ x: 0, y: 1, w: 2, h: 1 }]);
    expect(added.doc.blocks.at(-1)).toMatchObject({ x: 0, y: 1, w: 2, h: 1 });
  });

  it("restores to the last place when it's free, else asks for a place (FLOW-319 A3)", () => {
    const deleted = { at: "2026-11-24T10:00:00.000Z", by: "Admin", name: "C" };
    const doc = grid([5000, 5000], [5000, 5000], [builtin("a", 0, 0), builtin("b", 1, 0), builtin("c", 0, 1, 1, 1, { deleted })]);
    const back = ok(restoreBlock(doc, "c"));
    expect(back.doc.blocks[2]).toEqual(builtin("c", 0, 1));
    const taken = ok(moveBlock(doc, "a", 0, 1)).doc;
    const asked = restoreBlock(taken, "c");
    expect(asked).toMatchObject({ ok: false, needsPlace: true });
    expect(ok(restoreBlock(taken, "c", { x: 1, y: 1 })).doc.blocks[2]).toMatchObject({ x: 1, y: 1 });
    expect(ok(restoreBlock(taken, "c", "bottom")).doc.grid.rows).toHaveLength(3);
    const hidden = grid([10000], [10000], [builtin("h", 0, 0, 1, 1, { hidden: true })]);
    expect(ok(restoreBlock(hidden, "h")).doc.blocks[0]).not.toHaveProperty("hidden");
  });
});

describe("conversion of saved layouts (AC5)", () => {
  const v1 = (blocks: LayoutBlock[]) => ({ version: 1 as const, blocks, tables: {}, fieldBoxes: {} });

  it("Inventory Bar: Filters 12×3 above List 12×24 becomes one column and rows of 11.11% and 88.89%", () => {
    const doc = convertV1(v1([builtin("filters", 0, 0, 12, 3), builtin("list", 0, 3, 12, 24)]));
    expect(doc.grid).toEqual({ cols: [10000], rows: [1111, 8889], regions: [] });
    expect(doc.blocks).toEqual([builtin("filters", 0, 0), builtin("list", 0, 1)]);
  });

  it("two 6-wide blocks side by side become two 50% columns", () => {
    const doc = convertV1(v1([builtin("a", 0, 0, 6, 8), builtin("b", 6, 0, 6, 8)]));
    expect(doc.grid.cols).toEqual([5000, 5000]);
    expect(doc.blocks).toEqual([builtin("a", 0, 0), builtin("b", 1, 0)]);
  });

  it("turns gaps into empty cells and multi-track blocks into merged areas", () => {
    const doc = convertV1(v1([builtin("left", 0, 0, 6, 4), builtin("wide", 0, 6, 12, 4)]));
    expect(doc.grid.cols).toEqual([5000, 5000]);
    expect(doc.grid.rows).toEqual([4000, 2000, 4000]);
    expect(doc.grid.regions).toEqual([{ x: 0, y: 2, w: 2, h: 1 }]);
    expect(emptySlots(doc)).toEqual([{ x: 1, y: 0, w: 1, h: 1 }, { x: 0, y: 1, w: 1, h: 1 }, { x: 1, y: 1, w: 1, h: 1 }]);
    expect(gridProblems(doc)).toEqual([]);
  });

  it("moves a block that overlaps an earlier one into a new row at the bottom", () => {
    const doc = convertV1(v1([builtin("a", 0, 0, 12, 4), builtin("b", 0, 2, 12, 4)]));
    expect(doc.blocks).toEqual([builtin("a", 0, 0), builtin("b", 0, 1)]);
    expect(gridProblems(doc)).toEqual([]);
  });

  it("keeps a restore hint for hidden and deleted blocks; removed ones have no place; drops Fit content", () => {
    const deleted = { at: "2026-11-24T10:00:00.000Z", by: "Admin", name: "Notes" };
    const doc = convertV1(v1([
      builtin("a", 0, 0, 6, 4, { fit: true, hidePhone: true }),
      builtin("b", 6, 0, 6, 4, { hidden: true }),
      builtin("c", 6, 0, 6, 4, { deleted }),
      builtin("gone", 0, 0, 12, 4, { removed: true }),
    ]));
    expect(doc.blocks[0]).toEqual(builtin("a", 0, 0, 1, 1, { hidePhone: true }));
    // Columns come from the shown block's edges (0, 6, 12): the hints sit in column 2.
    expect(doc.grid.cols).toEqual([5000, 5000]);
    expect(doc.blocks[1]).toMatchObject({ x: 1, y: 0, w: 1, h: 1, hidden: true });
    expect(doc.blocks[2]).toMatchObject({ x: 1, y: 0, w: 1, h: 1, deleted });
    expect(placementOf(doc.blocks[3])).toBeNull();
  });

  it("is idempotent, and FLOW-277 renames still apply", () => {
    const doc = convertV1(v1([builtin("old-details", 0, 0, 12, 4), builtin("notes", 0, 4, 12, 4)]));
    expect(asV2(doc)).toBe(doc);
    expect(asV2(asV2(doc))).toEqual(doc);
    const renames = { copy: {}, blocks: { "events.detail/old-details": "details" }, removed: { copy: [], blocks: [] } };
    expect(renameLayoutDoc("events.detail", doc, renames).blocks.map((b) => b.id)).toEqual(["details", "notes"]);
    expect(renameLayoutDoc("events.detail", v1([builtin("old-details", 0, 0, 12, 4)]), renames).blocks[0].id).toBe("details");
  });

  it("caps a layout with more row edges than 40 rows by joining rows where no block starts", () => {
    const blocks = Array.from({ length: 30 }, (_, n) => builtin(`b-${n}`, n % 2 ? 6 : 0, n * 3, 6, 2));
    const doc = convertV1(v1(blocks));
    expect(doc.grid.rows.length).toBeLessThanOrEqual(40);
    expect(gridProblems(doc)).toEqual([]);
  });

  it("the code default is one column with a row per built-in", () => {
    expect(codeDefaultGrid([{ id: "filters", h: 3 }, { id: "list", h: 24 }]).grid).toEqual({ cols: [10000], rows: [1111, 8889], regions: [] });
  });

  it("a built-in the code dropped leaves its cell empty when the code's ids are known", () => {
    const doc = grid([10000], [5000, 5000], [builtin("a", 0, 0), builtin("dropped", 0, 1)]);
    const merged = withCodeBlocks(doc, [{ id: "a", h: 8 }], ["a"]);
    expect(merged.blocks.map((b) => b.id)).toEqual(["a"]);
    expect(merged.grid.rows).toEqual([5000, 5000]);
  });

  it("the client schema reads either version as a page grid", () => {
    const saved = savedLayoutSchema.parse({ pageKey: "inventory.bar", updatedAt: "2026-11-24", updatedBy: null,
      layout: v1([builtin("filters", 0, 0, 12, 3), builtin("list", 0, 3, 12, 24)]) });
    expect(saved?.layout.version).toBe(2);
    expect(saved?.layout.grid.rows).toEqual([1111, 8889]);
  });
});

describe("schema and server invariants (AC1)", () => {
  const doc = grid([5000, 5000], [10000], [builtin("notes", 0, 0)]);
  const paths = (value: LayoutDoc) => layoutProblems("leads.detail", value).map((problem) => problem.path);

  it("accepts a valid grid", () => {
    expect(paths(doc)).toEqual([]);
    expect(layoutDocSchema.safeParse(doc).success).toBe(true);
  });

  it("names the path of each broken invariant, on the server and in the client schema", () => {
    const cases: [LayoutDoc, string][] = [
      [{ ...doc, grid: { ...doc.grid, cols: [5000, 4999] } }, "grid.cols"],
      [{ ...doc, grid: { ...doc.grid, cols: [9901, 99] } }, "grid.cols.1"],
      [{ ...doc, grid: { ...doc.grid, cols: [...Array(12).fill(769), 772] } }, "grid.cols"],
      [{ ...doc, grid: { ...doc.grid, rows: [...Array(40).fill(243), 280] } }, "grid.rows"],
      [{ ...doc, grid: { ...doc.grid, rows: [5000, 5000], regions: [{ x: 0, y: 0, w: 2, h: 1 }, { x: 0, y: 0, w: 1, h: 2 }] }, blocks: [] }, "grid.regions.1"],
      [{ ...doc, grid: { ...doc.grid, regions: [{ x: 0, y: 0, w: 2, h: 2 }] }, blocks: [] }, "grid.regions.0"],
      [{ ...doc, blocks: [builtin("notes", 0, 0), builtin("event-notes", 0, 0)] }, "blocks.1"],
      [{ ...doc, grid: { ...doc.grid, regions: [{ x: 0, y: 0, w: 2, h: 1 }] }, blocks: [builtin("notes", 1, 0)] }, "blocks.0"],
    ];
    for (const [value, path] of cases) {
      expect(paths(value), path).toContain(path);
      const parsed = layoutDocSchema.safeParse(value);
      expect(parsed.success, path).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.path.join(".")), path).toContain(path);
    }
  });

  it("ignores the placement of hidden, deleted and removed blocks", () => {
    expect(paths({ ...doc, blocks: [builtin("notes", 0, 0), builtin("event-notes", 0, 0, 1, 1, { hidden: true })] })).toEqual([]);
  });
});

describe("rendering (FLOW-320)", () => {
  it("sizes tracks as (usable size − gaps) × share", () => {
    expect(trackPixels(1012, [2500, 7500], 12)).toEqual([250, 750]);
    expect(trackPixels(500, [10000], 12)).toEqual([500]);
  });

  it("fills the available height, with a 480px floor and no row under 56px", () => {
    expect(gridHeight(700.6)).toBe(700);
    expect(gridHeight(300)).toBe(480);
    expect(gridHeight(700, [3000, 7000])).toBe(700);
    // 17 equal rows: 17 × 56px plus 16 gaps.
    expect(gridHeight(700, Array(17).fill(100))).toBe(17 * 56 + 16 * 12);
  });

  it("collapses a track whose only occupants are absent and keeps tracks authored empty", () => {
    const g = { cols: [5000, 5000], rows: [3000, 3000, 4000], regions: [] };
    const shown = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 1, w: 2, h: 1 }];
    const present = [{ x: 0, y: 0, w: 1, h: 1 }];
    const kept = keptTracks(g, shown, present);
    // Row 2 and column 2 held only an absent block; row 3 was authored empty.
    expect(kept).toEqual({ cols: [0], rows: [0, 2] });
    expect(keptTracks(g, shown, [...present, { x: 1, y: 1, w: 1, h: 1 }])).toEqual({ cols: [0, 1], rows: [0, 1, 2] });
    expect(keptPlace({ x: 0, y: 0, w: 1, h: 1 }, kept)).toEqual({ gridColumn: "1 / span 1", gridRow: "1 / span 1" });
  });
});
