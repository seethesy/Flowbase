import type { ReactNode } from "react";
import { PageHeader } from "../components/shared";
import { T } from "../app/copy";
import "./inventory-screen.css";

// The Inventory screen's heading (FLOW-266, tabs from FLOW-291), the same on its
// tabs (Inventory, Bar Inventory, Order, Vendors), each with its own line under
// it and actions.
const subtitles = {
  inventory: <T id="inventory-screen.inventory.rentals-decor-and-supplies">{"Rentals, decor and supplies, and the services you sell. Bar stock has its own tab; kitchen ingredients live under Kitchen."}</T>,
  bar: <T id="inventory-screen.bar.beer-wine-liquor-and-mixers">{"Beer, wine, liquor and mixers: what's in stock, what's low, and who supplies it."}</T>,
  order: <T id="inventory-screen.order.order-lists-approvals-and">{"Order lists, approvals, and everything at or below par, with what it costs to restock."}</T>,
  vendors: <T id="inventory-screen.vendors.distributors-rental-vendors-and">Distributors, rental vendors and event partners, and how to order from each.</T>,
};

// Each tab's page layout, so its heading lines can be edited there (FLOW-282).
const pageKeys: Record<keyof typeof subtitles, string> = {
  inventory: "inventory.list",
  bar: "inventory.bar",
  order: "inventory.order",
  vendors: "vendors.list",
};
export function InventoryHeading({ tab, children }: { tab: keyof typeof subtitles; children?: ReactNode }) {
  return (
    <PageHeader pageKey={pageKeys[tab]} title={<T id="inventory-screen.inventory-heading.inventory">Inventory</T>} subtitle={subtitles[tab]}>
      {children}
    </PageHeader>
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
