import { lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
// The app's client, named so pages render without a QueryClientProvider too (tests mount pages bare).
import { queryClient } from "./queryClient";
import { fieldDef, type SourceKey } from "../../shared/fields";
import { GRID_COLUMNS, layoutItemGone, recordPages, type LayoutBox, type SavedLayout } from "../../shared/layout";
import { Section } from "../components/shared";
import { BoxesView } from "../components/layout-boxes";
import { layoutApi } from "../services/layout";
import { layoutQueryKey, useLiveEdit } from "./copy";
import { usePageLayoutContext } from "./layout-state";

const FieldCardEditor = lazy(() => import("./field-card-editor"));

// Field boxes on a record page (FLOW-255): a card of the record's fields, each a
// box (label + value) on the card's inner 12-column grid, plus free-text boxes.
// With no saved boxes and outside edit mode the card renders the page's own
// markup (its children) exactly as before. In edit mode an Admin hides a box
// with ×, adds fields and text, and drags boxes into place. Required fields
// can't be hidden. Edit chrome wording isn't wrapped in <T>.


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
  }, queryClient);
  const pending = live.layoutPending[pageKey];
  const doc = pending === undefined ? ((query.data as SavedLayout | undefined)?.layout ?? null) : pending;
  return doc?.fieldBoxes[cardKey]?.boxes ?? null;
}

// Whether the record's Edit mode shows a field: every field with the code
// default, else only fields with a box (FLOW-255: Edit matches what's visible).
export function useShownFields(pageKey: string, cardKey: string): (field: string) => boolean {
  const boxes = useFieldBoxes(pageKey, cardKey);
  return (field) => Boolean(recordPages[pageKey] && fieldDef(recordPages[pageKey].source, field)?.required) || !boxes || boxes.some((box) => box.kind === "field" && box.field === field && !layoutItemGone(box));
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
    <Suspense fallback={null}><FieldCardEditor
      cardKey={cardKey}
      source={source}
      row={row}
      title={title}
      boxes={saved ?? defaultFieldBoxes(fields)}
      custom={saved !== undefined}
    /></Suspense>
  );
}

