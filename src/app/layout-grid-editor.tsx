import type { ReactNode } from "react";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { GRID_COLUMNS } from "../../shared/layout";

// The drag-and-resize 12-column grid of admin layout editing (FLOW-253), for
// page blocks and for boxes inside a card (FLOW-255/256). Loaded only in edit
// mode, so it stays out of the app's first load. Items move by their handle
// (.layout-handle), so a click inside a block still edits its text.

export type GridItem = { id: string; x: number; y: number; w: number; h: number };

export default function LayoutGridEditor({
  items,
  render,
  onChange,
  rowHeight,
  label,
}: {
  items: GridItem[];
  render: (id: string) => ReactNode;
  onChange: (items: GridItem[]) => void;
  rowHeight: number;
  label: string;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const layout: Layout = items.map((item) => ({ i: item.id, x: item.x, y: item.y, w: item.w, h: item.h, minW: 1, minH: 1 }));
  const changed = (next: Layout) => {
    const moved = next.map((item) => ({ id: item.i, x: item.x, y: item.y, w: item.w, h: item.h }));
    const before = JSON.stringify(items.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })));
    const sorted = [...moved].sort((a, b) => items.findIndex((i) => i.id === a.id) - items.findIndex((i) => i.id === b.id));
    if (JSON.stringify(sorted) !== before) onChange(sorted);
  };
  return (
    <div ref={containerRef} className="layout-grid-editor" role="group" aria-label={label}>
      {mounted && (
        <ReactGridLayout
          layout={layout}
          width={width}
          gridConfig={{ cols: GRID_COLUMNS, rowHeight, margin: [12, 12], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, handle: ".layout-handle" }}
          resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
          onLayoutChange={changed}
        >
          {items.map((item) => (
            <div key={item.id} className="layout-grid-item" data-layout-id={item.id}>
              {render(item.id)}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
