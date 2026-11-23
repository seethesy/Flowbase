import { lazy, Suspense, useState, type ReactNode } from "react";
import { EyeOff, GripHorizontal, Palette, Pencil } from "lucide-react";
import { Dropdown } from "../components/ui/Dropdown";
import { Button } from "../components/ui/button";
import { builtinCard, layoutItemGone, GRID_COLUMNS, MAX_BLOCKS, MAX_CARDS, recordPages, textVariants, type CardConfig, type LayoutBlock } from "../../shared/layout";
import { fieldRegistry } from "../../shared/fields";
import { DeleteLayoutButton, useDeletion } from "./layout-deletion";
import { newBoxId, variantNames } from "./box-editor";
import { withBuiltins, type BuiltinBlock, type PageLayout } from "./layout-state";
import { styleClass, styleVars } from "./layout-style-view";
import { StylePopover } from "./layout-style";
import { widthPresets, withWidth } from "./layout-sizes";
import { BlockContent, blockName } from "./page-grid";
const DeletedItemsTray = lazy(() => import("./layout-deleted-tray").then((module) => ({ default: module.DeletedItemsTray })));
const LayoutGridEditor = lazy(() => import("./layout-grid-editor"));
const CardBuilder = lazy(() => import("./card-builder").then((module) => ({ default: module.CardBuilder })));
const ROW_HEIGHT = 24;

const newCard = (record: boolean): CardConfig => ({
  title: "New card",
  source: record ? { type: "record" } : { type: "list", list: "events" },
  filters: [],
  limit: 10,
  display: { type: "table", columns: [] },
});

export default function PageGridEditor({
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
  // A built-in card's values (FLOW-279) are edited the same way, source locked.
  const [building, setBuilding] = useState<{ id: string | null; card: CardConfig; builtin?: boolean } | null>(null);
  const [styling, setStyling] = useState<string | null>(null);
  const deletion = useDeletion();
  const [tray, setTray] = useState(false);
  const [resetting, setResetting] = useState(false);
  const shown = blocks.filter((block) => !layoutItemGone(block) && !(block.kind === "builtin" && block.hidden));
  const hidden = blocks.filter((block) => !layoutItemGone(block) && block.kind === "builtin" && block.hidden);
  const cards = blocks.filter((block) => !layoutItemGone(block) && block.kind === "card").length;
  const full = blocks.filter((block) => !layoutItemGone(block)).length >= MAX_BLOCKS;
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
  const remove = (block: LayoutBlock) => patch(block.id, { deleted: deletion(blockName(block, builtins)) });
  return (
    <div className="page-grid-editing" data-page-layout={layout.pageKey}>
      <div className="layout-toolbar" role="toolbar" aria-label="Page layout">
        {recordSource && (
          <span className="layout-scope-note">
            {`One layout for every record in ${fieldRegistry[recordSource].label}: changes here show on all of them.`}
          </span>
        )}
        <Button
          variant="outline"
          disabled={full || cards >= MAX_CARDS}
          title={full ? `A page holds at most ${MAX_BLOCKS} blocks.` : cards >= MAX_CARDS ? `A page holds at most ${MAX_CARDS} cards.` : undefined}
          onClick={() => setBuilding({ id: null, card: newCard(recordSource !== null) })}
        >
          Add card
        </Button>
        <Dropdown
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
        </Dropdown>
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
                      <DeleteLayoutButton name={blockName(block, builtins)} onDelete={() => remove(block)} />
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
        <Suspense fallback={null}><DeletedItemsTray /></Suspense>
        {resetting ? (
          <span className="layout-confirm" role="alertdialog" aria-label="Reset page layout?">
            <span>Reset this page to its default layout? Custom cards, text and colors go too. Permanently removed built-in items return.</span>
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
          itemLabel={(id) => blockName(shown.find((block) => block.id === id)!, builtins)}
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
                data-fit={block.fit ? "true" : undefined}
                data-hide-phone={block.hidePhone ? "true" : undefined}
                style={styleVars(block.style)}
                data-block-id={block.id}
              >
                <div className="layout-block-bar">
                  <span className="layout-handle" title="Drag to move">
                    <GripHorizontal size={14} aria-hidden="true" />
                    {name}
                  </span>
                  <span className="layout-block-actions">
                    <span className="layout-size-presets" role="group" aria-label={`Width of ${name}`}>
                      {widthPresets.map((preset) => (
                        <button
                          type="button"
                          key={preset.w}
                          aria-label={`${preset.name}: ${name}`}
                          title={preset.name}
                          aria-pressed={block.w === preset.w}
                          onClick={() => patch(block.id, withWidth(block, preset.w))}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-label={`Fit content: ${name}`}
                        title="Fit content: the height follows what the card shows"
                        aria-pressed={Boolean(block.fit)}
                        onClick={() => patch(block.id, { fit: block.fit ? undefined : true })}
                      >
                        Fit
                      </button>
                      <button
                        type="button"
                        aria-label={`Hide on phone: ${name}`}
                        title="Hide on phone"
                        aria-pressed={Boolean(block.hidePhone)}
                        onClick={() => patch(block.id, { hidePhone: block.hidePhone ? undefined : true })}
                      >
                        No phone
                      </button>
                    </span>
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
                    {block.kind === "builtin" && builtinCard(layout.pageKey, block.id, block.data) && (
                      <button
                        type="button"
                        aria-label={`Edit ${name}`}
                        title="Edit what this card shows"
                        onClick={() => setBuilding({ id: block.id, card: builtinCard(layout.pageKey, block.id, block.data)!, builtin: true })}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <DeleteLayoutButton name={name} onDelete={() => remove(block)} />
                  </span>
                </div>
                {styling === block.id && (
                  <StylePopover
                    style={block.style}
                    onChange={(style) => patch(block.id, { style })}
                    visibleTo={block.kind === "text" ? undefined : block.visibleTo}
                    onVisibleToChange={
                      block.kind === "text"
                        ? undefined
                        : (visibleTo) => patch(block.id, { visibleTo })
                    }
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
                    <BlockContent pageKey={layout.pageKey} block={block} content={content} record={layout.record} />
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
            lockSource={building.builtin}
            onReset={
              building.builtin && building.id
                ? () => {
                    patch(building.id!, { data: undefined });
                    setBuilding(null);
                  }
                : undefined
            }
            onCancel={() => setBuilding(null)}
            onDone={(card) => {
              if (building.builtin && building.id)
                patch(building.id, { data: { filters: card.filters, sort: card.sort, limit: card.limit, display: card.display } });
              else if (building.id) patch(building.id, { card });
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
