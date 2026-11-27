import type { CSSProperties } from "react";
import { canReadField, type SourceKey } from "../../shared/fields";
import { layoutItemGone, type LayoutBox } from "../../shared/layout";
import { usePermissions } from "../app/permissions";
import { readingOrder } from "../app/live-edit/layout-state";
import { styleClass, styleVars } from "../app/live-edit/layout-style-view";
import { FieldLabel, FieldValue } from "./layout-fields";

// Field boxes (label + value) and free-text boxes on a card's inner 12-column
// grid (FLOW-255/256), as everyone sees them. The grid's rows are 1px, so a
// box's top and height are exact pixels, as placed in edit mode (FLOW-357).
// Phones stack them in order. A viewer who can't read a field doesn't get its
// box at all.

export function boxPosition(box: { x: number; y: number; w: number; h: number }): CSSProperties {
  return { gridColumn: `${box.x + 1} / span ${box.w}`, gridRow: `${box.y + 1} / span ${box.h}` };
}

export function BoxContent({ box, source, row }: { box: LayoutBox; source: SourceKey; row: Record<string, unknown> | null }) {
  if (box.kind === "heading") return <h3 className="layout-box-heading">{box.text}</h3>;
  if (box.kind === "note") return <p className="layout-box-note">{box.text}</p>;
  if (box.kind === "text") return <p className="layout-box-text">{box.text}</p>;
  return (
    <>
      <small>
        <FieldLabel source={source} field={box.field!} />
      </small>
      <strong>{row ? <FieldValue source={source} field={box.field!} row={row} /> : "—"}</strong>
    </>
  );
}

export function useVisibleBoxes(boxes: LayoutBox[], source: SourceKey) {
  const { actor } = usePermissions();
  return boxes.filter((box) => !layoutItemGone(box) && (box.kind !== "field" || (actor !== null && canReadField(actor, source, box.field!))));
}

export function BoxesView({ boxes, source, row }: { boxes: LayoutBox[]; source: SourceKey; row: Record<string, unknown> | null }) {
  const visible = useVisibleBoxes(boxes, source);
  return (
    <div className="layout-boxes">
      {readingOrder(visible).map((box) => (
        <div
          key={box.id}
          className={`layout-box layout-box--${box.kind} ${styleClass(box.style)}`}
          style={{ ...boxPosition(box), ...styleVars(box.style) }}
          data-box-id={box.id}
        >
          <BoxContent box={box} source={source} row={row} />
        </div>
      ))}
    </div>
  );
}
