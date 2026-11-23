import { Dropdown } from "../components/ui/Dropdown";
import { lazy, Suspense, useState } from "react";
import { Trash2 } from "lucide-react";
import { fieldDef, fieldRegistry, readableFields, sourceKeys, type SourceKey } from "../../shared/fields";
import {
  cardConfigSchema,
  MAX_CARD_ROWS,
  operatorsFor,
  type CardConfig,
  type CardFilter,
  type LayoutBox,
} from "../../shared/layout";
import { Button } from "../components/ui/button";
import { ColumnPicker } from "./column-picker";
import { BoxEditorList } from "./box-editor";
import { usePermissions } from "./permissions";
import { styleClass, styleVars } from "./layout-style-view";
import { StylePopover } from "./layout-style";

const LayoutGridEditor = lazy(() => import("./layout-grid-editor"));

// The custom card builder (FLOW-256), a side panel in edit mode: title, source,
// filters, sort and row limit, and a table or boxes display. Edit chrome: its
// wording isn't wrapped in <T>.

const operatorNames: Record<string, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  before: "before",
  after: "after",
  within_days: "within next N days",
  is_me: "is me",
  is_empty: "is empty",
};

export function cardSourceKey(card: CardConfig, recordSource: SourceKey | null): SourceKey | null {
  if (card.source.type === "list") return card.source.list;
  if (!recordSource) return null;
  if (card.source.type === "record") return recordSource;
  const relation = card.source.relation;
  return fieldRegistry[recordSource].relations?.find((r) => r.key === relation)?.source ?? null;
}

// Switching a card's source (FLOW-279): columns, boxes, filters and sort whose
// field the new source also has stay; the rest are dropped and named.
export function switchCardSource(
  card: CardConfig,
  next: CardConfig["source"],
  recordSource: SourceKey | null,
): { card: CardConfig; dropped: string[] } {
  const from = cardSourceKey(card, recordSource);
  const to = cardSourceKey({ ...card, source: next }, recordSource);
  const dropped: string[] = [];
  const keeps = (field: string) => {
    const ok = Boolean(to && fieldDef(to, field));
    const label = (from && fieldDef(from, field)?.label) ?? field;
    if (!ok && !dropped.includes(label)) dropped.push(label);
    return ok;
  };
  const filters = card.filters.filter((filter) => {
    if (!keeps(filter.field)) return false;
    const def = fieldDef(to!, filter.field)!;
    return Boolean(def.filterable) && operatorsFor(def.type).includes(filter.op);
  });
  const sort = card.sort && keeps(card.sort.field) && fieldDef(to!, card.sort.field)?.sortable ? card.sort : undefined;
  const display: CardConfig["display"] =
    card.display.type === "table"
      ? { type: "table", columns: card.display.columns.filter((column) => keeps(column.key)) }
      : { type: "boxes", boxes: card.display.boxes.filter((box) => box.kind !== "field" || keeps(box.field!)) };
  return { card: { ...card, source: next, filters, sort, display }, dropped };
}

export function CardBuilder({
  initial,
  recordSource,
  lockSource = false,
  onReset,
  onDone,
  onCancel,
}: {
  initial: CardConfig;
  // The record page's source, for "This record" and related lists.
  recordSource: SourceKey | null;
  // A built-in card (FLOW-279): its title and source stay the card's own.
  lockSource?: boolean;
  // "Reset card": back to the built-in card's code default.
  onReset?: () => void;
  onDone: (card: CardConfig) => void;
  onCancel: () => void;
}) {
  const { actor } = usePermissions();
  const [card, setCard] = useState<CardConfig>(initial);
  // The box whose Style popover is open (FLOW-273).
  const [styling, setStyling] = useState<string | null>(null);
  // What the last source switch dropped (FLOW-279).
  const [dropped, setDropped] = useState<string[]>([]);
  const source = cardSourceKey(card, recordSource);
  const fields = source && actor ? readableFields(actor, source) : [];
  const set = (patch: Partial<CardConfig>) => setCard((current) => ({ ...current, ...patch }));
  const sourceValue =
    card.source.type === "list" ? `list:${card.source.list}` : card.source.type === "related" ? `related:${card.source.relation}` : "record";
  const changeSource = (value: string) => {
    const [type, key] = value.split(":");
    const next: CardConfig["source"] =
      type === "list" ? { type: "list", list: key as SourceKey } : type === "related" ? { type: "related", relation: key } : { type: "record" };
    const switched = switchCardSource(card, next, recordSource);
    setCard(switched.card);
    setDropped(switched.dropped);
  };
  const setFilter = (index: number, filter: CardFilter) =>
    set({ filters: card.filters.map((current, i) => (i === index ? filter : current)) });
  const valid = cardConfigSchema.safeParse(card).success;
  const isList = card.source.type !== "record";
  const boxes = card.display.type === "boxes" ? card.display.boxes : [];
  const setBoxes = (next: LayoutBox[]) => set({ display: { type: "boxes", boxes: next } });
  return (
    <aside className="layout-card-builder" role="dialog" aria-label="Card builder">
      <h2>{lockSource ? `Edit ${initial.title}` : initial.title === "New card" ? "Add card" : "Edit card"}</h2>
      {lockSource && (
        <p className="layout-scope-note">
          A built-in card: its title and source stay as they are. Choose its fields, filters, sort and rows.
        </p>
      )}
      <label className="form-field">
        <span>Title</span>
        <input value={card.title} maxLength={120} disabled={lockSource} onChange={(event) => set({ title: event.target.value })} />
      </label>
      <label className="form-field">
        <span>Source</span>
        <Dropdown value={sourceValue} disabled={lockSource} onChange={(event) => changeSource(event.target.value)} aria-label="Source">
          {recordSource && <option value="record">This record</option>}
          {recordSource &&
            fieldRegistry[recordSource].relations?.map((relation) => (
              <option key={relation.key} value={`related:${relation.key}`}>
                {`Related: ${relation.label}`}
              </option>
            ))}
          {sourceKeys.map((key) => (
            <option key={key} value={`list:${key}`}>
              {`Main list: ${fieldRegistry[key].label}`}
            </option>
          ))}
        </Dropdown>
      </label>
      {dropped.length > 0 && (
        <p role="status" className="layout-scope-note">{`Not in this source, so dropped: ${dropped.join(", ")}.`}</p>
      )}
      {isList && source && (
        <fieldset className="layout-card-filters">
          <legend>Filters</legend>
          {card.filters.map((filter, index) => {
            const def = fieldDef(source, filter.field);
            const operators = def ? operatorsFor(def.type) : [];
            return (
              <div key={index} className="layout-filter-row">
                <Dropdown
                  aria-label="Filter field"
                  value={filter.field}
                  onChange={(event) => {
                    const next = fieldDef(source, event.target.value)!;
                    setFilter(index, { field: next.key, op: operatorsFor(next.type)[0] });
                  }}
                >
                  {fields
                    .filter((field) => field.filterable)
                    .map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                </Dropdown>
                <Dropdown
                  aria-label="Filter operator"
                  value={filter.op}
                  onChange={(event) => setFilter(index, { ...filter, op: event.target.value as CardFilter["op"] })}
                >
                  {operators.map((op) => (
                    <option key={op} value={op}>
                      {operatorNames[op]}
                    </option>
                  ))}
                </Dropdown>
                {filter.op !== "is_me" && filter.op !== "is_empty" && (
                  def?.options && (filter.op === "is" || filter.op === "is_not") ? (
                    <Dropdown
                      aria-label="Filter value"
                      value={String(filter.value ?? "")}
                      onChange={(event) => setFilter(index, { ...filter, value: event.target.value })}
                    >
                      <option value="">Choose…</option>
                      {Object.entries(def.options.labels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Dropdown>
                  ) : (
                    <input
                      aria-label="Filter value"
                      type={filter.op === "within_days" || def?.type === "number" ? "number" : def?.type === "date" || def?.type === "datetime" ? "date" : "text"}
                      value={String(filter.value ?? "")}
                      onChange={(event) =>
                        setFilter(index, {
                          ...filter,
                          value: filter.op === "within_days" ? Number(event.target.value) : event.target.value,
                        })
                      }
                    />
                  )
                )}
                <button
                  type="button"
                  aria-label="Remove filter"
                  onClick={() => set({ filters: card.filters.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {card.filters.length < 10 && fields.some((field) => field.filterable) && (
            <Button
              variant="outline"
              onClick={() => {
                const first = fields.find((field) => field.filterable)!;
                set({ filters: [...card.filters, { field: first.key, op: operatorsFor(first.type)[0] }] });
              }}
            >
              Add filter
            </Button>
          )}
        </fieldset>
      )}
      {isList && source && (
        <div className="layout-card-sort">
          <label className="form-field">
            <span>Sort by</span>
            <Dropdown
              aria-label="Sort by"
              value={card.sort?.field ?? ""}
              onChange={(event) =>
                set({ sort: event.target.value ? { field: event.target.value, dir: card.sort?.dir ?? "asc" } : undefined })
              }
            >
              <option value="">No sort</option>
              {fields
                .filter((field) => field.sortable)
                .map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
            </Dropdown>
          </label>
          {card.sort && (
            <Dropdown
              aria-label="Sort direction"
              value={card.sort.dir}
              onChange={(event) => set({ sort: { ...card.sort!, dir: event.target.value as "asc" | "desc" } })}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Dropdown>
          )}
          <label className="form-field">
            <span>Rows</span>
            <input
              type="number"
              aria-label="Row limit"
              min={1}
              max={MAX_CARD_ROWS}
              value={card.limit}
              onChange={(event) => set({ limit: Math.max(1, Math.min(MAX_CARD_ROWS, Number(event.target.value) || 1)) })}
            />
          </label>
        </div>
      )}
      {source && (
        <fieldset className="layout-card-display">
          <legend>Display</legend>
          <label>
            <input
              type="radio"
              name="card-display"
              checked={card.display.type === "table"}
              onChange={() => set({ display: { type: "table", columns: [] } })}
            />
            Table
          </label>
          <label>
            <input
              type="radio"
              name="card-display"
              checked={card.display.type === "boxes"}
              onChange={() => set({ display: { type: "boxes", boxes: [] } })}
            />
            Boxes
          </label>
          {card.display.type === "table" ? (
            <ColumnPicker
              source={source}
              columns={card.display.columns}
              onChange={(columns) => set({ display: { type: "table", columns } })}
            />
          ) : (
            <>
              <BoxEditorList source={source} boxes={boxes} onChange={setBoxes} />
              {boxes.length > 0 && (
                <Suspense fallback={null}>
                  <LayoutGridEditor
                    label="Box layout"
                    rowHeight={28}
                    items={boxes}
                    itemLabel={(id) => {
                      const box = boxes.find((b) => b.id === id)!;
                      return box.kind === "field" ? (fieldDef(source, box.field!)?.label ?? box.field!) : box.text || box.kind;
                    }}
                    render={(id) => {
                      const box = boxes.find((b) => b.id === id)!;
                      const label = box.kind === "field" ? (fieldDef(source, box.field!)?.label ?? box.field!) : box.text || box.kind;
                      return (
                        <div className={`layout-box-frame ${styleClass(box.style)}`} style={styleVars(box.style)}>
                          <span className="layout-handle">⠿</span>
                          {label}
                          <button
                            type="button"
                            className="layout-box-style"
                            aria-label={`Style ${label}`}
                            onClick={() => setStyling(box.id)}
                          >
                            ◐
                          </button>
                          {styling === box.id && (
                            <StylePopover
                              style={box.style}
                              onChange={(style) => setBoxes(boxes.map((b) => (b.id === box.id ? { ...b, style } : b)))}
                              onClose={() => setStyling(null)}
                            />
                          )}
                        </div>
                      );
                    }}
                    onChange={(items) =>
                      setBoxes(boxes.map((box) => ({ ...box, ...items.find((item) => item.id === box.id) })))
                    }
                  />
                </Suspense>
              )}
            </>
          )}
        </fieldset>
      )}
      {!valid && <p className="live-copy-error">Give the card a title and at least one column or box.</p>}
      <div className="form-actions">
        <Button disabled={!valid} onClick={() => onDone(cardConfigSchema.parse(card))}>
          Done
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {onReset && (
          <Button variant="outline" onClick={onReset}>
            Reset card
          </Button>
        )}
      </div>
    </aside>
  );
}

