import { useEffect, useId } from "react";

// Screens with unsaved work (FLOW-325): an update to a new version of the app
// never reloads the page by itself while any of these are open.
const dirtyScreens = new Set<string>();

// Marks the calling screen as having unsaved changes while `dirty` is true.
export function useUnsavedEdits(dirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    dirtyScreens.add(id);
    return () => {
      dirtyScreens.delete(id);
    };
  }, [dirty, id]);
}

// True when reloading now could lose something the person typed: a screen that
// said so, an open drawer or dialog (create/edit forms), or a focused field.
export function hasUnsavedEdits(doc: Document = document): boolean {
  if (dirtyScreens.size > 0) return true;
  if (doc.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return true;
  const active = doc.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.isContentEditable) return true;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
  if (active instanceof HTMLInputElement) {
    return !["button", "submit", "reset", "checkbox", "radio", "hidden", "image"].includes(active.type);
  }
  return false;
}

// Tests only.
export const resetUnsavedEdits = () => dirtyScreens.clear();
