import { GRID_COLUMNS } from "../../../shared/layout";

// Sizing blocks and boxes without dragging (FLOW-278): width presets and the
// arrow keys. Apart from the lazy grid editor, so the page grid can use it.

export type GridItem = { id: string; x: number; y: number; w: number; h: number };

// Arrow keys on a focused item (FLOW-278): move it one column or row, or with
// Shift resize it. Stays inside the 12 columns.
export function keyboardStep(item: GridItem, key: string, resize: boolean): GridItem | null {
  const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  const dy = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  if (!dx && !dy) return null;
  if (resize) {
    const w = Math.max(1, Math.min(GRID_COLUMNS - item.x, item.w + dx));
    const h = Math.max(1, Math.min(200, item.h + dy));
    return w === item.w && h === item.h ? null : { ...item, w, h };
  }
  const x = Math.max(0, Math.min(GRID_COLUMNS - item.w, item.x + dx));
  const y = Math.max(0, Math.min(1000, item.y + dy));
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
