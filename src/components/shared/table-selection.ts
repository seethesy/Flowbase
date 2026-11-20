// Excel-style row selection for data tables (FLOW-260). A pure reducer over the
// row ids in their on-screen order, so it is testable without a DOM:
// - drag across rows selects that range (a plain click with no drag selects
//   nothing: it edits the cell or opens the row);
// - Shift+click extends from the anchor row;
// - Ctrl/Cmd + click or drag adds another separate range (a Ctrl/Cmd+click on a
//   selected row takes it out);
// - all of these combine.

export type Selection = {
  selected: string[];
  // Index of the row the last range started from (Shift+click extends from it).
  anchor: number | null;
  drag: { start: number; id: string; base: string[]; moved: boolean; ctrl: boolean } | null;
};

export type SelectionAction =
  | { type: "down"; ids: string[]; index: number; shift: boolean; ctrl: boolean }
  | { type: "enter"; ids: string[]; index: number }
  | { type: "up" }
  | { type: "toggle"; id: string; index: number }
  | { type: "set"; selected: string[] }
  | { type: "clear" };

export const emptySelection: Selection = { selected: [], anchor: null, drag: null };

const range = (ids: string[], a: number, b: number) => ids.slice(Math.min(a, b), Math.max(a, b) + 1);
const union = (...lists: string[][]) => [...new Set(lists.flat())];

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "down": {
      const { ids, index, shift, ctrl } = action;
      if (shift && state.anchor !== null) {
        const extent = range(ids, state.anchor, index);
        // Ctrl+Shift keeps the other ranges; Shift alone replaces them.
        return { ...state, selected: ctrl ? union(state.selected, extent) : extent, drag: null };
      }
      if (ctrl) {
        const id = ids[index];
        // Ctrl starts an extra range; a click with no drag toggles the row.
        return { selected: state.selected, anchor: index, drag: { start: index, id, base: state.selected.filter((value) => value !== id), moved: false, ctrl: true } };
      }
      return { ...state, drag: { start: index, id: ids[index], base: [], moved: false, ctrl: false } };
    }
    case "enter": {
      if (!state.drag) return state;
      const { ids, index } = action;
      if (index === state.drag.start && !state.drag.moved) return state;
      return {
        selected: union(state.drag.base, range(ids, state.drag.start, index)),
        anchor: state.drag.start,
        drag: { ...state.drag, moved: true },
      };
    }
    case "up": {
      const drag = state.drag;
      if (!drag) return state;
      // A Ctrl/Cmd+click with no drag adds the row, or takes it out when selected.
      if (drag.ctrl && !drag.moved)
        return {
          selected: state.selected.includes(drag.id) ? drag.base : [...state.selected, drag.id],
          anchor: drag.start,
          drag: null,
        };
      // A plain click selects nothing but becomes the anchor for Shift+click.
      return { ...state, anchor: drag.start, drag: null };
    }
    case "toggle": {
      const has = state.selected.includes(action.id);
      return {
        selected: has ? state.selected.filter((id) => id !== action.id) : [...state.selected, action.id],
        anchor: action.index,
        drag: null,
      };
    }
    case "set":
      return { ...state, selected: action.selected, drag: null };
    case "clear":
      return emptySelection;
  }
}

// Whether a pointer-up ended a drag selection (then the click must not edit or
// open the row).
export const wasDrag = (state: Selection) => state.drag?.moved === true;
