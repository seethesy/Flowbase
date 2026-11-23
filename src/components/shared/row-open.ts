import type { KeyboardEvent, MouseEvent } from "react";

// A table row that opens its record on click (FLOW-296). The controls inside a
// row (status pills, owner pickers, inline editors, links, buttons) keep their
// clicks, pointer-downs and Enter/Space to themselves, so changing a value never
// opens the record. A dropdown's menu renders in a portal outside the row, but
// React still bubbles its events through the row, so an event from outside the
// row's own DOM counts as a control's too.

export const ROW_CONTROLS = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='option']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='switch']",
  "[role='dialog']",
  "[data-row-control]",
].join(", ");

type RowEvent = { target: EventTarget | null; currentTarget: EventTarget | null };

// Whether the event came from a control inside `currentTarget` (the row, or the
// row's open link), or from a portal the row's controls opened.
export function fromRowControl(event: RowEvent): boolean {
  const { target, currentTarget } = event;
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) return true;
  if (!currentTarget.contains(target)) return true;
  const control = target.closest(ROW_CONTROLS);
  return control !== null && control !== currentTarget && currentTarget.contains(control);
}

// Props for a <tr> that opens its record: a click anywhere but on a control,
// or Enter/Space on the row itself when it has focus.
export function rowOpenProps(open: () => void) {
  return {
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.button !== 0 || fromRowControl(event)) return;
      open();
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if ((event.key !== "Enter" && event.key !== " ") || event.target !== event.currentTarget) return;
      event.preventDefault();
      open();
    },
  };
}
