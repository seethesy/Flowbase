import { createContext, useContext, type ReactNode } from "react";
import ReactGridLayout, { noCompactor, useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { GRID_COLUMNS } from "../../shared/layout";
import { keyboardStep } from "./layout-sizes";

// The drag-and-resize 12-column grid of admin layout editing (FLOW-253), for
// page blocks and for boxes inside a card (FLOW-255/256). Loaded only in edit
// mode, so it stays out of the app's first load. Items move by their handle
// (.layout-handle), so a click inside a block still edits its text, and by the
// arrow keys when focused (FLOW-278).

export type { GridItem } from "./layout-sizes";
import type { GridItem } from "./layout-sizes";

// How deep this grid sits inside other grids' items: a card's boxes inside a
// page block, or a tab's blocks inside an event section (FLOW-278). A drag that
// starts inside a nested grid moves only the nested item.
const GridDepth = createContext(0);

export default function LayoutGridEditor({
  items,
  render,
  onChange,
  rowHeight,
  label,
  itemLabel,
}: {
  items: GridItem[];
  render: (id: string) => ReactNode;
  onChange: (items: GridItem[]) => void;
  rowHeight: number;
  label: string;
  // Each item's name for keyboard users.
  itemLabel?: (id: string) => string;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const depth = useContext(GridDepth);
  const layout: Layout = items.map((item) => ({ i: item.id, x: item.x, y: item.y, w: item.w, h: item.h, minW: 1, minH: 1 }));
  const changed = (next: Layout) => {
    const moved = next.map((item) => ({ id: item.i, x: item.x, y: item.y, w: item.w, h: item.h }));
    const before = JSON.stringify(items.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
    const sorted = [...moved].sort((a, b) => items.findIndex((i) => i.id === a.id) - items.findIndex((i) => i.id === b.id));
    if (JSON.stringify(sorted) !== before) onChange(sorted);
  };
  return (
    <div ref={containerRef} className="layout-grid-editor" data-grid-depth={depth} role="group" aria-label={label}>
      {mounted && (
        <ReactGridLayout
          layout={layout}
          width={width}
          gridConfig={{ cols: GRID_COLUMNS, rowHeight, margin: [12, 12], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, handle: ".layout-handle", cancel: `[data-grid-depth="${depth + 1}"]` }}
          resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
          // Saved positions stay as placed (view mode places blocks the same
          // way); only a drag or resize the Admin makes changes the layout.
          compactor={noCompactor}
          onDragStop={(next) => changed(next)}
          onResizeStop={(next) => changed(next)}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="layout-grid-item"
              data-layout-id={item.id}
              tabIndex={0}
              aria-label={itemLabel ? `${itemLabel(item.id)}: arrow keys move, Shift and arrow keys resize` : undefined}
              onKeyDown={(event) => {
                // Only the item itself: arrows inside an input or popover keep their meaning.
                if (event.target !== event.currentTarget) return;
                const next = keyboardStep(item, event.key, event.shiftKey);
                if (!next) return;
                event.preventDefault();
                onChange(items.map((current) => (current.id === item.id ? { ...current, ...next } : current)));
              }}
            >
              <GridDepth.Provider value={depth + 1}>{render(item.id)}</GridDepth.Provider>
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
