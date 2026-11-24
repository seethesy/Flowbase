import { Dropdown } from "../../components/ui/Dropdown";
import { lazy, Suspense, useState } from "react";
import { ArrowDown, ArrowUp, LayoutGrid, Table2, Trash2 } from "lucide-react";
import { fieldDef, fieldRegistry, readableFields, sourceKeys, type FieldDef, type SourceKey } from "../../../shared/fields";
import {
  cardConfigSchema,
  MAX_CARD_ROWS,
  operatorsFor,
  type CardConfig,
  type CardFilter,
  type LayoutBox,
  layoutItemGone,
} from "../../../shared/layout";
import { Button } from "../../components/ui/button";
import { RoundCheck } from "../../components/ui/round-check";
import { SegmentedControl } from "../../components/ui/segmented-control";
import { CustomCard } from "../../components/custom-card";
import { addFieldBox, BoxEditorList } from "./box-editor";
import { usePermissions } from "../permissions";
import { styleClass, styleVars } from "./layout-style-view";
import { StylePopover } from "./layout-style";

const LayoutGridEditor = lazy(() => import("./layout-grid-editor"));

// The custom card builder (FLOW-256), a side panel in edit mode. FLOW-327 order:
// Title, Source, Display as (Table | Boxes), Fields (one picker for both
// displays), Which rows (filters, sort, rows) and a live preview, then Save card,
// disabled with a reason until the card has a source and a field. The card
// config format is unchanged. Edit chrome: its wording isn't wrapped in <T>.

// Rows the preview shows at most.
const PREVIEW_ROWS = 3;

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

// The fields a card shows, in order (FLOW-327): a table's columns, or a boxes
// card's field boxes (text boxes and deleted boxes aren't fields).
export function pickedFields(card: CardConfig): string[] {
  if (card.display.type === "table") return card.display.columns.map((column) => column.key);
  return card.display.boxes.filter((box) => box.kind === "field" && !layoutItemGone(box)).map((box) => box.field!);
}

// The card with exactly these fields, in this order. Columns keep their saved
// widths and boxes their places; a newly picked field joins at the end.
export function withPickedFields(card: CardConfig, keys: string[]): CardConfig {
  if (card.display.type === "table") {
    const columns = card.display.columns;
    return { ...card, display: { type: "table", columns: keys.map((key) => columns.find((column) => column.key === key) ?? { key }) } };
  }
  const wanted = new Set(keys);
  let boxes = card.display.boxes.filter((box) => box.kind !== "field" || layoutItemGone(box) || wanted.has(box.field!));
  const placed = new Set(pickedFields({ ...card, display: { type: "boxes", boxes } }));
  for (const key of keys) if (!placed.has(key)) boxes = addFieldBox(boxes, key);
  return { ...card, display: { type: "boxes", boxes } };
}

// Switching Table | Boxes carries the picked fields over.
export function switchDisplay(card: CardConfig, type: CardConfig["display"]["type"]): CardConfig {
  if (card.display.type === type) return card;
  const keys = pickedFields(card);
  return type === "table"
    ? { ...card, display: { type: "table", columns: keys.map((key) => ({ key })) } }
    : { ...card, display: { type: "boxes", boxes: keys.reduce<LayoutBox[]>((boxes, key) => addFieldBox(boxes, key), []) } };
}

// Why Save card is disabled (FLOW-327 AC4), or null when the card can be saved.
export function cardSaveProblem(card: CardConfig, source: SourceKey | null): string | null {
  if (!source) return "Choose a source for this card.";
  if (!card.title.trim()) return "Give the card a title.";
  if (!pickedFields(card).length) return "Pick at least one field to show.";
  if (!cardConfigSchema.safeParse(card).success) return "Finish the card's settings: a filter may be missing its value.";
  return null;
}

// One field picker for both displays (FLOW-327): search, then the picked
// fields numbered in their order with arrows to move them, then the rest.
function FieldPicker({
  fields,
  picked,
  noun,
  onChange,
}: {
  fields: FieldDef[];
  picked: string[];
  noun: "columns" | "fields";
  onChange: (keys: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const label = (key: string) => fields.find((field) => field.key === key)?.label ?? key;
  const required = (key: string) => Boolean(fields.find((field) => field.key === key)?.required);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= picked.length) return;
    const next = [...picked];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  const rest = fields.filter((field) => !picked.includes(field.key) && (!term || field.label.toLowerCase().includes(term)));
  return (
    <div className="layout-field-picker">
      <input type="search" aria-label="Search fields" placeholder="Search fields…" value={search} onChange={(event) => setSearch(event.target.value)} />
      {picked.length > 0 && (
        <ol className="layout-field-picked" aria-label={`Shown ${noun}, in order`}>
          {picked.map((key, index) => (
            <li key={key}>
              <span className="layout-field-order" aria-hidden="true">{index + 1}</span>
              <label>
                <RoundCheck
                  checked
                  disabled={required(key)}
                  aria-label={`Show ${label(key)}`}
                  onChange={() => onChange(picked.filter((other) => other !== key))}
                />
                {label(key)}
              </label>
              <span className="layout-column-moves">
                <button type="button" aria-label={`Move ${label(key)} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                  <ArrowUp size={12} />
                </button>
                <button type="button" aria-label={`Move ${label(key)} down`} disabled={index === picked.length - 1} onClick={() => move(index, index + 1)}>
                  <ArrowDown size={12} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <ul className="layout-field-options" aria-label="More fields">
        {rest.map((field) => (
          <li key={field.key}>
            <label>
              <RoundCheck checked={false} aria-label={`Show ${field.label}`} onChange={() => onChange([...picked, field.key])} />
              {field.label}
            </label>
          </li>
        ))}
        {!rest.length && <li className="muted">{term ? "No field matches." : "Every field is shown."}</li>}
      </ul>
    </div>
  );
}

export function CardBuilder({
  initial,
  recordSource,
  record = null,
  lockSource = false,
  onReset,
  onDone,
  onCancel,
}: {
  initial: CardConfig;
  // The record page's source, for "This record" and related lists.
  recordSource: SourceKey | null;
  // The record on screen, for the preview's rows.
  record?: { source: SourceKey; id: string } | null;
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
  const problem = cardSaveProblem(card, source);
  const isList = card.source.type !== "record";
  const boxes = card.display.type === "boxes" ? card.display.boxes : [];
  const setBoxes = (next: LayoutBox[]) => set({ display: { type: "boxes", boxes: next } });
  const picked = pickedFields(card);
  const relations = recordSource ? (fieldRegistry[recordSource].relations ?? []) : [];
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
      <small className="layout-field-help layout-field-help--below">The heading shown on the card.</small>
      <label className="form-field">
        <span>Source</span>
        <Dropdown value={sourceValue} disabled={lockSource} onChange={(event) => changeSource(event.target.value)} aria-label="Source">
          {recordSource && (
            <optgroup label="This record">
              <option value="record">This record</option>
            </optgroup>
          )}
          {relations.length > 0 && (
            <optgroup label="Related list">
              {relations.map((relation) => (
                <option key={relation.key} value={`related:${relation.key}`}>
                  {relation.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Main list">
            {sourceKeys.map((key) => (
              <option key={key} value={`list:${key}`}>
                {fieldRegistry[key].label}
              </option>
            ))}
          </optgroup>
        </Dropdown>
      </label>
      <small className="layout-field-help layout-field-help--below">Where the card's rows come from.</small>
      {dropped.length > 0 && (
        <p role="status" className="layout-scope-note">{`Not in this source, so dropped: ${dropped.join(", ")}.`}</p>
      )}
      {source && (
        <div className="form-field">
          <span id="card-display-label">Display as</span>
          <SegmentedControl
            label="Display as"
            value={card.display.type}
            options={[
              { value: "table", label: "Table", icon: <Table2 size={14} /> },
              { value: "boxes", label: "Boxes", icon: <LayoutGrid size={14} /> },
            ]}
            onChange={(type) => setCard((current) => switchDisplay(current, type))}
          />
          <small className="layout-field-help">
            {card.display.type === "table" ? "One row per record, fields as columns." : "Each record as a block of labeled fields."}
          </small>
        </div>
      )}
      {source && (
        <fieldset className="layout-card-fields">
          <legend>Fields</legend>
          <small className="layout-field-help">
            {card.display.type === "table" ? "Pick the columns, in the order they show." : "Pick the fields, in the order they're added."}
          </small>
          <FieldPicker
            fields={fields}
            picked={picked}
            noun={card.display.type === "table" ? "columns" : "fields"}
            onChange={(keys) => setCard((current) => withPickedFields(current, keys))}
          />
          {card.display.type === "boxes" && (
            <>
              <BoxEditorList source={source} boxes={boxes} onChange={setBoxes} textOnly />
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
      {isList && source && (
        <fieldset className="layout-card-rows">
          <legend>Which rows</legend>
          {card.filters.length > 0 && (
            <div className="layout-card-filters" role="group" aria-label="Filters">
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
                      className="layout-delete"
                      aria-label="Remove filter"
                      onClick={() => set({ filters: card.filters.filter((_, i) => i !== index) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {card.filters.length < 10 && fields.some((field) => field.filterable) && (
            <Button
              variant="outline"
              className="layout-add-filter"
              onClick={() => {
                const first = fields.find((field) => field.filterable)!;
                set({ filters: [...card.filters, { field: first.key, op: operatorsFor(first.type)[0] }] });
              }}
            >
              Add filter
            </Button>
          )}
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
        </fieldset>
      )}
      {source && picked.length > 0 && (
        <section className="layout-card-preview" aria-label="Preview">
          <h3>Preview</h3>
          <small className="layout-field-help">The first rows, as you see them.</small>
          <CustomCard card={{ ...card, limit: Math.min(card.limit, PREVIEW_ROWS) }} cardId="card-preview" record={record} preview />
        </section>
      )}
      {problem && (
        <p className="live-copy-error" id="card-save-problem" role="status">
          {problem}
        </p>
      )}
      <div className="form-actions">
        <Button
          disabled={problem !== null}
          aria-describedby={problem ? "card-save-problem" : undefined}
          onClick={() => onDone(cardConfigSchema.parse(card))}
        >
          Save card
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {onReset && (
          <Button variant="ghost" onClick={onReset}>
            Reset card
          </Button>
        )}
      </div>
    </aside>
  );
}
