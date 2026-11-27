import { lazy, Suspense, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { fieldDef, fieldRegistry, type SourceKey } from "../../../shared/fields";
import { layoutItemGone, type LayoutBox } from "../../../shared/layout";
import { Section } from "../../components/shared";
import { Button } from "../../components/ui/button";
import { BoxContent, useVisibleBoxes } from "../../components/layout-boxes";
import { DeleteLayoutButton, useDeletion } from "./layout-deletion";
import { addFieldBox, addTextBox, AddFieldMenu, AddTextMenu, variantNames } from "./box-editor";
import { usePageLayoutContext } from "./layout-state";
import { styleClass, styleVars } from "./layout-style-view";
import { StylePopover } from "./layout-style";
import { widthPresets, withWidth } from "./layout-sizes";
const LayoutGridEditor = lazy(() => import("./layout-grid-editor"));

export default function FieldCardEditor({
  cardKey,
  source,
  row,
  title,
  boxes,
  custom,
}: {
  cardKey: string;
  source: SourceKey;
  row: Record<string, unknown>;
  title: ReactNode;
  boxes: LayoutBox[];
  custom: boolean;
}) {
  const layout = usePageLayoutContext()!;
  const deletion = useDeletion();
  const [styling, setStyling] = useState<string | null>(null);
  const visible = useVisibleBoxes(boxes, source);
  const required = new Set(fieldRegistry[source].fields.filter((field) => field.required).map((field) => field.key));
  // Boxes the viewer can't read stay saved as they are.
  const unseen = boxes.filter((box) => !visible.includes(box));
  const set = (next: LayoutBox[]) =>
    layout.update((doc) => ({ ...doc, fieldBoxes: { ...doc.fieldBoxes, [cardKey]: { boxes: [...next, ...unseen] } } }));
  const reset = () =>
    layout.update((doc) => {
      const fieldBoxes = { ...doc.fieldBoxes };
      // Reset fields must not resurrect tombstoned boxes. Only a page reset does.
      if (boxes.some(layoutItemGone)) return doc;
      delete fieldBoxes[cardKey];
      return { ...doc, fieldBoxes };
    });
  const remove = (id: string) => set(visible.filter((box) => box.id !== id));
  const patch = (id: string, values: Partial<LayoutBox>) =>
    set(visible.map((box) => (box.id === id ? { ...box, ...values } : box)));
  const name = (box: LayoutBox) =>
    box.kind === "field" ? (fieldDef(source, box.field!)?.label ?? box.field!) : variantNames[box.kind];
  return (
    <Section
      title={title}
      action={
        <span className="layout-field-card-actions">
          <AddFieldMenu source={source} boxes={boxes} onAdd={(field) => set(addFieldBox(boxes, field).filter((box) => !unseen.includes(box)))} />
          <AddTextMenu onAdd={(kind) => set(addTextBox(boxes, kind).filter((box) => !unseen.includes(box)))} />
          <Button variant="ghost" disabled={!custom || boxes.some(layoutItemGone)} onClick={reset}>
            Reset fields
          </Button>
        </span>
      }
    >
      <div className="layout-field-card editing" data-field-card={cardKey}>
        <Suspense fallback={<div className="skeleton" role="status" aria-label="Loading field editor" />}>
          <LayoutGridEditor
            label={`Fields of ${cardKey}`}
            items={visible}
            itemLabel={(id) => name(visible.find((box) => box.id === id)!)}
            onChange={(items) =>
              set(visible.map((box) => {
                const moved = items.find((item) => item.id === box.id);
                return moved ? { ...box, x: moved.x, y: moved.y, w: moved.w, h: moved.h } : box;
              }))
            }
            render={(id) => {
              const box = visible.find((b) => b.id === id)!;
              const label = name(box);
              return (
                <div className={`layout-box layout-box--${box.kind} ${styleClass(box.style)}`} style={styleVars(box.style)}>
                  <div className="layout-box-bar">
                    <span className="layout-handle" title="Drag to move" aria-hidden="true">
                      ⠿
                    </span>
                    <span className="layout-size-presets" role="group" aria-label={`Width of ${label}`}>
                      {widthPresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.w}
                          aria-label={`${preset.name}: ${label}`}
                          title={preset.name}
                          aria-pressed={box.w === preset.w}
                          onClick={() => patch(box.id, withWidth(box, preset.w))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </span>
                    <button type="button" className="layout-box-style" aria-label={`Style ${label}`} onClick={() => setStyling(box.id)}>
                      ◐
                    </button>
                    {box.kind === "field" ? (
                      !required.has(box.field!) && (
                        <button type="button" className="layout-box-remove" aria-label={`Hide ${label}`} onClick={() => remove(box.id)}>
                          <X size={14} />
                        </button>
                      )
                    ) : null}
                    <DeleteLayoutButton name={label} onDelete={() => patch(box.id, { deleted: deletion(label) })} />
                  </div>
                  {styling === box.id && (
                    <StylePopover style={box.style} onChange={(style) => patch(box.id, { style })} onClose={() => setStyling(null)} />
                  )}
                  {box.kind === "field" ? (
                    <BoxContent box={box} source={source} row={row} />
                  ) : (
                    <textarea
                      className={`layout-text-input layout-text-input--${box.kind}`}
                      aria-label={`${label} text`}
                      value={box.text ?? ""}
                      maxLength={2000}
                      onChange={(event) => patch(box.id, { text: event.target.value })}
                    />
                  )}
                </div>
              );
            }}
          />
        </Suspense>
      </div>
    </Section>
  );
}
