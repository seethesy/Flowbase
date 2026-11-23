import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/shared";
import { T } from "../app/copy";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { allPages, countsApi, inventoryApi, sectionsApi } from "../services/core";
import { orderListsApi } from "../services/order-lists";
import "./inventory-screen.css";

// The Inventory screen's heading (FLOW-266), the same on its five tabs
// (Inventory, Bar, Purchasing, Vendors, Imports), each with its own line under
// it and actions.
const subtitles = {
  inventory: <T id="inventory-screen.inventory.rentals-decor-and-supplies">{"Rentals, decor and supplies, and the services you sell. Bar stock has its own tab; kitchen ingredients live under Kitchen."}</T>,
  bar: <T id="inventory-screen.bar.beer-wine-liquor-and-mixers">{"Beer, wine, liquor and mixers: what's in stock, what's low, and who supplies it."}</T>,
  purchasing: <T id="inventory-screen.purchasing.order-lists-cover-a-date">Order lists cover a date range of events. Build one, get it approved, then record each vendor order and what arrives.</T>,
  vendors: <T id="inventory-screen.vendors.distributors-rental-vendors-and">Distributors, rental vendors and event partners, and how to order from each.</T>,
  imports: <T id="inventory-screen.imports.bring-records-in-from">Bring records in from a spreadsheet. Re-running a file updates what it imported before.</T>,
};

export function InventoryHeading({ tab, children }: { tab: keyof typeof subtitles; children?: ReactNode }) {
  return (
    <PageHeader title={<T id="inventory-screen.inventory-heading.inventory">Inventory</T>} subtitle={subtitles[tab]}>
      {children}
    </PageHeader>
  );
}

// Items the Inventory tab lists: everything but bar stock (its own tab) and
// kitchen ingredients (Kitchen).
export const inventoryTabExcludes = "bar,ingredient";

// The Inventory tab's shortcut cards (FLOW-266): low stock (items below par on
// this tab), stock counts in progress, storage sections, the master sheet and
// kitchen order lists still open. A card whose count the viewer can't read
// shows without it.
export function InventoryShortcuts() {
  const { can } = usePermissions();
  const low = useResource(["inventory-items", "below-par-count"], async () =>
    (await allPages((cursor) => inventoryApi.list({ belowPar: true, excludeSubtypes: inventoryTabExcludes }, cursor))).length);
  const counts = useResource(["inventory-counts", "open-count"], async () =>
    (await allPages((cursor) => countsApi.list({ status: "open" }, cursor))).length, { enabled: can("inventory.count") });
  const sections = useResource(["sections", "count"], async () => (await sectionsApi.list()).length, { reference: true });
  const lists = useResource(["order-lists"], orderListsApi.list, { enabled: can("order_lists.write") });
  const openLists = lists.data?.filter((list) => !["received", "cancelled"].includes(list.status)).length;
  const cards: { key: string; to: string; title: ReactNode; detail: ReactNode; alert?: boolean }[] = [
    {
      key: "low-stock",
      to: "/inventory/low-stock",
      title: <T id="inventory-screen.shortcuts.low-stock">Low stock</T>,
      detail: low.data === undefined ? null : <T id="inventory-screen.shortcuts.items-below-par" values={{ count: low.data }}>{"{count} items below par"}</T>,
      alert: Boolean(low.data),
    },
    {
      key: "counts",
      to: "/inventory/counts",
      title: <T id="inventory-screen.shortcuts.stock-counts">Stock counts</T>,
      detail: counts.data === undefined ? null : <T id="inventory-screen.shortcuts.counts-in-progress" values={{ count: counts.data }}>{"{count} in progress"}</T>,
    },
    {
      key: "sections",
      to: "/inventory/sections",
      title: <T id="inventory-screen.shortcuts.storage-sections">Storage sections</T>,
      detail: sections.data === undefined ? null : <T id="inventory-screen.shortcuts.sections" values={{ count: sections.data }}>{"{count} sections"}</T>,
    },
    {
      key: "master",
      to: "/inventory/master",
      title: <T id="inventory-screen.shortcuts.master-inventory">Master inventory</T>,
      detail: <T id="inventory-screen.shortcuts.every-item-all-kinds">Every item, all kinds</T>,
    },
    {
      key: "kitchen-orders",
      to: "/kitchen/orders",
      title: <T id="inventory-screen.shortcuts.kitchen-orders">Kitchen orders</T>,
      detail: openLists === undefined ? null : <T id="inventory-screen.shortcuts.open-order-lists" values={{ count: openLists }}>{"{count} open order lists"}</T>,
    },
  ];
  return (
    <nav className="inventory-shortcuts" aria-label="Inventory shortcuts">
      {cards.map((card) => (
        <Link key={card.key} to={card.to} className="inventory-shortcut">
          <strong>{card.title}</strong>
          {card.detail && <small className={card.alert ? "alert" : undefined}>{card.detail}</small>}
        </Link>
      ))}
    </nav>
  );
}

// Stock state for the Stock column (FLOW-266): services aren't stocked; an item
// with nothing on hand is out; one under its par level is low.
export type StockState = "service" | "out" | "low" | "in_stock";
export function stockState(item: { kind: string; totalQuantity: number; belowPar: boolean | null }): StockState {
  if (item.kind === "service") return "service";
  if (item.totalQuantity <= 0) return "out";
  return item.belowPar ? "low" : "in_stock";
}
const stockLabels: Record<StockState, string> = { service: "Service", out: "Out", low: "Low", in_stock: "In stock" };
const stockTone: Record<StockState, string> = { service: "neutral", out: "error", low: "warning", in_stock: "success" };
export const stockLabel = (state: StockState) => stockLabels[state];
export function StockPill({ state }: { state: StockState }) {
  return <span className={`badge ${stockTone[state]}`}><LabelStock state={state} /></span>;
}
function LabelStock({ state }: { state: StockState }) {
  switch (state) {
    case "service": return <T id="inventory-screen.stock.service">Service</T>;
    case "out": return <T id="inventory-screen.stock.out">Out</T>;
    case "low": return <T id="inventory-screen.stock.low">Low</T>;
    default: return <T id="inventory-screen.stock.in-stock">In stock</T>;
  }
}
