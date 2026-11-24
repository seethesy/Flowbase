import { describe, expect, it } from "vitest";
import { emptySelection, selectionReducer, wasDrag, type Selection, type SelectionAction } from "../../src/components/shared/table-selection";

// FLOW-260 AC1: Excel-style selection.
const ids = ["a", "b", "c", "d", "e", "f"];
const run = (...actions: SelectionAction[]) => actions.reduce<Selection>(selectionReducer, emptySelection);
const down = (index: number, keys: { shift?: boolean; ctrl?: boolean } = {}): SelectionAction => ({ type: "down", ids, index, shift: !!keys.shift, ctrl: !!keys.ctrl });
const enter = (index: number): SelectionAction => ({ type: "enter", ids, index });
const up: SelectionAction = { type: "up" };

describe("selectionReducer", () => {
  it("selects nothing on a plain click (it edits or opens instead)", () => {
    const state = run(down(2), up);
    expect(state.selected).toEqual([]);
    expect(state.anchor).toBe(2);
  });

  it("drag selects the range, in either direction, and reports it was a drag", () => {
    const dragging = run(down(1), enter(2), enter(3));
    expect(dragging.selected).toEqual(["b", "c", "d"]);
    expect(wasDrag(dragging)).toBe(true);
    expect(run(down(4), enter(3), enter(1), up).selected).toEqual(["b", "c", "d", "e"]);
    // Back over the start row keeps just that row once the drag has moved.
    expect(run(down(1), enter(2), enter(1), up).selected).toEqual(["b"]);
  });

  it("a new plain drag replaces the selection", () => {
    expect(run(down(0), enter(1), up, down(4), enter(5), up).selected).toEqual(["e", "f"]);
  });

  it("Shift+click extends from the anchor", () => {
    expect(run(down(1), up, down(4, { shift: true }), up).selected).toEqual(["b", "c", "d", "e"]);
    expect(run(down(0), enter(1), up, down(3, { shift: true })).selected).toEqual(["a", "b", "c", "d"]);
  });

  it("Ctrl/Cmd+click adds a separate row and takes a selected one out", () => {
    const added = run(down(0), enter(1), up, down(4, { ctrl: true }), up);
    expect(added.selected).toEqual(["a", "b", "e"]);
    expect(run(down(0), enter(1), up, down(1, { ctrl: true }), up).selected).toEqual(["a"]);
  });

  it("Ctrl/Cmd+drag adds another range, and Ctrl+Shift extends it, keeping the others", () => {
    const two = run(down(0), enter(1), up, down(3, { ctrl: true }), enter(4), up);
    expect(two.selected).toEqual(["a", "b", "d", "e"]);
    expect(selectionReducer(two, down(5, { shift: true, ctrl: true })).selected).toEqual(["a", "b", "d", "e", "f"]);
    // Shift alone replaces with one range from the anchor.
    expect(selectionReducer(two, down(5, { shift: true })).selected).toEqual(["d", "e", "f"]);
  });

  it("clears", () => {
    expect(selectionReducer(run(down(0), enter(2), up), { type: "clear" })).toEqual(emptySelection);
  });
});
