import type { LayoutBlock, LayoutBox, LayoutDoc, LayoutDocV1, LayoutDocV2 } from "./layout";

// The page grid (FLOW-319): a page's blocks sit on explicit rows and columns,
// with merged rectangular regions. Each shown block fills one cell or one
// region. Sizes are integers in basis points (1% = 100). Columns are shares of
// the content width and total exactly 10000. Each row is its own height, a
// percentage of the screen height (FLOW-357): 5% to 200%, with no total, so
// changing one row never resizes another. Pure functions only: the schema
// (shared/layout.ts), the renderer (FLOW-320) and the editor (FLOW-321) build
// on them.
//
// Only type imports from ./layout, which imports this file's functions.

export const SHARE_TOTAL = 10000;
export const MIN_SHARE = 100;
export const MAX_GRID_COLUMNS = 12;
export const MAX_GRID_ROWS = 40;
// A row's height in basis points of the screen height (FLOW-357).
export const MIN_ROW = 500;
export const MAX_ROW = 20000;
// A new row: 20% of the screen height.
export const NEW_ROW = 2000;
// Rows move in steps of 0.1%.
export const ROW_STEP = 10;
// The old (v1) grid: 12 columns of 24px rows.
const V1_COLUMNS = 12;

export type Rect = { x: number; y: number; w: number; h: number };
export type PageGridSpec = { cols: number[]; rows: number[]; regions: Rect[] };
export type Axis = "cols" | "rows";
export type Refusal = { ok: false; reason: string; highlight?: Rect[]; needsPlace?: boolean };
export type SharesResult = { ok: true; shares: number[] } | Refusal;
export type Move = { id: string; from: Rect | null; to: Rect };
export type Outcome = { message: string; moves: Move[]; highlight: Rect[] };
export type GridResult = { ok: true; doc: LayoutDoc; outcome: Outcome } | Refusal;
// A block's name in outcome messages.
export type Names = (id: string) => string;
export type Target = { x: number; y: number } | "bottom";

const refuse = (reason: string, extra: Partial<Refusal> = {}): Refusal => ({ ok: false, reason, ...extra });
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const plainName: Names = (id) => id;

// ---- Rectangles ---------------------------------------------------------------

export const rectOf = ({ x, y, w, h }: Rect): Rect => ({ x, y, w, h });
export const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
export const containsCell = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const within = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const bounds = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const insideGrid = (grid: PageGridSpec, r: Rect) =>
  r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= grid.cols.length && r.y + r.h <= grid.rows.length;
const start = (r: Rect, axis: Axis) => (axis === "cols" ? r.x : r.y);
const span = (r: Rect, axis: Axis) => (axis === "cols" ? r.w : r.h);
const along = <R extends Rect>(r: R, axis: Axis, from: number, length: number): R =>
  axis === "cols" ? { ...r, x: from, w: length } : { ...r, y: from, h: length };

// "row 2, column 1" or "rows 1–2, columns 1–3", for messages and labels.
const range = (noun: string, from: number, length: number) =>
  length === 1 ? `${noun} ${from + 1}` : `${noun}s ${from + 1}–${from + length}`;
export const placeName = (r: Rect) => `${range("row", r.y, r.h)}, ${range("column", r.x, r.w)}`;
export const trackNoun = (axis: Axis) => (axis === "cols" ? "column" : "row");
export const trackName = (axis: Axis, index: number) => `${axis === "cols" ? "Column" : "Row"} ${index + 1}`;
const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// ---- Blocks -------------------------------------------------------------------

const gone = (block: LayoutBlock) => Boolean(block.deleted || block.removed);
// Shown on the grid: not deleted, removed or hidden. Hidden and deleted blocks
// keep their last placement only as a restore hint.
export const blockShown = (block: LayoutBlock) => !gone(block) && !(block.kind === "builtin" && block.hidden);
// A block's place on the grid; null for a permanently removed one.
export const placementOf = (block: LayoutBlock): Rect | null => (block.removed ? null : rectOf(block));

// ---- Track math -----------------------------------------------------------------

// Splits `total` across `weights` proportionally in steps of `unit`; the rounding
// residue goes to the largest remainders, ties to the earlier track. Integer
// arithmetic throughout, so the result always totals exactly `total`.
export function apportion(weights: number[], total: number, unit = 1): number[] {
  if (!weights.length) return [];
  const steps = Math.round(total / unit);
  const base = sum(weights) > 0 ? weights : weights.map(() => 1);
  const whole = sum(base);
  const floors = base.map((weight) => Math.floor((weight * steps) / whole));
  const order = base
    .map((weight, index) => ({ index, rest: weight * steps - floors[index] * whole }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  // Flooring leaves fewer steps than there are tracks to hand out.
  for (let left = steps - sum(floors), k = 0; left > 0; left--, k++) floors[order[k % order.length].index] += 1;
  return floors.map((count) => count * unit);
}

// Raises tracks under 1% to 1%, taking the difference from the others
// proportionally (conversion of very thin v1 rows).
export function withMinimum(shares: number[]): number[] {
  const fixed = new Set<number>();
  let next = shares;
  for (;;) {
    const low = next.findIndex((share, index) => share < MIN_SHARE && !fixed.has(index));
    if (low === -1) return next;
    for (const [index, share] of next.entries()) if (share < MIN_SHARE) fixed.add(index);
    const free = next.map((_, index) => index).filter((index) => !fixed.has(index));
    const spread = apportion(free.map((index) => shares[index]), SHARE_TOTAL - MIN_SHARE * fixed.size);
    next = next.map((_, index) => (fixed.has(index) ? MIN_SHARE : spread[free.indexOf(index)]));
  }
}

// A row's height within its limits, to the 0.1% step (FLOW-357); resizing a
// row changes only that row.
export const clampRow = (value: number) => Math.min(MAX_ROW, Math.max(MIN_ROW, Math.round(value / ROW_STEP) * ROW_STEP));
export function resizeRow(rows: number[], index: number, value: number): number[] {
  const next = [...rows];
  next[index] = clampRow(value);
  return next;
}

// Dragging the divider after column `index`: only it and the next column
// change, their combined share stays, and neither goes under 1%.
export function dragDivider(shares: number[], index: number, first: number): number[] {
  const pair = shares[index] + shares[index + 1];
  const value = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, Math.round(first)));
  const next = [...shares];
  next[index] = value;
  next[index + 1] = pair - value;
  return next;
}

// An exact size for one track. A row takes it alone, between 5% and 200% of
// the screen height (FLOW-357). A column's share: the others scale
// proportionally to absorb the difference, to the nearest 0.1% when that totals
// exactly (so 30% of three equal columns gives 30/35/35), else to the basis
// point.
export function setShare(shares: number[], index: number, value: number, axis: Axis = "rows"): SharesResult {
  const target = Math.round(value);
  const name = trackName(axis, index);
  if (axis === "rows") {
    if (target < MIN_ROW) return refuse(`${name} can't be under ${MIN_ROW / 100}% of the screen height.`);
    if (target > MAX_ROW) return refuse(`${name} can't be over ${MAX_ROW / 100}% of the screen height.`);
    const next = [...shares];
    next[index] = target;
    return { ok: true, shares: next };
  }
  if (shares.length === 1)
    return target === SHARE_TOTAL ? { ok: true, shares: [SHARE_TOTAL] } : refuse(`A single ${trackNoun(axis)} is always 100%.`);
  if (target < MIN_SHARE) return refuse(`${name} can't be smaller than 1%.`);
  const rest = SHARE_TOTAL - target;
  const others = shares.filter((_, k) => k !== index);
  if (rest < MIN_SHARE * others.length) return refuse(`That leaves less than 1% for another ${trackNoun(axis)}.`);
  let scaled = apportion(others, rest, rest % 10 === 0 ? 10 : 1);
  if (scaled.some((share) => share < MIN_SHARE)) scaled = apportion(others, rest);
  const small = scaled.findIndex((share) => share < MIN_SHARE);
  if (small !== -1) {
    const original = small < index ? small : small + 1;
    return refuse(`That would make ${trackName(axis, original)} smaller than 1%.`);
  }
  const next = [...scaled];
  next.splice(index, 0, target);
  return { ok: true, shares: next };
}

// A new row at position `at` is 20% of the screen height and leaves the others
// alone (FLOW-357). A new column gets 1/(n+1); the others shrink proportionally.
export function insertShare(shares: number[], at: number, axis: Axis = "rows"): SharesResult {
  const max = axis === "cols" ? MAX_GRID_COLUMNS : MAX_GRID_ROWS;
  if (shares.length >= max) return refuse(`A page grid holds at most ${max} ${trackNoun(axis)}s.`);
  if (axis === "rows") return { ok: true, shares: [...shares.slice(0, at), NEW_ROW, ...shares.slice(at)] };
  const weights = shares.map((share) => share * shares.length);
  weights.splice(at, 0, SHARE_TOTAL);
  const next = apportion(weights, SHARE_TOTAL);
  if (next.some((share) => share < MIN_SHARE))
    return refuse(`There isn't room for another ${trackNoun(axis)}: a ${trackNoun(axis)} would go under 1%.`);
  return { ok: true, shares: next };
}

// A removed row leaves the others alone (FLOW-357); a removed column's share
// goes to the others proportionally.
export function removeShare(shares: number[], at: number, axis: Axis = "rows"): SharesResult {
  if (shares.length === 1) return refuse(`A page grid keeps at least one ${trackNoun(axis)}.`);
  if (axis === "rows") return { ok: true, shares: shares.filter((_, k) => k !== at) };
  return { ok: true, shares: apportion(shares.filter((_, k) => k !== at), SHARE_TOTAL) };
}

// ---- Slots: cells and merged regions ----------------------------------------------

// The slot holding cell (x, y): its merged region, or the cell itself.
export function slotAt(grid: PageGridSpec, x: number, y: number): Rect {
  return grid.regions.find((region) => containsCell(region, x, y)) ?? { x, y, w: 1, h: 1 };
}
// Whether a rectangle is exactly one slot: a merged region, or a cell outside every region.
export function isSlot(grid: PageGridSpec, r: Rect) {
  if (!insideGrid(grid, r)) return false;
  if (grid.regions.some((region) => sameRect(region, r))) return true;
  return r.w === 1 && r.h === 1 && !grid.regions.some((region) => containsCell(region, r.x, r.y));
}
// Every slot, top to bottom then left to right.
export function allSlots(grid: PageGridSpec): Rect[] {
  const result: Rect[] = [];
  for (let y = 0; y < grid.rows.length; y++)
    for (let x = 0; x < grid.cols.length; x++) {
      const slot = slotAt(grid, x, y);
      if (slot.x === x && slot.y === y) result.push(rectOf(slot));
    }
  return result;
}
export const occupant = (doc: LayoutDoc, r: Rect) => doc.blocks.find((block) => blockShown(block) && sameRect(block, r));
export const emptySlots = (doc: LayoutDoc) => allSlots(doc.grid).filter((slot) => !occupant(doc, slot));

// ---- Validation (schema and server, FLOW-319 AC1) ------------------------------------

export type GridProblem = { path: string; message: string };

export function gridProblems(doc: LayoutDoc): GridProblem[] {
  const problems: GridProblem[] = [];
  const { grid } = doc;
  const axis = (key: Axis, max: number) => {
    const shares = grid[key];
    const noun = trackNoun(key);
    if (shares.length < 1 || shares.length > max)
      problems.push({ path: `grid.${key}`, message: `A page grid has 1 to ${max} ${noun}s.` });
    shares.forEach((share, index) => {
      const path = `grid.${key}.${index}`;
      if (key === "rows") {
        if (!Number.isInteger(share) || share < MIN_ROW)
          problems.push({ path, message: `${trackName(key, index)} is under ${MIN_ROW / 100}% of the screen height.` });
        else if (share > MAX_ROW)
          problems.push({ path, message: `${trackName(key, index)} is over ${MAX_ROW / 100}% of the screen height.` });
      } else if (!Number.isInteger(share) || share < MIN_SHARE)
        problems.push({ path, message: `${trackName(key, index)} is under 1%.` });
    });
    // Rows have no total (FLOW-357).
    if (key === "cols" && sum(shares) !== SHARE_TOTAL)
      problems.push({ path: `grid.${key}`, message: `The ${noun}s must total 100%.` });
  };
  axis("cols", MAX_GRID_COLUMNS);
  axis("rows", MAX_GRID_ROWS);
  grid.regions.forEach((region, index) => {
    const path = `grid.regions.${index}`;
    if (!insideGrid(grid, region)) problems.push({ path, message: "A merged area must sit inside the grid." });
    else if (region.w * region.h < 2) problems.push({ path, message: "A merged area spans two or more cells." });
    if (grid.regions.some((other, k) => k < index && intersects(other, region)))
      problems.push({ path, message: "Merged areas can't overlap." });
  });
  const taken = new Map<string, string>();
  doc.blocks.forEach((block, index) => {
    if (!blockShown(block)) return;
    const path = `blocks.${index}`;
    if (!insideGrid(grid, block)) {
      problems.push({ path, message: `"${block.id}" sits outside the grid.` });
      return;
    }
    const region = grid.regions.find((r) => containsCell(r, block.x, block.y));
    if (region && (region.x !== block.x || region.y !== block.y))
      problems.push({ path, message: `"${block.id}" sits inside a merged area but not at its top-left cell.` });
    else if (region ? !sameRect(region, block) : block.w !== 1 || block.h !== 1)
      problems.push({ path, message: `"${block.id}" must fill exactly one cell or merged area.` });
    const key = `${block.x},${block.y}`;
    const other = taken.get(key);
    if (other) problems.push({ path, message: `"${block.id}" and "${other}" share a cell.` });
    taken.set(key, block.id);
  });
  return problems;
}

// ---- Editing operations (FLOW-319 12–18) -------------------------------------------

const withBlocks = (doc: LayoutDoc, blocks: LayoutBlock[], grid = doc.grid): LayoutDoc => ({ ...doc, grid, blocks });
const findShown = (doc: LayoutDoc, id: string) => doc.blocks.find((block) => block.id === id && blockShown(block));
const place = <B extends LayoutBlock>(block: B, r: Rect): B => ({ ...block, ...rectOf(r) });

// Place or move a block into a cell or region; an occupied one swaps.
export function moveBlock(doc: LayoutDoc, id: string, x: number, y: number, names: Names = plainName): GridResult {
  const block = findShown(doc, id);
  if (!block) return refuse("That block isn't on the grid.");
  if (!insideGrid(doc.grid, { x, y, w: 1, h: 1 })) return refuse("That place is outside the grid.");
  const target = slotAt(doc.grid, x, y);
  const from = rectOf(block);
  if (sameRect(target, from)) return refuse(`${names(id)} is already there.`, { highlight: [target] });
  const other = occupant(doc, target);
  const blocks = doc.blocks.map((b) => (b === block ? place(b, target) : b === other ? place(b, from) : b));
  const moves: Move[] = [{ id, from, to: target }, ...(other ? [{ id: other.id, from: target, to: from }] : [])];
  const message = other
    ? `Swap ${names(id)} with ${names(other.id)}: ${names(id)} goes to ${placeName(target)}, ${names(other.id)} to ${placeName(from)}.`
    : `Move ${names(id)} to ${placeName(target)}.`;
  return { ok: true, doc: withBlocks(doc, blocks), outcome: { message, moves, highlight: [target, ...(other ? [from] : [])] } };
}

// Merge a rectangle of cells into one region, absorbing any region it touches.
// A merged region holds one block: with several inside, the merge is refused
// (FLOW-319 A1) and the blocks to move out are named.
export function mergeCells(doc: LayoutDoc, area: Rect, names: Names = plainName): GridResult {
  if (!insideGrid(doc.grid, area)) return refuse("Pick cells inside the grid.");
  let merged = rectOf(area);
  for (let changed = true; changed; ) {
    changed = false;
    for (const region of doc.grid.regions)
      if (intersects(region, merged) && !within(merged, region)) {
        merged = bounds(merged, region);
        changed = true;
      }
  }
  if (merged.w * merged.h < 2) return refuse("Pick two or more cells to merge.", { highlight: [merged] });
  if (doc.grid.regions.some((region) => sameRect(region, merged))) return refuse("Those cells are already merged.", { highlight: [merged] });
  const inside = doc.blocks.filter((block) => blockShown(block) && intersects(block, merged));
  if (inside.length > 1)
    return refuse(`Move ${listNames(inside.map((block) => names(block.id)))} out first: a merged area holds one block.`, {
      highlight: inside.map(rectOf),
    });
  const regions = [...doc.grid.regions.filter((region) => !within(merged, region)), merged];
  const blocks = doc.blocks.map((block) => (block === inside[0] ? place(block, merged) : block));
  const message = inside[0]
    ? `Merge ${placeName(merged)}; ${names(inside[0].id)} fills it.`
    : `Merge ${placeName(merged)} into one area.`;
  return {
    ok: true,
    doc: withBlocks(doc, blocks, { ...doc.grid, regions }),
    outcome: { message, moves: inside[0] ? [{ id: inside[0].id, from: rectOf(inside[0]), to: merged }] : [], highlight: [merged] },
  };
}

// Unmerge the region holding cell (x, y); its block moves to the top-left cell.
export function unmergeRegion(doc: LayoutDoc, x: number, y: number, names: Names = plainName): GridResult {
  const region = doc.grid.regions.find((r) => containsCell(r, x, y));
  if (!region) return refuse("That cell isn't merged.");
  const corner = { x: region.x, y: region.y, w: 1, h: 1 };
  const inside = occupant(doc, region);
  const blocks = doc.blocks.map((block) => (block === inside ? place(block, corner) : block));
  const regions = doc.grid.regions.filter((r) => r !== region);
  const message = inside
    ? `Unmerge ${placeName(region)}; ${names(inside.id)} moves to ${placeName(corner)}.`
    : `Unmerge ${placeName(region)}.`;
  return {
    ok: true,
    doc: withBlocks(doc, blocks, { ...doc.grid, regions }),
    outcome: { message, moves: inside ? [{ id: inside.id, from: rectOf(region), to: corner }] : [], highlight: [region] },
  };
}

// Shifts a rectangle for a track inserted at `at`: a rectangle spanning the
// insert point grows to include the new track.
const shiftForInsert = <R extends Rect>(r: R, axis: Axis, at: number): R => {
  const s = start(r, axis);
  const n = span(r, axis);
  if (s >= at) return along(r, axis, s + 1, n);
  if (s < at && at < s + n) return along(r, axis, s, n + 1);
  return r;
};

// Add a track at position `at` (0 = before the first, n = after the last).
export function addTrack(doc: LayoutDoc, axis: Axis, at: number): GridResult {
  const shares = insertShare(doc.grid[axis], at, axis);
  if (!shares.ok) return shares;
  const regions = doc.grid.regions.map((region) => shiftForInsert(region, axis, at));
  const blocks = doc.blocks.map((block) => (block.removed ? block : shiftForInsert(block, axis, at)));
  const grid = { ...doc.grid, [axis]: shares.shares, regions };
  const added = axis === "cols" ? { x: at, y: 0, w: 1, h: grid.rows.length } : { x: 0, y: at, w: grid.cols.length, h: 1 };
  const noun = trackNoun(axis);
  return {
    ok: true,
    doc: withBlocks(doc, blocks, grid),
    outcome: {
      message:
        axis === "rows"
          ? `Add row ${at + 1} at ${NEW_ROW / 100}% of the screen height; the other rows keep theirs.`
          : `Add ${noun} ${at + 1}; the other ${noun}s shrink to make room.`,
      moves: [],
      highlight: [added],
    },
  };
}

// Remove a track; a column's share goes to the others, the other rows keep
// their heights. Regions that cross it shrink. A
// block that sits only in it must move first (FLOW-319 A2).
export function removeTrack(doc: LayoutDoc, axis: Axis, index: number, names: Names = plainName): GridResult {
  const count = doc.grid[axis].length;
  const track = axis === "cols" ? { x: index, y: 0, w: 1, h: doc.grid.rows.length } : { x: 0, y: index, w: doc.grid.cols.length, h: 1 };
  const inside = doc.blocks.filter((block) => blockShown(block) && start(block, axis) === index && span(block, axis) === 1);
  if (count > 1 && inside.length)
    return refuse(`Move ${listNames(inside.map((block) => names(block.id)))} out of ${trackName(axis, index).toLowerCase()} first.`, {
      highlight: inside.map(rectOf),
    });
  const shares = removeShare(doc.grid[axis], index, axis);
  if (!shares.ok) return shares;
  const shrink = <R extends Rect>(r: R): R => {
    const s = start(r, axis);
    const n = span(r, axis);
    if (s > index) return along(r, axis, s - 1, n);
    if (s <= index && index < s + n) return along(r, axis, n > 1 ? s : Math.min(s, count - 2), Math.max(1, n - 1));
    return r;
  };
  const regions = doc.grid.regions
    .filter((region) => !(start(region, axis) === index && span(region, axis) === 1))
    .map(shrink)
    .filter((region) => region.w * region.h >= 2);
  const crossing = doc.blocks.filter((block) => blockShown(block) && intersects(block, track));
  const blocks = doc.blocks.map((block) => (block.removed ? block : shrink(block)));
  const message = crossing.length
    ? `Remove ${trackName(axis, index).toLowerCase()}; ${listNames(crossing.map((block) => names(block.id)))} ${crossing.length > 1 ? "shrink" : "shrinks"}.`
    : `Remove ${trackName(axis, index).toLowerCase()}.`;
  return { ok: true, doc: withBlocks(doc, blocks, { ...doc.grid, [axis]: shares.shares, regions }), outcome: { message, moves: [], highlight: [track] } };
}

// Puts a block (new, or restored) into an empty slot, or into a new row at the
// bottom spanning every column. Replaces a block of the same id in place.
function putBlock(doc: LayoutDoc, block: LayoutBlock, target: Target, names: Names, verb: string): GridResult {
  let base = doc;
  let slot: Rect;
  if (target === "bottom") {
    const added = addTrack(doc, "rows", doc.grid.rows.length);
    if (!added.ok) return added;
    base = added.doc;
    slot = { x: 0, y: doc.grid.rows.length, w: base.grid.cols.length, h: 1 };
    if (slot.w > 1) base = { ...base, grid: { ...base.grid, regions: [...base.grid.regions, slot] } };
  } else {
    if (!insideGrid(doc.grid, { ...target, w: 1, h: 1 })) return refuse("That place is outside the grid.");
    slot = slotAt(doc.grid, target.x, target.y);
    const other = occupant(doc, slot);
    if (other && other.id !== block.id) return refuse(`That cell holds ${names(other.id)}. Pick an empty one.`, { highlight: [slot] });
  }
  const placed = place(block, slot);
  const exists = base.blocks.some((b) => b.id === block.id);
  const blocks = exists ? base.blocks.map((b) => (b.id === block.id ? placed : b)) : [...base.blocks, placed];
  return {
    ok: true,
    doc: withBlocks(base, blocks),
    outcome: {
      message: `${names(block.id)} ${verb} ${target === "bottom" ? "a new row at the bottom" : placeName(slot)}.`,
      moves: [{ id: block.id, from: null, to: slot }],
      highlight: [slot],
    },
  };
}

// Add a new block (Add card, Add text) into a chosen empty slot, or a new row
// at the bottom.
export function addBlock(doc: LayoutDoc, block: LayoutBlock, target: Target, names: Names = plainName): GridResult {
  return putBlock(doc, block, target, names, "goes into");
}

// Show a hidden block or restore a deleted one: to its last place when that
// is still one empty slot, else to the place the Admin picks (FLOW-319 A3).
export function restoreBlock(doc: LayoutDoc, id: string, target?: Target, names: Names = plainName): GridResult {
  const block = doc.blocks.find((b) => b.id === id);
  if (!block || block.removed) return refuse("That block can't be restored.");
  const restored = { ...block } as LayoutBlock & { hidden?: boolean };
  delete restored.hidden;
  delete restored.deleted;
  if (target) return putBlock(doc, restored, target, names, "returns to");
  const hint = rectOf(block);
  if (isSlot(doc.grid, hint) && !occupant(doc, hint)) return putBlock(doc, restored, hint, names, "returns to");
  return refuse(`${names(id)}'s last place is taken or gone. Pick an empty cell, or a new row at the bottom.`, { needsPlace: true });
}

// ---- Code default, new built-ins and conversion (FLOW-319 19–21) ----------------------

export type CodeBlock = { id: string; h: number };

// A built-in's code height (a <Block>'s h, 8 by default) as a row height:
// 2.5% of the screen height per unit, so the default is a 20% row.
export const codeRow = (h: number) => clampRow(h * 250);

// A page with no saved layout, in edit mode: one column, one row per built-in
// block in code order, each row's height from the block's code height.
export function codeDefaultGrid(builtins: CodeBlock[]): Pick<LayoutDoc, "grid" | "blocks"> {
  const rows = builtins.slice(0, MAX_GRID_ROWS);
  return {
    grid: { cols: [SHARE_TOTAL], rows: rows.length ? rows.map((b) => codeRow(b.h)) : [SHARE_TOTAL], regions: [] },
    blocks: builtins.map((block, index): LayoutBlock =>
      index < MAX_GRID_ROWS
        ? { kind: "builtin", id: block.id, x: 0, y: index, w: 1, h: 1 }
        : { kind: "builtin", id: block.id, x: 0, y: MAX_GRID_ROWS - 1, w: 1, h: 1, hidden: true },
    ),
  };
}

const trivialGrid = (grid: PageGridSpec) => grid.cols.length === 1 && grid.rows.length === 1 && !grid.regions.length;

// A saved v2 document against the built-ins the code has now (replaces the v1
// withBuiltins). A built-in added since the save goes into a new row spanning
// every column, directly above the row where the next built-in in code order
// starts, or at the bottom. With `codeIds`, built-ins the code dropped leave
// their cell empty; without it they stay (absent blocks, FLOW-320 A3).
export function withCodeBlocks(doc: LayoutDoc, builtins: CodeBlock[], codeIds?: readonly string[]): LayoutDoc {
  // Nothing placed yet (a document holding only header or table edits): the code default.
  if (!doc.blocks.length && trivialGrid(doc.grid)) return { ...doc, ...codeDefaultGrid(builtins) };
  let next: LayoutDoc = codeIds
    ? { ...doc, blocks: doc.blocks.filter((block) => block.kind !== "builtin" || codeIds.includes(block.id)) }
    : doc;
  builtins.forEach((block, index) => {
    if (next.blocks.some((b) => b.kind === "builtin" && b.id === block.id)) return;
    const later = builtins
      .slice(index + 1)
      .map((code) => next.blocks.find((b) => b.kind === "builtin" && b.id === code.id && blockShown(b)))
      .find(Boolean);
    const at = later ? later.y : next.grid.rows.length;
    const added = addTrack(next, "rows", at);
    const fresh: LayoutBlock = { kind: "builtin", id: block.id, x: 0, y: Math.min(at, MAX_GRID_ROWS - 1), w: 1, h: 1 };
    if (!added.ok) {
      next = { ...next, blocks: [...next.blocks, { ...fresh, hidden: true }] };
      return;
    }
    const row = { x: 0, y: at, w: added.doc.grid.cols.length, h: 1 };
    const free = !added.doc.grid.regions.some((region) => intersects(region, row));
    if (free) {
      const regions = row.w > 1 ? [...added.doc.grid.regions, row] : added.doc.grid.regions;
      next = { ...added.doc, grid: { ...added.doc.grid, regions }, blocks: [...added.doc.blocks, place(fresh, row)] };
      return;
    }
    // A merged area crosses the new row: the first free cell in it.
    const cell = allSlots(added.doc.grid).find((slot) => slot.y === at && slot.h === 1 && !occupant(added.doc, slot));
    next = cell
      ? { ...added.doc, blocks: [...added.doc.blocks, place(fresh, cell)] }
      : { ...next, blocks: [...next.blocks, { ...fresh, hidden: true }] };
  });
  return next;
}

// Saved v1 (12 columns of 24px rows) to v2: column edges at the shown blocks'
// left and right edges, row edges at their tops and bottoms; each block fills
// the cell or region covering its old rectangle, gaps become empty cells. A
// block overlapping an earlier one moves into a new row at the bottom.
// Deterministic. Rows come out as shares (version 2); convertV2 makes them
// heights.
export function convertV1(doc: LayoutDocV1): LayoutDocV2 {
  const shown = doc.blocks.filter(blockShown);
  const rects = new Map<string, Rect>();
  const deferred: LayoutBlock[] = [];
  for (const block of shown) {
    if ([...rects.values()].some((r) => intersects(r, block))) deferred.push(block);
    else rects.set(block.id, rectOf(block));
  }
  let bottom = Math.max(0, ...[...rects.values()].map((r) => r.y + r.h));
  for (const block of deferred) {
    rects.set(block.id, { x: block.x, y: bottom, w: block.w, h: block.h });
    bottom += block.h;
  }
  const placed = [...rects.values()];
  const colEdges = [...new Set([0, V1_COLUMNS, ...placed.flatMap((r) => [r.x, r.x + r.w])])].sort((a, b) => a - b);
  let rowEdges = [...new Set([0, ...placed.flatMap((r) => [r.y, r.y + r.h])])].sort((a, b) => a - b);
  if (rowEdges.length === 1) rowEdges = [0, 1];
  // At most 40 rows: drop interior edges where no block starts (a block ending
  // there just reaches the next edge), from the bottom up.
  const starts = new Set(placed.map((r) => r.y));
  for (let k = rowEdges.length - 2; rowEdges.length - 1 > MAX_GRID_ROWS && k > 0; k--)
    if (!starts.has(rowEdges[k])) rowEdges.splice(k, 1);
  const diffs = (edges: number[]) => edges.slice(1).map((edge, k) => edge - edges[k]);
  const floorIndex = (edges: number[], value: number) => Math.max(0, edges.filter((edge) => edge <= value).length - 1);
  const ceilIndex = (edges: number[], value: number) => {
    const found = edges.findIndex((edge) => edge >= value);
    return found === -1 ? edges.length - 1 : found;
  };
  const toTracks = (r: Rect): Rect => {
    const x = Math.min(floorIndex(colEdges, r.x), colEdges.length - 2);
    const y = Math.min(floorIndex(rowEdges, r.y), rowEdges.length - 2);
    return { x, y, w: Math.max(1, ceilIndex(colEdges, r.x + r.w) - x), h: Math.max(1, ceilIndex(rowEdges, r.y + r.h) - y) };
  };
  const regions: Rect[] = [];
  const blocks = doc.blocks.map((block): LayoutBlock => {
    const kept = { ...block };
    delete kept.fit;
    if (block.removed) return { ...kept, x: 0, y: 0, w: 1, h: 1 };
    const r = rects.get(block.id);
    const tracks = toTracks(r ?? block);
    if (r && tracks.w * tracks.h > 1) regions.push(tracks);
    return place(kept, tracks);
  });
  return {
    version: 2,
    grid: {
      cols: withMinimum(apportion(diffs(colEdges), SHARE_TOTAL)),
      rows: withMinimum(apportion(diffs(rowEdges), SHARE_TOTAL)),
      regions,
    },
    blocks,
    tables: doc.tables,
    fieldBoxes: doc.fieldBoxes,
    ...(doc.headers && { headers: doc.headers }),
  };
}

// Saved version 2 (rows as shares adding up to 100%; card boxes on rows of 28px
// with 8px gaps) to version 3 (FLOW-357): a row share s becomes s% of the screen
// height, kept between 5% and 200%, which is today's look on a typical screen;
// card boxes keep their pixel place and height, now counted in pixels.
export const BOX_ROW_PX = 28;
export const BOX_GAP_PX = 8;
export const boxRowsToPx = <B extends { y: number; h: number }>(box: B): B => ({
  ...box,
  y: box.y * (BOX_ROW_PX + BOX_GAP_PX),
  h: box.h * BOX_ROW_PX + (box.h - 1) * BOX_GAP_PX,
});
const boxesToPx = (boxes: LayoutBox[]) => boxes.map(boxRowsToPx);
const blockBoxesToPx = (block: LayoutBlock): LayoutBlock => {
  if (block.kind === "card" && block.card.display.type === "boxes")
    return { ...block, card: { ...block.card, display: { type: "boxes", boxes: boxesToPx(block.card.display.boxes) } } };
  if (block.kind === "builtin" && block.data?.display.type === "boxes")
    return { ...block, data: { ...block.data, display: { type: "boxes", boxes: boxesToPx(block.data.display.boxes) } } };
  return block;
};
export function convertV2(doc: LayoutDocV2): LayoutDoc {
  return {
    ...doc,
    version: 3,
    grid: { ...doc.grid, rows: doc.grid.rows.map((share) => Math.min(MAX_ROW, Math.max(MIN_ROW, share))) },
    blocks: doc.blocks.map(blockBoxesToPx),
    fieldBoxes: Object.fromEntries(Object.entries(doc.fieldBoxes).map(([key, value]) => [key, { ...value, boxes: boxesToPx(value.boxes) }])),
  };
}

// Any saved version as the current one. Idempotent: a version 3 document is
// returned as it is.
export const asLatest = (doc: LayoutDoc | LayoutDocV2 | LayoutDocV1): LayoutDoc =>
  doc.version === 3 ? doc : convertV2(doc.version === 2 ? doc : convertV1(doc));

// ---- Rendering (FLOW-320) ----------------------------------------------------------

// The tracks view mode draws (FLOW-320 A3): a row or column whose only
// occupants are absent (not rendered by the code, or hidden from the role)
// collapses; tracks authored empty never do. Returns the kept tracks' original
// indices per axis.
export function keptTracks(grid: PageGridSpec, shown: Rect[], present: Rect[]): Record<Axis, number[]> {
  const keep = (axis: Axis) =>
    grid[axis]
      .map((_, index) => index)
      .filter((index) => {
        const covers = (r: Rect) => start(r, axis) <= index && index < start(r, axis) + span(r, axis);
        return !shown.some(covers) || present.some(covers);
      });
  return { cols: keep("cols"), rows: keep("rows") };
}
// A rectangle in kept-track coordinates (1-based CSS grid lines).
export function keptPlace(r: Rect, kept: Record<Axis, number[]>) {
  const map = (axis: Axis) => {
    const inside = kept[axis].filter((index) => index >= start(r, axis) && index < start(r, axis) + span(r, axis));
    return { from: kept[axis].indexOf(inside[0]) + 1, span: inside.length };
  };
  const col = map("cols");
  const row = map("rows");
  return { gridColumn: `${col.from} / span ${col.span}`, gridRow: `${row.from} / span ${row.span}` };
}

// The rows' pixel heights (FLOW-357): each row is exactly its share of the
// screen height (basis points), on every page, nested or not, and in edit and
// view mode alike. Rows adding up to more than the screen make the page scroll.
export function rowPixels(rows: number[], screen: number): number[] {
  return rows.map((row) => (row * screen) / SHARE_TOTAL);
}
// CSS grid rows of exact pixel heights.
export const rowTemplate = (pixels: number[]) => pixels.map((px) => `${px}px`).join(" ");
// Each column's pixel size: (usable width − gaps) × share.
export function trackPixels(size: number, shares: number[], gap: number): number[] {
  const free = Math.max(0, size - gap * (shares.length - 1));
  const total = sum(shares) || 1;
  return shares.map((share) => (free * share) / total);
}
// CSS grid columns for shares: fr units with a zero minimum, so content never
// stretches a column.
export const gridTemplate = (shares: number[]) => shares.map((share) => `minmax(0, ${share}fr)`).join(" ");
