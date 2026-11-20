import { Children, isValidElement, lazy, Suspense, useState, type ReactElement, type ReactNode } from "react";
import { EyeOff, GripHorizontal, Palette, Pencil, Trash2 } from "lucide-react";
import {
  GRID_COLUMNS,
  MAX_BLOCKS,
  MAX_CARDS,
  recordPages,
  textVariants,
  type CardConfig,
  type LayoutBlock,
} from "../../shared/layout";
import { Button } from "../components/ui/button";
import { CustomCard } from "../components/custom-card";
import { boxPosition } from "../components/layout-boxes";
import { newBoxId, variantNames } from "./box-editor";
import {
  defaultBlocks,
  PageLayoutProvider,
  readingOrder,
  usePageLayout,
  withBuiltins,
  type BuiltinBlock,
  type PageLayout,
} from "./layout-state";
import { styleClass, styleVars, StylePopover } from "./layout-style";

// Both load only in edit mode, keeping react-grid-layout out of the first load.
const LayoutGridEditor = lazy(() => import("./layout-grid-editor"));
const CardBuilder = lazy(() => import("./card-builder").then((module) => ({ default: module.CardBuilder })));

// A page's arrangeable layout (FLOW-253). Each <Block> is one of the page's
// built-in sections. With no saved layout and outside edit mode the page renders
// its children exactly as before, with no wrapper. With a saved layout the
// blocks sit on a 12-column CSS grid (one column below 900px, in reading order),
// with the layout's custom cards and text blocks among them. In edit mode an
// Admin drags and resizes blocks, hides built-ins, adds cards and text, sets
// colors and resets the page. The edit chrome's wording isn't wrapped in <T>.

const ROW_HEIGHT = 24;

type BlockProps = {
  id: string;
  // The block's name in the edit chrome and the Hidden items tray.
  name: string;
  // Default width (of 12) and height (in 24px rows) in edit mode.
  w?: number;
  h?: number;
  children: ReactNode;
};

// A marker: PageGrid reads its props and places its children.
export function Block({ children }: BlockProps) {
  return <>{children}</>;
}

const newCard = (record: boolean): CardConfig => ({
  title: "New card",
  source: record ? { type: "record" } : { type: "list", list: "events" },
  filters: [],
  limit: 10,
  display: { type: "table", columns: [] },
});

const blockName = (block: LayoutBlock, builtins: BuiltinBlock[]) =>
  block.kind === "builtin"
    ? (builtins.find((b) => b.id === block.id)?.name ?? block.id)
    : block.kind === "card"
      ? block.card.title
      : variantNames[block.variant];

function TextBlock({ block }: { block: Extract<LayoutBlock, { kind: "text" }> }) {
  if (block.variant === "heading") return <h2 className="layout-text-heading">{block.text}</h2>;
  if (block.variant === "note") return <p className="layout-text-note">{block.text}</p>;
  return <p className="layout-text-body">{block.text}</p>;
}

export function PageGrid({
  pageKey,
  record = null,
  children,
}: {
  pageKey: string;
  record?: PageLayout["record"];
  children: ReactNode;
}) {
  const elements = Children.toArray(children).filter(
    (child): child is ReactElement<BlockProps> => isValidElement(child) && child.type === Block,
  );
  const builtins: BuiltinBlock[] = elements.map((element) => ({
    id: element.props.id,
    name: element.props.name,
    w: element.props.w ?? GRID_COLUMNS,
    h: element.props.h ?? 8,
  }));
  const content = new Map(elements.map((element) => [element.props.id, element.props.children]));
  const layout = usePageLayout(pageKey, builtins, record);
  if (!layout.doc && !layout.editing) return <PageLayoutProvider value={layout}>{children}</PageLayoutProvider>;
  const blocks = layout.doc ? withBuiltins(layout.doc, builtins) : defaultBlocks(builtins);
  return (
    <PageLayoutProvider value={layout}>
      {layout.editing ? (
        <PageGridEditor layout={layout} blocks={blocks} builtins={builtins} content={content} />
      ) : (
        <div className="page-grid" data-page-layout={pageKey}>
          {readingOrder(blocks.filter((block) => !(block.kind === "builtin" && block.hidden))).map((block) => (
            <div
              key={block.id}
              className={`page-grid-block ${styleClass(block.style)}`}
              style={{ ...boxPosition(block), ...styleVars(block.style) }}
              data-block-id={block.id}
            >
              <BlockContent block={block} content={content} record={layout.record} />
            </div>
          ))}
        </div>
      )}
    </PageLayoutProvider>
  );
}

function BlockContent({
  block,
  content,
  record,
}: {
  block: LayoutBlock;
  content: Map<string, ReactNode>;
  record: PageLayout["record"];
}) {
  if (block.kind === "builtin") return <>{content.get(block.id)}</>;
  if (block.kind === "card")
    return <CustomCard card={block.card} cardId={block.id} record={record ? { source: record.source, id: record.id } : null} />;
  return <TextBlock block={block} />;
}

function ConfirmButton({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (asking)
    return (
      <span className="layout-confirm" role="alertdialog" aria-label={question}>
        <span>{question}</span>
        <Button variant="destructive" onClick={onConfirm}>
          Delete
        </Button>
        <Button variant="ghost" onClick={() => setAsking(false)}>
          Keep
        </Button>
      </span>
    );
  return (
    <button type="button" aria-label={label} title={label} onClick={() => setAsking(true)}>
      <Trash2 size={14} />
    </button>
  );
}

function PageGridEditor({
  layout,
  blocks,
  builtins,
  content,
}: {
  layout: PageLayout;
  blocks: LayoutBlock[];
  builtins: BuiltinBlock[];
  content: Map<string, ReactNode>;
}) {
  // The card being built: a new one (id null) or an existing card block's.
  const [building, setBuilding] = useState<{ id: string | null; card: CardConfig } | null>(null);
  const [styling, setStyling] = useState<string | null>(null);
  const [tray, setTray] = useState(false);
  const [resetting, setResetting] = useState(false);
  const shown = blocks.filter((block) => !(block.kind === "builtin" && block.hidden));
  const hidden = blocks.filter((block) => block.kind === "builtin" && block.hidden);
  const cards = blocks.filter((block) => block.kind === "card").length;
  const full = blocks.length >= MAX_BLOCKS;
  const recordSource = recordPages[layout.pageKey]?.source ?? layout.record?.source ?? null;
  const change = (next: (blocks: LayoutBlock[]) => LayoutBlock[]) =>
    layout.update((doc) => ({ ...doc, blocks: next(withBuiltins(doc, builtins)) }));
  const patch = (id: string, values: Partial<LayoutBlock>) =>
    change((current) => current.map((block) => (block.id === id ? ({ ...block, ...values } as LayoutBlock) : block)));
  const bottom = Math.max(0, ...blocks.map((block) => block.y + block.h));
  const add = (block: LayoutBlock) => change((current) => [...current, block]);
  const addText = (variant: (typeof textVariants)[number]) =>
    add({
      kind: "text",
      id: newBoxId(variant, blocks.map((block) => block.id)),
      variant,
      text: variantNames[variant],
      x: 0,
      y: bottom,
      w: GRID_COLUMNS,
      h: variant === "heading" ? 2 : 3,
    });
  const remove = (id: string) => change((current) => current.filter((block) => block.id !== id));
  return (
    <div className="page-grid-editing" data-page-layout={layout.pageKey}>
      <div className="layout-toolbar" role="toolbar" aria-label="Page layout">
        <Button
          variant="outline"
          disabled={full || cards >= MAX_CARDS}
          title={full ? `A page holds at most ${MAX_BLOCKS} blocks.` : cards >= MAX_CARDS ? `A page holds at most ${MAX_CARDS} cards.` : undefined}
          onClick={() => setBuilding({ id: null, card: newCard(recordSource !== null) })}
        >
          Add card
        </Button>
        <select
          aria-label="Add text"
          className="layout-add-text"
          value=""
          disabled={full}
          onChange={(event) => {
            if (event.target.value) addText(event.target.value as (typeof textVariants)[number]);
          }}
        >
          <option value="">Add text…</option>
          {textVariants.map((variant) => (
            <option key={variant} value={variant}>
              {variantNames[variant]}
            </option>
          ))}
        </select>
        <div className="layout-tray">
          <Button variant="outline" aria-expanded={tray} onClick={() => setTray(!tray)}>
            {`Hidden items (${hidden.length})`}
          </Button>
          {tray && (
            <div className="layout-tray-list" role="dialog" aria-label="Hidden items">
              {hidden.length === 0 ? (
                <p className="muted">Nothing is hidden.</p>
              ) : (
                <ul>
                  {hidden.map((block) => (
                    <li key={block.id}>
                      <span>{blockName(block, builtins)}</span>
                      <Button variant="ghost" onClick={() => patch(block.id, { hidden: undefined, y: bottom })}>
                        Show
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {resetting ? (
          <span className="layout-confirm" role="alertdialog" aria-label="Reset page layout?">
            <span>Reset this page to its default layout? Custom cards, text and colors go too.</span>
            <Button
              variant="destructive"
              onClick={() => {
                layout.reset();
                setResetting(false);
              }}
            >
              Reset
            </Button>
            <Button variant="ghost" onClick={() => setResetting(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="ghost" disabled={!layout.saved && !layout.dirty} onClick={() => setResetting(true)}>
            Reset page layout
          </Button>
        )}
      </div>
      <Suspense fallback={<div className="skeleton" role="status" aria-label="Loading layout editor" />}>
        <LayoutGridEditor
          label="Page blocks"
          rowHeight={ROW_HEIGHT}
          items={shown}
          onChange={(items) =>
            change((current) =>
              current.map((block) => {
                const moved = items.find((item) => item.id === block.id);
                return moved ? ({ ...block, x: moved.x, y: moved.y, w: moved.w, h: moved.h } as LayoutBlock) : block;
              }),
            )
          }
          render={(id) => {
            const block = shown.find((b) => b.id === id)!;
            const name = blockName(block, builtins);
            return (
              <div
                className={`layout-block-frame ${styleClass(block.style)}`}
                style={styleVars(block.style)}
                data-block-id={block.id}
              >
                <div className="layout-block-bar">
                  <span className="layout-handle" title="Drag to move">
                    <GripHorizontal size={14} aria-hidden="true" />
                    {name}
                  </span>
                  <span className="layout-block-actions">
                    <button type="button" aria-label={`Style ${name}`} title="Style" onClick={() => setStyling(block.id)}>
                      <Palette size={14} />
                    </button>
                    {block.kind === "builtin" && (
                      <button type="button" aria-label={`Hide ${name}`} title="Hide" onClick={() => patch(block.id, { hidden: true })}>
                        <EyeOff size={14} />
                      </button>
                    )}
                    {block.kind === "card" && (
                      <button
                        type="button"
                        aria-label={`Edit ${name}`}
                        title="Edit card"
                        onClick={() => setBuilding({ id: block.id, card: block.card })}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {block.kind !== "builtin" && (
                      <ConfirmButton
                        label={`Delete ${name}`}
                        question={block.kind === "card" ? "Delete this card?" : "Delete this text?"}
                        onConfirm={() => remove(block.id)}
                      />
                    )}
                  </span>
                </div>
                {styling === block.id && (
                  <StylePopover
                    style={block.style}
                    onChange={(style) => patch(block.id, { style })}
                    onClose={() => setStyling(null)}
                  />
                )}
                <div className="layout-block-body">
                  {block.kind === "text" ? (
                    <textarea
                      className={`layout-text-input layout-text-input--${block.variant}`}
                      aria-label={`${variantNames[block.variant]} text`}
                      value={block.text}
                      maxLength={2000}
                      onChange={(event) => patch(block.id, { text: event.target.value })}
                    />
                  ) : (
                    <BlockContent block={block} content={content} record={layout.record} />
                  )}
                </div>
              </div>
            );
          }}
        />
      </Suspense>
      {building && (
        <Suspense fallback={null}>
          <CardBuilder
            initial={building.card}
            recordSource={recordSource}
            onCancel={() => setBuilding(null)}
            onDone={(card) => {
              if (building.id) patch(building.id, { card });
              else
                add({
                  kind: "card",
                  id: newBoxId("card", blocks.map((block) => block.id)),
                  card,
                  x: 0,
                  y: bottom,
                  w: 6,
                  h: 10,
                });
              setBuilding(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
