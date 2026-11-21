import { createContext, useContext } from "react";
import type { SourceKey } from "../../shared/fields";
import type { LayoutDoc } from "../../shared/layout";

// The surrounding page's layout (FLOW-253), on its own with type-only imports so
// that the always-loaded shared components can read it without pulling the
// layout schemas and field registry into the first load.

export type PageLayout = {
  pageKey: string;
  // The record a record page shows ("This record" cards, field cards).
  record: { source: SourceKey; id: string; row?: Record<string, unknown> } | null;
  saved: LayoutDoc | null;
  // Pending in this session, else saved; null with neither (the code default).
  doc: LayoutDoc | null;
  editing: boolean;
  // Applies a change to the current document (the code default when none),
  // staging it for the session's Save.
  update: (change: (doc: LayoutDoc) => LayoutDoc) => void;
  // Back to the code default on Save, colors included.
  reset: () => void;
  dirty: boolean;
};

const PageLayoutContext = createContext<PageLayout | null>(null);
export const PageLayoutProvider = PageLayoutContext.Provider;
// The surrounding page's layout; null outside a PageGrid.
export const usePageLayoutContext = () => useContext(PageLayoutContext);
