import { lazy, Suspense, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fieldDef, fieldRegistry, type SourceKey } from "../../shared/fields";
import { GRID_COLUMNS, type LayoutBox, type SavedLayout } from "../../shared/layout";
import { Section } from "../components/shared";
import { Button } from "../components/ui/button";
import { BoxContent, BoxesView, useVisibleBoxes } from "../components/layout-boxes";
import { layoutApi } from "../services/layout";
import { addFieldBox, addTextBox, AddFieldMenu, AddTextMenu, DeleteTextButton, variantNames } from "./box-editor";
import { layoutQueryKey, useLiveEdit } from "./copy";
import { usePageLayoutContext } from "./layout-state";
import { styleClass, styleVars, StylePopover } from "./layout-style";

const LayoutGridEditor = lazy(() => import("./layout-grid-editor"));

// Field boxes on a record page (FLOW-255): a card of the record's fields, each a
// box (label + value) on the card's inner 12-column grid, plus free-text boxes.
// With no saved boxes and outside edit mode the card renders the page's own
// markup (its children) exactly as before. In edit mode an Admin hides a box
// with ×, adds fields and text, and drags boxes into place. Required fields
// can't be hidden. Edit chrome wording isn't wrapped in <T>.

const BOX_ROW_HEIGHT = 28;

// The code's default boxes: its fields two to a row.
export function defaultFieldBoxes(fields: string[]): LayoutBox[] {
  return fields.map((field, index): LayoutBox => ({
    id: `field-${index + 1}`,
    kind: "field",
    field,
    x: (index % 2) * (GRID_COLUMNS / 2),
    y: Math.floor(index / 2) * 2,
    w: GRID_COLUMNS / 2,
    h: 2,
  }));
}

// The field card's boxes as saved or staged in this session, or null for the
// code default. Usable outside the PageGrid (the record's Edit form).
export function useFieldBoxes(pageKey: string, cardKey: string): LayoutBox[] | null {
  const live = useLiveEdit();
  const query = useQuery({
    queryKey: layoutQueryKey(pageKey),
    queryFn: () => layoutApi.get(pageKey),
    staleTime: 30 * 60_000,
  });
  const pending = live.layoutPending[pageKey];
  const doc = pending === undefined ? ((query.data as SavedLayout | undefined)?.layout ?? null) : pending;
  return doc?.fieldBoxes[cardKey]?.boxes ?? null;
}

// Whether the record's Edit mode shows a field: every field with the code
// default, else only fields with a box (FLOW-255: Edit matches what's visible).
export function useShownFields(pageKey: string, cardKey: string): (field: string) => boolean {
  const boxes = useFieldBoxes(pageKey, cardKey);
  return (field) => !boxes || boxes.some((box) => box.kind === "field" && box.field === field);
}

export function FieldCard({
  cardKey,
  source,
  row,
  title,
  fields,
  children,
}: {
  cardKey: string;
  source: SourceKey;
  row: Record<string, unknown>;
  // The card's title once its boxes are customized.
  title: ReactNode;
  // The code's fields, in order, for the default boxes.
  fields: string[];
  // The page's own markup, shown while nothing is saved.
  children: ReactNode;
}) {
  const layout = usePageLayoutContext();
  const saved = layout?.doc?.fieldBoxes[cardKey]?.boxes;
  if (!layout?.editing) {
    if (!saved) return <>{children}</>;
    return (
      <Section title={title}>
        <div className="layout-field-card" data-field-card={cardKey}>
          <BoxesView boxes={saved} source={source} row={row} />
        </div>
      </Section>
    );
  }
  return (
    <FieldCardEditor
      cardKey={cardKey}
      source={source}
      row={row}
      title={title}
      boxes={saved ?? defaultFieldBoxes(fields)}
      custom={saved !== undefined}
    />
  );
}

function FieldCardEditor({
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
          <AddFieldMenu source={source} boxes={boxes} onAdd={(field) => set(addFieldBox(visible, field))} />
          <AddTextMenu onAdd={(kind) => set(addTextBox(visible, kind))} />
          <Button variant="ghost" disabled={!custom} onClick={reset}>
            Reset fields
          </Button>
        </span>
      }
    >
      <div className="layout-field-card editing" data-field-card={cardKey}>
        <Suspense fallback={<div className="skeleton" role="status" aria-label="Loading field editor" />}>
          <LayoutGridEditor
            label={`Fields of ${cardKey}`}
            rowHeight={BOX_ROW_HEIGHT}
            items={visible}
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
                    <button type="button" className="layout-box-style" aria-label={`Style ${label}`} onClick={() => setStyling(box.id)}>
                      ◐
                    </button>
                    {box.kind === "field" ? (
                      !required.has(box.field!) && (
                        <button type="button" className="layout-box-remove" aria-label={`Hide ${label}`} onClick={() => remove(box.id)}>
                          <X size={14} />
                        </button>
                      )
                    ) : (
                      <DeleteTextButton label={label} onDelete={() => remove(box.id)} />
                    )}
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
