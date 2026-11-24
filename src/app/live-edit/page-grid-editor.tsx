import { lazy, Suspense, useCallback, useContext, useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { EyeOff, GripHorizontal, Palette, Pencil, Plus, X } from "lucide-react";
import { Dropdown } from "../../components/ui/Dropdown";
import { Button } from "../../components/ui/button";
import { builtinCard, layoutItemGone, MAX_BLOCKS, MAX_CARDS, recordPages, textVariants, type CardConfig, type LayoutBlock, type LayoutDoc } from "../../../shared/layout";
import {
  addBlock,
  addTrack,
  allSlots,
  containsCell,
  dragDivider,
  emptySlots,
  gridTemplate,
  mergeCells,
  moveBlock,
  occupant,
  placeName,
  removeTrack,
  restoreBlock,
  sameRect,
  setShare,
  slotAt,
  trackName,
  trackPixels,
  unmergeRegion,
  type Axis,
  type GridResult,
  type Rect,
  type Target,
} from "../../../shared/page-grid";
import { fieldRegistry } from "../../../shared/fields";
import { DeleteLayoutButton, useDeletion } from "./layout-deletion";
import { newBoxId, variantNames } from "./box-editor";
import type { BuiltinBlock, PageLayout } from "./layout-state";
import { styleClass, styleVars } from "./layout-style-view";
import { StylePopover } from "./layout-style";
import { BlockContent, blockName, GRID_GAP, GridNesting, useGridFrame } from "./page-grid";
const DeletedItemsTray = lazy(() => import("./layout-deleted-tray").then((module) => ({ default: module.DeletedItemsTray })));
const CardBuilder = lazy(() => import("./card-builder").then((module) => ({ default: module.CardBuilder })));

// The page grid editor (FLOW-321). It draws in the same sizing frame as view
// mode (useGridFrame), so each cell's box is the same in both; the toolbar is
// fixed to the bottom of the screen (a nested grid's follows its frame) and the
// guides, labels and handles are overlaid, so none of them moves or resizes
// the frame. Every row and column
// boundary, empty cell and merged area is drawn. Tracks resize by dragging a
// divider (or its arrow keys) or by an exact percentage; rows and columns are
// added and removed, cells merged and unmerged, and blocks placed in an exact
// cell or region. Each edit shows its outcome first (highlighted cells and a
// line of text, also announced); Esc cancels. Edit chrome wording isn't wrapped
// in <T>, as before.

const newCard = (record: boolean): CardConfig => ({
  title: "New card",
  source: record ? { type: "record" } : { type: "list", list: "events" },
  filters: [],
  limit: 10,
  display: { type: "table", columns: [] },
});

type Cell = { x: number; y: number };
// What an Add or Restore will put into the cell the Admin picks.
type Placing = { kind: "card" } | { kind: "text"; variant: (typeof textVariants)[number] } | { kind: "restore"; id: string; deleted: boolean };
// A previewed edit waiting for Apply, or a refusal shown with no change.
type Preview = { result: GridResult };
// A block being moved: by pointer (drag) or picked up with the keyboard.
type Carry = { id: string; to: Cell | null; pointer: boolean };
type DividerDrag = { axis: Axis; index: number; startShares: number[]; startAt: number; pixels: number; shares: number[] };

const pct = (share: number) => (share / 100).toFixed(2).replace(/\.?0+$/, "");
const gridArea = (r: Rect) => ({ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}` });
const bounds = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const steps: Record<string, Cell> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

// The slot next to `from` in an arrow key's direction, or null at the edge.
function neighbour(doc: LayoutDoc, from: Rect, key: string): Rect | null {
  const step = steps[key];
  if (!step) return null;
  const x = step.x > 0 ? from.x + from.w : step.x < 0 ? from.x - 1 : from.x;
  const y = step.y > 0 ? from.y + from.h : step.y < 0 ? from.y - 1 : from.y;
  if (x < 0 || y < 0 || x >= doc.grid.cols.length || y >= doc.grid.rows.length) return null;
  return slotAt(doc.grid, x, y);
}

export default function PageGridEditor({
  layout,
  doc,
  builtins,
  content,
}: {
  layout: PageLayout;
  doc: LayoutDoc;
  builtins: BuiltinBlock[];
  content: Map<string, ReactNode>;
}) {
  const nested = useContext(GridNesting);
  // Sized by the committed rows, so a divider drag doesn't resize the frame.
  const frame = useGridFrame(doc.grid.rows);
  // The card being built: a new one (id null) going to `target`, or an existing
  // card block's. A built-in card's values (FLOW-279) are edited the same way.
  const [building, setBuilding] = useState<{ id: string | null; card: CardConfig; builtin?: boolean; target?: Target } | null>(null);
  const [styling, setStyling] = useState<string | null>(null);
  const deletion = useDeletion();
  const [tray, setTray] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  const [divider, setDivider] = useState<DividerDrag | null>(null);
  // A rectangular selection of cells, from an anchor to the cursor.
  const [selection, setSelection] = useState<{ anchor: Rect; cursor: Rect } | null>(null);
  const [message, setMessage] = useState("");
  const frameRef = frame.ref;
  const hidden = doc.blocks.filter((block) => !layoutItemGone(block) && block.kind === "builtin" && block.hidden);
  const cards = doc.blocks.filter((block) => !layoutItemGone(block) && block.kind === "card").length;
  const full = doc.blocks.filter((block) => !layoutItemGone(block)).length >= MAX_BLOCKS;
  const recordSource = recordPages[layout.pageKey]?.source ?? layout.record?.source ?? null;
  const names = (id: string) => {
    const block = doc.blocks.find((b) => b.id === id);
    return block ? blockName(block, builtins) : id;
  };
  const commit = (next: LayoutDoc) => layout.update(() => next);
  const patch = (id: string, values: Partial<LayoutBlock>) =>
    commit({ ...doc, blocks: doc.blocks.map((block) => (block.id === id ? ({ ...block, ...values } as LayoutBlock) : block)) });
  const remove = (block: LayoutBlock) => patch(block.id, { deleted: deletion(blockName(block, builtins)) });

  const cancelAll = useCallback(() => {
    setPreview(null);
    setPlacing(null);
    setCarry(null);
    setSelection(null);
    setDivider(null);
  }, []);
  // Shows an edit's outcome before it commits; a refusal changes nothing.
  const ask = (result: GridResult) => {
    setPreview({ result });
    setMessage(result.ok ? result.outcome.message : result.reason);
  };
  const apply = () => {
    if (preview?.result.ok) {
      commit(preview.result.doc);
      setMessage(`Done: ${preview.result.outcome.message}`);
    }
    setPreview(null);
    setSelection(null);
  };
  // Commits at once: a drop, a divider key or an exact percentage, whose
  // outcome was shown while it was made.
  const run = (result: GridResult) => {
    if (!result.ok) {
      setPreview({ result });
      setMessage(result.reason);
      return false;
    }
    commit(result.doc);
    setMessage(result.outcome.message);
    return true;
  };

  // Esc cancels whatever is in progress, with no change.
  useEffect(() => {
    if (!preview && !placing && !carry && !divider && !selection) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelAll();
      setMessage("Cancelled. Nothing changed.");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview, placing, carry, divider, selection, cancelAll]);

  // ---- Placement: Add card, Add text, Show and Restore -----------------------
  const startPlacing = (next: Placing) => {
    cancelAll();
    // No empty cell: straight into a new row at the bottom (FLOW-319 17).
    if (!emptySlots(doc).length) {
      place(next, "bottom");
      return;
    }
    setPlacing(next);
    setMessage("Pick an empty cell, or a new row at the bottom. Esc cancels.");
  };
  const place = (what: Placing, target: Target) => {
    setPlacing(null);
    if (what.kind === "card") {
      setBuilding({ id: null, card: newCard(recordSource !== null), target });
      return;
    }
    if (what.kind === "text") {
      run(
        addBlock(
          doc,
          { kind: "text", id: newBoxId(what.variant, doc.blocks.map((block) => block.id)), variant: what.variant, text: variantNames[what.variant], x: 0, y: 0, w: 1, h: 1 },
          target,
          (id) => (id.startsWith(what.variant) ? variantNames[what.variant] : names(id)),
        ),
      );
      return;
    }
    run(restoreBlock(doc, what.id, target, names));
  };
  const restore = (id: string, deleted: boolean) => {
    const result = restoreBlock(doc, id, undefined, names);
    if (result.ok) run(result);
    else if (result.needsPlace) {
      setMessage(result.reason);
      if (!emptySlots(doc).length) place({ kind: "restore", id, deleted }, "bottom");
      else setPlacing({ kind: "restore", id, deleted });
    } else setMessage(result.reason);
  };

  // ---- Frame geometry, for dividers, labels and pointer drags ------------------
  // A previewed edit draws its outcome until Apply or Cancel.
  const view = preview?.result.ok ? preview.result.doc : doc;
  const cols = divider?.axis === "cols" ? divider.shares : view.grid.cols;
  const rows = divider?.axis === "rows" ? divider.shares : view.grid.rows;
  const colPx = trackPixels(frame.width, cols, GRID_GAP);
  const rowPx = trackPixels(frame.height, rows, GRID_GAP);
  const offsets = (sizes: number[]) => sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0) + GRID_GAP * i);
  const colAt = offsets(colPx);
  const rowAt = offsets(rowPx);
  const cellAtPoint = (clientX: number, clientY: number): Cell | null => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return null;
    const find = (at: number[], sizes: number[], value: number) => {
      const index = at.findIndex((from, i) => value < from + sizes[i] + GRID_GAP / 2);
      return index === -1 ? at.length - 1 : index;
    };
    const px = clientX - box.left;
    const py = clientY - box.top;
    if (px < 0 || py < 0 || px > box.width || py > box.height) return null;
    return { x: find(colAt, colPx, px), y: find(rowAt, rowPx, py) };
  };

  // ---- Moving blocks -----------------------------------------------------------
  const carryResult = carry?.to ? moveBlock(doc, carry.id, carry.to.x, carry.to.y, names) : null;
  const carryTarget = carry?.to ? slotAt(doc.grid, carry.to.x, carry.to.y) : null;
  useEffect(() => {
    // Still over its own cell (just picked up): keep the pick-up message.
    const own = carry && doc.blocks.find((block) => block.id === carry.id);
    if (own && carryTarget && sameRect(own, carryTarget)) return;
    if (carry && carryResult) setMessage(carryResult.ok ? carryResult.outcome.message : carryResult.reason);
    // carryResult follows carry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carry?.id, carry?.to?.x, carry?.to?.y]);
  const drop = () => {
    if (carryResult?.ok) run(carryResult);
    else if (carryResult) setMessage(carryResult.reason);
    setCarry(null);
  };
  const onHandleDown = (event: PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    cancelAll();
    setCarry({ id, to: null, pointer: true });
  };
  const onHandleMove = (event: PointerEvent<HTMLElement>) => {
    if (!carry?.pointer) return;
    const cell = cellAtPoint(event.clientX, event.clientY);
    if (cell && (cell.x !== carry.to?.x || cell.y !== carry.to?.y)) setCarry({ ...carry, to: cell });
  };
  const onHandleUp = () => {
    if (carry?.pointer) drop();
  };
  const onBlockKey = (event: KeyboardEvent<HTMLElement>, block: LayoutBlock) => {
    if (event.target !== event.currentTarget) return;
    const here = { x: block.x, y: block.y, w: block.w, h: block.h };
    if (carry && carry.id === block.id) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        drop();
        return;
      }
      const from = carryTarget ?? here;
      const next = neighbour(doc, from, event.key);
      if (next) {
        event.preventDefault();
        setCarry({ ...carry, to: { x: next.x, y: next.y } });
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cancelAll();
      setCarry({ id: block.id, to: { x: block.x, y: block.y }, pointer: false });
      setMessage(`Picked up ${names(block.id)}. Arrow keys choose where it goes, Enter drops it, Esc cancels.`);
      return;
    }
    onSlotKey(event, here);
  };

  // ---- Selecting cells (merge and unmerge) ----------------------------------------
  const selected = selection ? bounds(selection.anchor, selection.cursor) : null;
  const focusSlot = (r: Rect) =>
    frameRef.current?.querySelector<HTMLElement>(`[data-slot="${r.x},${r.y}"]`)?.focus();
  const onSlotKey = (event: KeyboardEvent<HTMLElement>, here: Rect) => {
    if (event.target !== event.currentTarget) return;
    if (placing && (event.key === "Enter" || event.key === " ") && !occupant(doc, here)) {
      event.preventDefault();
      place(placing, { x: here.x, y: here.y });
      return;
    }
    const base = event.shiftKey && selection ? selection.cursor : here;
    const next = neighbour(doc, base, event.key);
    if (!next) return;
    event.preventDefault();
    if (event.shiftKey) {
      const anchor = selection?.anchor ?? here;
      setSelection({ anchor, cursor: next });
      setMessage(`Selected ${placeName(bounds(anchor, next))}.`);
    } else {
      setSelection({ anchor: next, cursor: next });
      focusSlot(next);
    }
  };
  const onSlotClick = (event: { shiftKey: boolean }, here: Rect) => {
    if (placing) {
      if (!occupant(doc, here)) place(placing, { x: here.x, y: here.y });
      return;
    }
    if (event.shiftKey && selection) setSelection({ anchor: selection.anchor, cursor: here });
    else setSelection({ anchor: here, cursor: here });
  };
  const selectedRegion = selected ? doc.grid.regions.find((region) => sameRect(region, selected)) : undefined;

  // ---- Tracks ----------------------------------------------------------------------
  const onDividerDown = (event: PointerEvent<HTMLElement>, axis: Axis, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const sizes = axis === "cols" ? colPx : rowPx;
    const shares = doc.grid[axis];
    setDivider({ axis, index, startShares: shares, shares, startAt: axis === "cols" ? event.clientX : event.clientY, pixels: sizes[index] + sizes[index + 1] });
  };
  const onDividerMove = (event: PointerEvent<HTMLElement>) => {
    if (!divider) return;
    const delta = (divider.axis === "cols" ? event.clientX : event.clientY) - divider.startAt;
    const pair = divider.startShares[divider.index] + divider.startShares[divider.index + 1];
    const first = divider.startShares[divider.index] + (divider.pixels ? (delta * pair) / divider.pixels : 0);
    const shares = dragDivider(divider.startShares, divider.index, Math.round(first / 10) * 10);
    setDivider({ ...divider, shares });
    setMessage(`${trackName(divider.axis, divider.index)} ${pct(shares[divider.index])}%, ${trackName(divider.axis, divider.index + 1).toLowerCase()} ${pct(shares[divider.index + 1])}%.`);
  };
  const onDividerUp = () => {
    if (!divider) return;
    if (divider.shares !== divider.startShares) commit({ ...doc, grid: { ...doc.grid, [divider.axis]: divider.shares } });
    setDivider(null);
  };
  const onDividerKey = (event: KeyboardEvent<HTMLElement>, axis: Axis, index: number) => {
    const step = event.shiftKey ? 500 : 100;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -step : event.key === "ArrowRight" || event.key === "ArrowDown" ? step : 0;
    if (!delta) return;
    event.preventDefault();
    const shares = dragDivider(doc.grid[axis], index, doc.grid[axis][index] + delta);
    commit({ ...doc, grid: { ...doc.grid, [axis]: shares } });
    setMessage(`${trackName(axis, index)} ${pct(shares[index])}%, ${trackName(axis, index + 1).toLowerCase()} ${pct(shares[index + 1])}%.`);
  };
  const exactShare = (axis: Axis, index: number, value: string, input: HTMLInputElement) => {
    const number = Number(value.replace("%", "").trim());
    if (!value.trim() || !Number.isFinite(number)) {
      input.value = pct(doc.grid[axis][index]);
      return;
    }
    const share = Math.round(number * 100);
    if (share === doc.grid[axis][index]) return;
    const result = setShare(doc.grid[axis], index, share, axis);
    if (!result.ok) {
      setPreview({ result });
      setMessage(result.reason);
      input.value = pct(doc.grid[axis][index]);
      return;
    }
    commit({ ...doc, grid: { ...doc.grid, [axis]: result.shares } });
    setMessage(`${trackName(axis, index)} is ${pct(share)}%; the other ${axis === "cols" ? "columns" : "rows"} scale to fit.`);
  };

  // ---- Highlights: the preview's outcome, the drop target, the selection ----------
  const highlights: { rect: Rect; kind: string }[] = [];
  if (preview) {
    const result = preview.result;
    for (const rect of result.ok ? result.outcome.highlight : (result.highlight ?? [])) highlights.push({ rect, kind: result.ok ? "preview" : "refused" });
  }
  if (carry?.to && carryTarget) highlights.push({ rect: carryTarget, kind: carryResult?.ok ? "target" : "refused" });
  if (selected && !carry) highlights.push({ rect: selected, kind: "selection" });

  const slots = allSlots(view.grid);
  return (
    <div className={`page-grid-editing${nested ? " page-grid-editing--nested" : ""}`} data-page-layout={layout.pageKey}>
      <div className="layout-toolbar" role="toolbar" aria-label="Page layout">
        {recordSource && (
          <span className="layout-scope-note">
            {`One layout for every record in ${fieldRegistry[recordSource].label}: changes here show on all of them.`}
          </span>
        )}
        <Button
          variant="outline"
          disabled={full || cards >= MAX_CARDS}
          title={full ? `A page holds at most ${MAX_BLOCKS} blocks.` : cards >= MAX_CARDS ? `A page holds at most ${MAX_CARDS} cards.` : undefined}
          onClick={() => startPlacing({ kind: "card" })}
        >
          Add card
        </Button>
        <Dropdown
          aria-label="Add text"
          className="layout-add-text"
          value=""
          disabled={full}
          onChange={(event) => {
            if (event.target.value) startPlacing({ kind: "text", variant: event.target.value as (typeof textVariants)[number] });
          }}
        >
          <option value="">Add text…</option>
          {textVariants.map((variant) => (
            <option key={variant} value={variant}>
              {variantNames[variant]}
            </option>
          ))}
        </Dropdown>
        <Button
          variant="outline"
          disabled={!selected || selected.w * selected.h < 2}
          title="Select two or more cells (click, then Shift and click or Shift and the arrow keys)"
          onClick={() => selected && ask(mergeCells(doc, selected, names))}
        >
          Merge
        </Button>
        <Button
          variant="outline"
          disabled={!selectedRegion}
          title="Select a merged area"
          onClick={() => selectedRegion && ask(unmergeRegion(doc, selectedRegion.x, selectedRegion.y, names))}
        >
          Unmerge
        </Button>
        <div className="layout-tray">
          <Button variant="outline" aria-expanded={tray} onClick={() => setTray(!tray)}>
            {`Hidden items (${hidden.length})`}
          </Button>
          {tray && (
            <div className="layout-tray-list" role="dialog" aria-label="Hidden items">
              {hidden.length === 0 ? (
                <p className="muted">Nothing is hidden.</p>
              ) : (
                <ul>
                  {hidden.map((block) => (
                    <li key={block.id}>
                      <span>{blockName(block, builtins)}</span>
                      <DeleteLayoutButton name={blockName(block, builtins)} onDelete={() => remove(block)} />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setTray(false);
                          restore(block.id, false);
                        }}
                      >
                        Show
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <Suspense fallback={null}><DeletedItemsTray onRestoreBlock={(id) => restore(id, true)} /></Suspense>
        {resetting ? (
          <span className="layout-confirm" role="alertdialog" aria-label="Reset page layout?">
            <span>Reset this page to its default layout? Custom cards, text and colors go too. Permanently removed built-in items return.</span>
            <Button
              variant="destructive"
              onClick={() => {
                layout.reset();
                setResetting(false);
              }}
            >
              Reset
            </Button>
            <Button variant="ghost" onClick={() => setResetting(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="ghost" disabled={!layout.saved && !layout.dirty} onClick={() => setResetting(true)}>
            Reset page layout
          </Button>
        )}
        {placing && (
          <span className="layout-picker" role="group" aria-label="Where it goes">
            <span>Pick an empty cell, or</span>
            <Button variant="outline" onClick={() => place(placing, "bottom")}>
              New row at bottom
            </Button>
            <Button variant="ghost" onClick={() => cancelAll()}>
              Cancel
            </Button>
          </span>
        )}
        {preview && (
          <span className="layout-preview" role="group" aria-label="Preview">
            {preview.result.ok ? (
              <>
                <Button onClick={apply}>Apply</Button>
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setPreview(null)}>
                OK
              </Button>
            )}
          </span>
        )}
        <p className={`layout-grid-message${preview && !preview.result.ok ? " is-refused" : ""}`} role="status" aria-live="polite">
          {message}
        </p>
      </div>
      <div
        ref={frameRef}
        className="page-grid page-grid-frame"
        role="group"
        aria-label="Page grid"
        style={{ gridTemplateColumns: gridTemplate(cols), gridTemplateRows: gridTemplate(rows), height: frame.height }}
      >
        {slots.map((slot) => {
          const block = occupant(view, slot);
          const key = `${slot.x},${slot.y}`;
          const isSelected = Boolean(selected && containsCell(selected, slot.x, slot.y));
          if (!block)
            return (
              <div
                key={`cell-${key}`}
                className={`layout-grid-cell${slot.w * slot.h > 1 ? " is-merged" : ""}${placing ? " is-pickable" : ""}`}
                style={gridArea(slot)}
                data-slot={key}
                data-empty-cell={key}
                data-selected={isSelected ? "true" : undefined}
                tabIndex={0}
                role="button"
                aria-label={`${placing ? "Place here: " : ""}Empty ${slot.w * slot.h > 1 ? "merged area" : "cell"}, ${placeName(slot)}`}
                onClick={(event) => onSlotClick(event, slot)}
                onKeyDown={(event) => onSlotKey(event, slot)}
              />
            );
          const name = blockName(block, builtins);
          return (
            <div
              key={block.id}
              className={`layout-block-frame ${styleClass(block.style)}${carry?.id === block.id ? " is-carried" : ""}`}
              data-hide-phone={block.hidePhone ? "true" : undefined}
              style={{ ...gridArea(slot), ...styleVars(block.style) }}
              data-block-id={block.id}
              data-slot={key}
              data-selected={isSelected ? "true" : undefined}
              tabIndex={0}
              aria-label={`${name}, ${placeName(slot)}: Enter picks it up to move`}
              onKeyDown={(event) => onBlockKey(event, block)}
              onClick={(event) => {
                if (event.target === event.currentTarget) onSlotClick(event, slot);
              }}
            >
              <div className="layout-block-bar" onClick={(event) => event.target === event.currentTarget && onSlotClick(event, slot)}>
                <span
                  className="layout-handle"
                  title="Drag to move"
                  onPointerDown={(event) => onHandleDown(event, block.id)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={() => setCarry(null)}
                >
                  <GripHorizontal size={14} aria-hidden="true" />
                  {name}
                </span>
                <span className="layout-block-actions">
                  <span className="layout-size-presets">
                    <button
                      type="button"
                      aria-label={`Hide on phone: ${name}`}
                      title="Hide on phone: its cell stays empty there"
                      aria-pressed={Boolean(block.hidePhone)}
                      onClick={() => patch(block.id, { hidePhone: block.hidePhone ? undefined : true })}
                    >
                      No phone
                    </button>
                  </span>
                  <button type="button" aria-label={`Style ${name}`} title="Style" onClick={() => setStyling(block.id)}>
                    <Palette size={14} />
                  </button>
                  {block.kind === "builtin" && (
                    <button type="button" aria-label={`Hide ${name}`} title="Hide" onClick={() => patch(block.id, { hidden: true })}>
                      <EyeOff size={14} />
                    </button>
                  )}
                  {block.kind === "card" && (
                    <button type="button" aria-label={`Edit ${name}`} title="Edit card" onClick={() => setBuilding({ id: block.id, card: block.card })}>
                      <Pencil size={14} />
                    </button>
                  )}
                  {block.kind === "builtin" && builtinCard(layout.pageKey, block.id, block.data) && (
                    <button
                      type="button"
                      aria-label={`Edit ${name}`}
                      title="Edit what this card shows"
                      onClick={() => setBuilding({ id: block.id, card: builtinCard(layout.pageKey, block.id, block.data)!, builtin: true })}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <DeleteLayoutButton name={name} onDelete={() => remove(block)} />
                </span>
              </div>
              {styling === block.id && (
                <StylePopover
                  style={block.style}
                  onChange={(style) => patch(block.id, { style })}
                  visibleTo={block.kind === "text" ? undefined : block.visibleTo}
                  onVisibleToChange={block.kind === "text" ? undefined : (visibleTo) => patch(block.id, { visibleTo })}
                  onClose={() => setStyling(null)}
                />
              )}
              <div className="layout-block-body">
                <GridNesting.Provider value={true}>
                  {block.kind === "text" ? (
                    <textarea
                      className={`layout-text-input layout-text-input--${block.variant}`}
                      aria-label={`${variantNames[block.variant]} text`}
                      value={block.text}
                      maxLength={2000}
                      onChange={(event) => patch(block.id, { text: event.target.value })}
                    />
                  ) : block.kind === "builtin" && !content.has(block.id) && !block.data ? (
                    <p className="muted layout-absent-note">Not shown on this view.</p>
                  ) : (
                    <BlockContent pageKey={layout.pageKey} block={block} content={content} record={layout.record} />
                  )}
                </GridNesting.Provider>
              </div>
            </div>
          );
        })}
        {highlights.map((highlight, index) => (
          <div
            key={`highlight-${index}`}
            className={`layout-grid-highlight is-${highlight.kind}`}
            style={gridArea(highlight.rect)}
            data-highlight={highlight.kind}
            aria-hidden="true"
          />
        ))}
        <div className="layout-grid-guides">
          {cols.map((share, index) => (
            <div key={`col-${index}`} className="layout-track-label is-col" style={{ left: colAt[index], width: colPx[index] }}>
              <TrackControls axis="cols" index={index} share={share} count={cols.length} onShare={exactShare} onAsk={ask} doc={doc} names={names} locked={Boolean(preview)} />
            </div>
          ))}
          {rows.map((share, index) => (
            <div key={`row-${index}`} className="layout-track-label is-row" style={{ top: rowAt[index], height: rowPx[index] }}>
              <TrackControls axis="rows" index={index} share={share} count={rows.length} onShare={exactShare} onAsk={ask} doc={doc} names={names} locked={Boolean(preview)} />
            </div>
          ))}
          {cols.slice(0, -1).map((_, index) => (
            <div
              key={`col-divider-${index}`}
              className={`layout-divider is-col${divider?.axis === "cols" && divider.index === index ? " is-dragging" : ""}`}
              style={{ left: colAt[index] + colPx[index] }}
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label={`Divider between column ${index + 1} and column ${index + 2}`}
              aria-valuenow={Number(pct(cols[index]))}
              aria-valuemin={1}
              aria-valuemax={Number(pct(cols[index] + cols[index + 1] - 100))}
              aria-valuetext={`Column ${index + 1} ${pct(cols[index])}%, column ${index + 2} ${pct(cols[index + 1])}%`}
              onPointerDown={(event) => onDividerDown(event, "cols", index)}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onKeyDown={(event) => onDividerKey(event, "cols", index)}
            />
          ))}
          {rows.slice(0, -1).map((_, index) => (
            <div
              key={`row-divider-${index}`}
              className={`layout-divider is-row${divider?.axis === "rows" && divider.index === index ? " is-dragging" : ""}`}
              style={{ top: rowAt[index] + rowPx[index] }}
              role="separator"
              tabIndex={0}
              aria-orientation="horizontal"
              aria-label={`Divider between row ${index + 1} and row ${index + 2}`}
              aria-valuenow={Number(pct(rows[index]))}
              aria-valuemin={1}
              aria-valuemax={Number(pct(rows[index] + rows[index + 1] - 100))}
              aria-valuetext={`Row ${index + 1} ${pct(rows[index])}%, row ${index + 2} ${pct(rows[index + 1])}%`}
              onPointerDown={(event) => onDividerDown(event, "rows", index)}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onKeyDown={(event) => onDividerKey(event, "rows", index)}
            />
          ))}
        </div>
      </div>
      {/* Room to scroll the last row out from under the fixed toolbar; below the frame, so it never moves it. */}
      {!nested && <div className="layout-toolbar-spacer" aria-hidden="true" />}
      {building && (
        <Suspense fallback={null}>
          <CardBuilder
            initial={building.card}
            recordSource={recordSource}
            lockSource={building.builtin}
            onReset={
              building.builtin && building.id
                ? () => {
                    patch(building.id!, { data: undefined });
                    setBuilding(null);
                  }
                : undefined
            }
            onCancel={() => setBuilding(null)}
            onDone={(card) => {
              if (building.builtin && building.id)
                patch(building.id, { data: { filters: card.filters, sort: card.sort, limit: card.limit, display: card.display } });
              else if (building.id) patch(building.id, { card });
              else {
                const id = newBoxId("card", doc.blocks.map((block) => block.id));
                run(addBlock(doc, { kind: "card", id, card, x: 0, y: 0, w: 1, h: 1 }, building.target ?? "bottom", (other) => (other === id ? card.title : names(other))));
              }
              setBuilding(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

// A track's label: its exact percentage, and add and remove buttons, each
// previewed before it applies.
function TrackControls({
  axis,
  index,
  share,
  count,
  onShare,
  onAsk,
  doc,
  names,
  locked,
}: {
  axis: Axis;
  index: number;
  share: number;
  count: number;
  onShare: (axis: Axis, index: number, value: string, input: HTMLInputElement) => void;
  onAsk: (result: GridResult) => void;
  doc: LayoutDoc;
  names: (id: string) => string;
  // While another edit is previewed.
  locked: boolean;
}) {
  const name = trackName(axis, index);
  const [before, after] = axis === "cols" ? ["left of", "right of"] : ["above", "below"];
  const noun = axis === "cols" ? "column" : "row";
  return (
    <span className="layout-track-controls">
      <button type="button" aria-label={`Add ${noun} ${before} ${name.toLowerCase()}`} title={`Add a ${noun} ${before} this one`} disabled={locked} onClick={() => onAsk(addTrack(doc, axis, index))}>
        <Plus size={12} aria-hidden="true" />
      </button>
      <label className="layout-track-share">
        <input
          key={`${axis}-${index}-${share}`}
          aria-label={`${name} ${axis === "cols" ? "width" : "height"} (%)`}
          defaultValue={pct(share)}
          inputMode="decimal"
          readOnly={locked}
          size={5}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onShare(axis, index, event.currentTarget.value, event.currentTarget);
            } else if (event.key === "Escape") event.currentTarget.value = pct(share);
          }}
          onBlur={(event) => onShare(axis, index, event.currentTarget.value, event.currentTarget)}
        />
        <span aria-hidden="true">%</span>
      </label>
      <button type="button" aria-label={`Add ${noun} ${after} ${name.toLowerCase()}`} title={`Add a ${noun} ${after} this one`} disabled={locked} onClick={() => onAsk(addTrack(doc, axis, index + 1))}>
        <Plus size={12} aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Remove ${name.toLowerCase()}`} title={`Remove this ${noun}`} disabled={locked || count === 1} onClick={() => onAsk(removeTrack(doc, axis, index, names))}>
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
