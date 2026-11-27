import { DeleteLayoutButton, useDeletion } from "./layout-deletion";
import { Dropdown } from "../../components/ui/Dropdown";
import { X } from "lucide-react";
import { fieldDef, readableFields, type SourceKey } from "../../../shared/fields";
import { GRID_COLUMNS, layoutItemGone, textVariants, type LayoutBox } from "../../../shared/layout";
import { usePermissions } from "../permissions";
import { BOX_GAP_PX, boxRowsToPx } from "../../../shared/page-grid";

// Adding and removing boxes on a card's inner grid (FLOW-255/256): field boxes
// from the source's registry and free-text boxes (Heading, Text, Note). Edit
// chrome: its wording isn't wrapped in <T>.

export const variantNames: Record<(typeof textVariants)[number], string> = {
  heading: "Heading",
  text: "Text",
  note: "Note",
};

// A fresh id that no box or block uses yet.
export function newBoxId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) return id;
  }
}

// A new box's height in pixels (FLOW-357): two of the former 28px rows.
export const NEW_BOX_HEIGHT = boxRowsToPx({ y: 0, h: 2 }).h;

// The first free spot below every box (8px under it), half width for fields,
// full for text; top and height in pixels.
export function placeBox(boxes: LayoutBox[], w: number): { x: number; y: number; w: number; h: number } {
  const bottom = Math.max(0, ...boxes.map((box) => box.y + box.h));
  const last = boxes.filter((box) => box.y + box.h === bottom).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  if (last && last.x + last.w + w <= GRID_COLUMNS && last.h === NEW_BOX_HEIGHT && w < GRID_COLUMNS)
    return { x: last.x + last.w, y: last.y, w, h: NEW_BOX_HEIGHT };
  return { x: 0, y: bottom ? bottom + BOX_GAP_PX : 0, w, h: NEW_BOX_HEIGHT };
}

export function addFieldBox(boxes: LayoutBox[], field: string): LayoutBox[] {
  return [...boxes, { id: newBoxId("field", boxes.map((box) => box.id)), kind: "field", field, ...placeBox(boxes, 6) }];
}
export function addTextBox(boxes: LayoutBox[], kind: (typeof textVariants)[number]): LayoutBox[] {
  return [
    ...boxes,
    { id: newBoxId(kind, boxes.map((box) => box.id)), kind, text: variantNames[kind], ...placeBox(boxes, GRID_COLUMNS) },
  ];
}

// The Add field menu: readable fields not yet on the card.
export function AddFieldMenu({
  source,
  boxes,
  onAdd,
}: {
  source: SourceKey;
  boxes: LayoutBox[];
  onAdd: (field: string) => void;
}) {
  const { actor } = usePermissions();
  const placed = new Set(boxes.flatMap((box) => (box.kind === "field" ? [box.field] : [])));
  const options = actor ? readableFields(actor, source).filter((field) => !placed.has(field.key)) : [];
  if (!options.length) return null;
  return (
    <Dropdown
      className="layout-add-field"
      aria-label="Add field"
      value=""
      onChange={(event) => {
        if (event.target.value) onAdd(event.target.value);
      }}
    >
      <option value="">Add field…</option>
      {options.map((field) => (
        <option key={field.key} value={field.key}>
          {field.label}
        </option>
      ))}
    </Dropdown>
  );
}

export function AddTextMenu({ onAdd }: { onAdd: (kind: (typeof textVariants)[number]) => void }) {
  return (
    <Dropdown
      className="layout-add-text"
      aria-label="Add text"
      value=""
      onChange={(event) => {
        if (event.target.value) onAdd(event.target.value as (typeof textVariants)[number]);
      }}
    >
      <option value="">Add text…</option>
      {textVariants.map((kind) => (
        <option key={kind} value={kind}>
          {variantNames[kind]}
        </option>
      ))}
    </Dropdown>
  );
}

// The box list of the card builder's Boxes display: add, edit text, remove.
export function BoxEditorList({
  source,
  boxes,
  onChange,
  textOnly = false,
}: {
  source: SourceKey;
  boxes: LayoutBox[];
  onChange: (boxes: LayoutBox[]) => void;
  // The card builder picks field boxes in its Fields picker (FLOW-327): here
  // only text boxes are listed and added.
  textOnly?: boolean;
}) {
  const deletion = useDeletion();
  const remove = (id: string) => onChange(boxes.filter((box) => box.id !== id));
  return (
    <div className="layout-box-editor">
      <ul>
        {boxes.filter((box) => !layoutItemGone(box) && !(textOnly && box.kind === "field")).map((box) => (
          <li key={box.id}>
            {box.kind === "field" ? (
              <>
                <span>{fieldDef(source, box.field!)?.label ?? box.field}</span>
                <button type="button" className="layout-box-remove" aria-label={`Hide ${fieldDef(source, box.field!)?.label ?? box.field}`} onClick={() => remove(box.id)}>
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <input
                  aria-label={`${variantNames[box.kind]} text`}
                  value={box.text ?? ""}
                  maxLength={2000}
                  onChange={(event) =>
                    onChange(boxes.map((b) => (b.id === box.id ? { ...b, text: event.target.value } : b)))
                  }
                />

              </>
            )}
            <DeleteLayoutButton name={box.kind === "field" ? (fieldDef(source, box.field!)?.label ?? box.field!) : variantNames[box.kind]}
              onDelete={() => onChange(boxes.map((b) => b.id === box.id ? { ...b, deleted: deletion(b.kind === "field" ? (fieldDef(source, b.field!)?.label ?? b.field!) : variantNames[b.kind]) } : b))} />
          </li>
        ))}
      </ul>
      <div className="layout-box-adds">
        {!textOnly && <AddFieldMenu source={source} boxes={boxes} onAdd={(field) => onChange(addFieldBox(boxes, field))} />}
        <AddTextMenu onAdd={(kind) => onChange(addTextBox(boxes, kind))} />
      </div>
    </div>
  );
}
