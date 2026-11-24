import { LayoutBlockContext } from "./layout-deletion";
import { Children, isValidElement, lazy, Suspense, type ReactElement, type ReactNode } from "react";
import {
  builtinCard,
  layoutItemGone,
  GRID_COLUMNS,
  type LayoutBlock,
} from "../../../shared/layout";
import { CustomCard } from "../../components/custom-card";
import { boxPosition } from "../../components/layout-boxes";
import { variantNames } from "./box-editor";
import {
  defaultBlocks,
  PageLayoutProvider,
  readingOrder,
  usePageLayout,
  withBuiltins,
  type BuiltinBlock,
  type PageLayout,
} from "./layout-state";
import { styleClass, styleVars } from "./layout-style-view";
import { usePermissions } from "../permissions";
import {
  cardShown,
  dashboardCards,
  DASHBOARD_PAGE_KEY,
  levelOf,
  policyMatrix,
  sourceArea,
} from "../../../shared/role-permissions";
import type { Role } from "../../../shared/access";

// The entire layout toolbar and editor are loaded only when an Admin edits.
const PageGridEditor = lazy(() => import("./page-grid-editor"));

// A page's arrangeable layout (FLOW-253). Each <Block> is one of the page's
// built-in sections. With no saved layout and outside edit mode the page renders
// its children exactly as before, with no wrapper. With a saved layout the
// blocks sit on a 12-column CSS grid (one column below 900px, in reading order),
// with the layout's custom cards and text blocks among them. In edit mode an
// Admin drags and resizes blocks, hides built-ins, adds cards and text, sets
// colors and resets the page. The edit chrome's wording isn't wrapped in <T>.


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
export function Block({ id, children }: BlockProps) {
  return <LayoutBlockContext.Provider value={id}>{children}</LayoutBlockContext.Provider>;
}

export const blockName = (block: LayoutBlock, builtins: BuiltinBlock[]) =>
  block.kind === "builtin"
    ? (builtins.find((b) => b.id === block.id)?.name ?? block.id)
    : block.kind === "card"
      ? block.card.title
      : variantNames[block.variant];

// Whether a block shows to this role (FLOW-269): the card's visibleTo roles, and
// the role must be able to read the card's source area. Edit mode shows every
// block so an Admin can always reach them.
export function blockVisible(pageKey: string, block: LayoutBlock, role: Role | undefined): boolean {
  if (!role || block.kind === "text") return true;
  if (!cardShown(block.visibleTo, role)) return false;
  const matrix = policyMatrix();
  if (pageKey === DASHBOARD_PAGE_KEY && block.kind === "builtin") {
    const card = dashboardCards.find((c) => c.key === block.id);
    return !card || levelOf(matrix, role, card.area) !== "none";
  }
  if (block.kind === "card" && block.card.source.type === "list") {
    const area = sourceArea[block.card.source.list];
    return !area || levelOf(matrix, role, area) !== "none";
  }
  return true;
}

// A block's wrapper classes and grid place as everyone sees it (FLOW-278):
// "Fit content" spans one auto-height row from its saved row, "Hide on phone"
// hides it below 900px.
export function blockClass(block: LayoutBlock) {
  return [styleClass(block.style), block.fit && "layout-fit", block.hidePhone && "layout-hide-phone"].filter(Boolean).join(" ");
}
export function blockPlace(block: LayoutBlock) {
  const place = boxPosition(block);
  return block.fit ? { ...place, gridRow: `${block.y + 1} / span 1` } : place;
}

function TextBlock({ block }: { block: Extract<LayoutBlock, { kind: "text" }> }) {
  if (block.variant === "heading") return <h2 className="layout-text-heading">{block.text}</h2>;
  if (block.variant === "note") return <p className="layout-text-note">{block.text}</p>;
  return <p className="layout-text-body">{block.text}</p>;
}

export function PageGrid({
  pageKey,
  record = null,
  blockIds,
  children,
}: {
  pageKey: string;
  record?: PageLayout["record"];
  // Every id a <Block> here can have, when the ids aren't literal (built from a
  // list). The key manifest (FLOW-277, scripts/live-edit-keys.mjs) reads it.
  blockIds?: readonly string[];
  children: ReactNode;
}) {
  const elements = Children.toArray(children).filter(
    (child): child is ReactElement<BlockProps> => isValidElement(child) && child.type === Block,
  );
  if (import.meta.env.DEV && blockIds)
    for (const element of elements)
      if (!blockIds.includes(element.props.id))
        console.error(`PageGrid ${pageKey}: block "${element.props.id}" is missing from blockIds.`);
  const builtins: BuiltinBlock[] = elements.map((element) => ({
    id: element.props.id,
    name: element.props.name,
    w: element.props.w ?? GRID_COLUMNS,
    h: element.props.h ?? 8,
  }));
  const content = new Map(elements.map((element) => [element.props.id, element.props.children]));
  const layout = usePageLayout(pageKey, builtins, record);
  const { actor } = usePermissions();
  // No saved layout: the page as its code lays it out, minus the cards this role
  // can't read (FLOW-269).
  if (!layout.doc && !layout.editing)
    return (
      <PageLayoutProvider value={layout}>
        {Children.toArray(children).filter(
          (child) =>
            !isValidElement<BlockProps>(child) ||
            child.type !== Block ||
            blockVisible(pageKey, { kind: "builtin", id: child.props.id, x: 0, y: 0, w: 1, h: 1 }, actor?.role),
        )}
      </PageLayoutProvider>
    );
  const blocks = layout.doc ? withBuiltins(layout.doc, builtins) : defaultBlocks(builtins);
  return (
    <PageLayoutProvider value={layout}>
      {layout.editing ? (
        <Suspense fallback={null}><PageGridEditor layout={layout} blocks={blocks} builtins={builtins} content={content} /></Suspense>
      ) : (
        <div className="page-grid" data-page-layout={pageKey}>
          {readingOrder(blocks.filter((block) => !layoutItemGone(block) && !(block.kind === "builtin" && block.hidden) && blockVisible(pageKey, block, actor?.role))).map((block) => (
            <div
              key={block.id}
              className={`page-grid-block ${blockClass(block)}`}
              style={{ ...blockPlace(block), ...styleVars(block.style) }}
              data-block-id={block.id}
            >
              <BlockContent pageKey={pageKey} block={block} content={content} record={layout.record} />
            </div>
          ))}
        </div>
      )}
    </PageLayoutProvider>
  );
}

export function BlockContent({
  pageKey,
  block,
  content,
  record,
}: {
  pageKey: string;
  block: LayoutBlock;
  content: Map<string, ReactNode>;
  record: PageLayout["record"];
}) {
  if (block.kind === "builtin") {
    // A built-in card whose values the Admin edited (FLOW-279) renders through
    // the custom-card path, which asks only for fields the viewer may read.
    const edited = block.data ? builtinCard(pageKey, block.id, block.data) : null;
    if (!edited) return <LayoutBlockContext.Provider value={block.id}>{content.get(block.id)}</LayoutBlockContext.Provider>;
    return <CustomCard card={edited} cardId={block.id} record={record ? { source: record.source, id: record.id } : null} />;
  }
  if (block.kind === "card")
    return <CustomCard card={block.card} cardId={block.id} record={record ? { source: record.source, id: record.id } : null} />;
  return <TextBlock block={block} />;
}

