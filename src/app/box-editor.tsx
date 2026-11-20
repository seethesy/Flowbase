import { useState } from "react";
import { X } from "lucide-react";
import { fieldDef, readableFields, type SourceKey } from "../../shared/fields";
import { GRID_COLUMNS, textVariants, type LayoutBox } from "../../shared/layout";
import { Button } from "../components/ui/button";
import { usePermissions } from "./permissions";

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

// The first free spot below every box, half width for fields, full for text.
export function placeBox(boxes: LayoutBox[], w: number): { x: number; y: number; w: number; h: number } {
  const bottom = Math.max(0, ...boxes.map((box) => box.y + box.h));
  const last = boxes.filter((box) => box.y + box.h === bottom).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  if (last && last.x + last.w + w <= GRID_COLUMNS && last.h === 2 && w < GRID_COLUMNS)
    return { x: last.x + last.w, y: last.y, w, h: 2 };
  return { x: 0, y: bottom, w, h: 2 };
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
    <select
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
    </select>
  );
}

export function AddTextMenu({ onAdd }: { onAdd: (kind: (typeof textVariants)[number]) => void }) {
  return (
    <select
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
    </select>
  );
}

// Asks before a free-text box goes: its wording can't be brought back.
export function DeleteTextButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  if (asking)
    return (
      <span className="layout-confirm" role="alertdialog" aria-label={`Delete ${label}?`}>
        <span>Delete this text?</span>
        <Button variant="destructive" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)}>
          Keep
        </Button>
      </span>
    );
  return (
    <button type="button" className="layout-box-remove" aria-label={`Delete ${label}`} onClick={() => setAsking(true)}>
      <X size={14} />
    </button>
  );
}

// The box list of the card builder's Boxes display: add, edit text, remove.
export function BoxEditorList({
  source,
  boxes,
  onChange,
}: {
  source: SourceKey;
  boxes: LayoutBox[];
  onChange: (boxes: LayoutBox[]) => void;
}) {
  const remove = (id: string) => onChange(boxes.filter((box) => box.id !== id));
  return (
    <div className="layout-box-editor">
      <ul>
        {boxes.map((box) => (
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
                <DeleteTextButton label={variantNames[box.kind]} onDelete={() => remove(box.id)} />
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="layout-box-adds">
        <AddFieldMenu source={source} boxes={boxes} onAdd={(field) => onChange(addFieldBox(boxes, field))} />
        <AddTextMenu onAdd={(kind) => onChange(addTextBox(boxes, kind))} />
      </div>
    </div>
  );
}
