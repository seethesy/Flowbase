import { GRID_COLUMNS, MAX_BOX_HEIGHT, MAX_BOX_TOP } from "../../../shared/layout";

// Sizing boxes inside cards and field cards without dragging (FLOW-278): width
// presets and the arrow keys. Page blocks use the page grid instead (FLOW-321).

export type GridItem = { id: string; x: number; y: number; w: number; h: number };

// A box's top and height are pixels (FLOW-357): the arrow keys move and resize
// it 8px at a time, and no box is under 16px tall.
export const BOX_KEY_STEP = 8;
export const MIN_BOX_HEIGHT = 16;

// Arrow keys on a focused item (FLOW-278): move it one column or 8px, or with
// Shift resize it. Stays inside the 12 columns.
export function keyboardStep(item: GridItem, key: string, resize: boolean): GridItem | null {
  const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  const dy = key === "ArrowUp" ? -BOX_KEY_STEP : key === "ArrowDown" ? BOX_KEY_STEP : 0;
  if (!dx && !dy) return null;
  if (resize) {
    const w = Math.max(1, Math.min(GRID_COLUMNS - item.x, item.w + dx));
    const h = Math.max(MIN_BOX_HEIGHT, Math.min(MAX_BOX_HEIGHT, item.h + dy));
    return w === item.w && h === item.h ? null : { ...item, w, h };
  }
  const x = Math.max(0, Math.min(GRID_COLUMNS - item.w, item.x + dx));
  const y = Math.max(0, Math.min(MAX_BOX_TOP, item.y + dy));
  return x === item.x && y === item.y ? null : { ...item, x, y };
}

// A width preset (¼, ⅓, ½, ⅔, full): the item keeps its column when it fits.
export const widthPresets = [
  { label: "¼", name: "Quarter width", w: 3 },
  { label: "⅓", name: "Third width", w: 4 },
  { label: "½", name: "Half width", w: 6 },
  { label: "⅔", name: "Two-thirds width", w: 8 },
  { label: "Full", name: "Full width", w: 12 },
] as const;
export const withWidth = <I extends GridItem>(item: I, w: number): I => ({ ...item, w, x: Math.min(item.x, GRID_COLUMNS - w) });
