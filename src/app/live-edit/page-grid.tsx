import { LayoutBlockContext } from "./layout-deletion";
import {
  Children,
  createContext,
  isValidElement,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { builtinCard, GRID_COLUMNS, type LayoutBlock, type LayoutDoc } from "../../../shared/layout";
import { blockShown, gridTemplate, keptPlace, keptTracks, rowPixels, rowTemplate } from "../../../shared/page-grid";
import { CustomCard } from "../../components/custom-card";
import { variantNames } from "./box-editor";
import {
  codeDefault,
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
// blocks sit on the page grid (FLOW-319/320): columns keep their shares of the
// content width; each row is its own percentage of the screen height (FLOW-357),
// so rows adding up to more than the screen make the page scroll. Each block
// fills its cell or merged region, empty cells keeping their space. In edit mode
// an Admin edits that grid (FLOW-321). The edit chrome's wording isn't wrapped
// in <T>.

// Set inside a page grid's cell: a PageGrid there (an event tab's grid). Its
// rows follow the same rule (FLOW-357 A1) and the outer cell scrolls; only its
// edit toolbar sits differently.
export const GridNesting = createContext(false);
// Gap between tracks, px (matches .page-grid).
export const GRID_GAP = 12;

// The screen height rows are a percentage of (FLOW-357): the window's height
// less the app header, the same on every page of the device.
export function screenHeight() {
  if (typeof window === "undefined") return 0;
  const header = document.querySelector<HTMLElement>(".top-header");
  return Math.max(0, window.innerHeight - (header?.offsetHeight ?? 0));
}

// The grid's frame: its width is the content width (columns' shares of it) and
// `screen` the screen height (rows' percentages of it). Recomputed on resize.
// The editor draws in the same frame, so edit and view agree to the pixel.
export function useGridFrame() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ width: 0, screen: screenHeight() }));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, screen: screenHeight() };
      setSize((current) => (current.width === next.width && current.screen === next.screen ? current : next));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);
  return { ref, width: size.width, screen: size.screen };
}

type BlockProps = {
  id: string;
  // The block's name in the edit chrome and the Hidden items tray.
  name: string;
  // Height of its row in the code default grid, relative to the others (FLOW-319).
  // w is kept for existing call sites; the code default is one column.
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

// A block's wrapper classes as everyone sees it (FLOW-278): "Hide on phone"
// hides it below 900px and its cell stays empty (FLOW-319 A4).
export function blockClass(block: LayoutBlock) {
  return [styleClass(block.style), block.hidePhone && "layout-hide-phone"].filter(Boolean).join(" ");
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
  const doc = layout.doc ? withBuiltins(layout.doc, builtins) : codeDefault(builtins);
  return (
    <PageLayoutProvider value={layout}>
      {layout.editing ? (
        <Suspense fallback={null}><PageGridEditor layout={layout} doc={doc} builtins={builtins} content={content} /></Suspense>
      ) : (
        <GridView pageKey={pageKey} doc={doc} content={content} record={layout.record} role={actor?.role} />
      )}
    </PageLayoutProvider>
  );
}

// View mode (FLOW-320): no guides, labels or controls. A block the code didn't
// render this time (another tab, a permission) or that this role can't see is
// absent: a row or column holding only absent blocks collapses, the other
// columns keep their ratios and the other rows their heights; tracks authored
// empty keep their space (FLOW-320 A3). Each row is exactly its percentage of
// the screen height (FLOW-357).
function GridView({
  pageKey,
  doc,
  content,
  record,
  role,
}: {
  pageKey: string;
  doc: LayoutDoc;
  content: Map<string, ReactNode>;
  record: PageLayout["record"];
  role: Role | undefined;
}) {
  const shown = doc.blocks.filter(blockShown);
  const present = shown.filter(
    (block) => blockVisible(pageKey, block, role) && (block.kind !== "builtin" || content.has(block.id)),
  );
  const kept = keptTracks(doc.grid, shown, present);
  const frame = useGridFrame();
  return (
    <div
      ref={frame.ref}
      className="page-grid"
      data-page-layout={pageKey}
      style={{
        gridTemplateColumns: gridTemplate(kept.cols.map((index) => doc.grid.cols[index])),
        gridTemplateRows: rowTemplate(rowPixels(kept.rows.map((index) => doc.grid.rows[index]), frame.screen)),
      }}
    >
      {readingOrder(present).map((block) => (
        <div
          key={block.id}
          className={`page-grid-block ${blockClass(block)}`}
          style={{ ...keptPlace(block, kept), ...styleVars(block.style) }}
          data-block-id={block.id}
        >
          <GridNesting.Provider value={true}>
            <BlockContent pageKey={pageKey} block={block} content={content} record={record} />
          </GridNesting.Provider>
        </div>
      ))}
    </div>
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

