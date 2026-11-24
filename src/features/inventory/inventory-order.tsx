import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { InventoryItem, InventoryList } from "../../../shared/inventory";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Allowed, usePermissions } from "../../app/permissions";
import { LoadMore, usePagedList } from "../../app/paging";
import { T } from "../../app/copy";
import { LoadError } from "../../components/record-display";
import { Button, DataTable, EmptyState, LoadingSkeleton } from "../../components/shared";
import { inventoryApi } from "../../services/core";
import { queryClient } from "../../app/queryClient";
import { orderListsApi } from "../../services/order-lists";
import { centsLabel, purchaseLabel, quantityLabel } from "./inventory-labels";
import { InventoryHeading } from "./inventory-screen";
import { OrderListsTable } from "./purchasing";

// What an item needs to get back to par, in its own unit.
const needed = (item: InventoryItem) =>
  Math.max((item.consumable?.parLevel ?? 0) - item.totalQuantity, 0);
const estimatedCents = (item: InventoryItem) => {
  const cost = item.consumable?.unitCostCents;
  return cost === null || cost === undefined ? null : Math.round(needed(item) * cost);
};

const titles: Record<InventoryList, ReactNode> = {
  master: <T id="inventory-order.reorder.inventory">Inventory</T>,
  bar: <T id="inventory-order.reorder.bar-inventory">Bar Inventory</T>,
  kitchen: <T id="inventory-order.reorder.kitchen-ingredients">Kitchen ingredients</T>,
};

// One list's reorder table (FLOW-292 AC3): its items at or below par (the shared rule,
// FLOW-82), never services. Row and bulk "Add to order list" put items on the
// newest draft order list with what they need.
function ReorderTable({ list }: { list: InventoryList }) {
  const { can } = usePermissions();
  const items = usePagedList(["inventory-items", "reorder", list], (cursor) =>
    inventoryApi.list({ list, kind: "consumable", belowPar: true }, cursor),
  );
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const add = async (ids: string[], clear?: () => void) => {
    setError("");
    setAdded("");
    try {
      const draft = await orderListsApi.addToDraft(ids);
      setAdded(draft.id);
      clear?.();
      // The order lists table above shows the change.
      void queryClient.invalidateQueries({ queryKey: ["order-lists"] });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const canOrder = can("order_lists.write");
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    {
      accessorKey: "name",
      header: "Item",
      cell: ({ row }) => <Link to={`/inventory/${row.original.id}`}>{row.original.name}</Link>,
    },
    { id: "onHand", header: "On hand", accessorFn: (item) => quantityLabel(item.totalQuantity, item.unit) },
    { id: "par", header: "Par", accessorFn: (item) => quantityLabel(item.consumable?.parLevel ?? 0, item.unit) },
    { id: "needed", header: "Needed", accessorFn: (item) => quantityLabel(needed(item), item.unit) },
    { id: "purchase", header: "Bought as", accessorFn: (item) => purchaseLabel(item.consumable) || "—" },
    {
      id: "cost",
      header: "Unit cost",
      accessorFn: (item) => (item.consumable?.costHidden ? "Hidden" : centsLabel(item.consumable?.unitCostCents ?? null)),
      meta: { fieldGroup: "internal_cost" },
    },
    {
      id: "vendor",
      header: list === "bar" ? "Distributor" : "Vendor",
      accessorFn: (item) => item.consumable?.preferredVendor || "—",
    },
    {
      id: "estimate",
      header: "Est. cost",
      accessorFn: (item) => (item.consumable?.costHidden ? "Hidden" : centsLabel(estimatedCents(item))),
      meta: { fieldGroup: "internal_cost" },
    },
    ...(canOrder
      ? [{
          id: "add",
          header: "",
          enableSorting: false,
          cell: ({ row }: { row: { original: InventoryItem } }) => (
            <Button variant="outline" aria-label={`Add ${row.original.name} to order list`}
              onClick={(event) => { event.stopPropagation(); void add([row.original.id]); }}>
              <T id="inventory-order.reorder.add-to-order-list">Add to order list</T>
            </Button>
          ),
        } satisfies ColumnDef<InventoryItem, unknown>]
      : []),
  ];
  const data = items.data ?? [];
  return (
    <section className="panel" id={list === "kitchen" ? "kitchen" : `reorder-${list}`}>
      <div className="section-heading">
        <h2>{titles[list]}</h2>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      {added && (
        <p role="status">
          <T id="inventory-order.reorder.added">Added to the draft order list.</T>{" "}
          <Link to={`/inventory/orders/${added}`}><T id="inventory-order.reorder.open-list">Open list</T></Link>
        </p>
      )}
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : !data.length ? (
        <EmptyState
          title={<T id="inventory-order.reorder.nothing-needs-reordering">Nothing needs reordering</T>}
          description={<T id="inventory-order.reorder.everything-is-above-par">Everything on this list is above its par level.</T>}
        />
      ) : (
        <>
          <DataTable
            copyKey={`inventory-order.reorder-${list}`}
            selection={canOrder ? {
              rowId: (row) => row.id,
              actions: (ids, clear) => (
                <Button variant="outline" onClick={() => void add(ids, clear)}>
                  <T id="inventory-order.reorder.add-to-order-list">Add to order list</T>
                </Button>
              ),
            } : undefined}
            data={data}
            columns={columns}
            label={<T id="inventory-order.reorder.items-to-reorder">items to reorder</T>}
            exportName={`reorder-${list}`}
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={<T id="inventory-order.reorder.load-more">Load more items</T>} />
        </>
      )}
    </section>
  );
}

// The Inventory screen's Order tab (FLOW-292) at /inventory/order: Order lists and
// Approvals at the top, the order lists table, then what each list needs to
// reorder. /purchasing and /inventory/low-stock redirect here, and
// Kitchen › Ingredients' Order button opens #kitchen.
export function OrderTab() {
  const { hash } = useLocation();
  const { can } = usePermissions();
  useEffect(() => {
    if (!hash) return;
    const timer = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView(), 300);
    return () => window.clearTimeout(timer);
  }, [hash]);
  return (
    <>
      <InventoryHeading tab="order">
        {/* The app routes by the URL hash, so this scrolls instead of linking. */}
        <Button variant="outline" onClick={() => document.getElementById("order-lists")?.scrollIntoView()}>
          <T id="inventory-order.order-tab.order-lists">Order lists</T>
        </Button>
        <Allowed action="approvals.read">
          <Button variant="outline" asChild>
            <Link to="/approvals"><T id="inventory-order.order-tab.approvals">Approvals</T></Link>
          </Button>
        </Allowed>
      </InventoryHeading>
      <PageGrid pageKey="inventory.order">
        <Block id="order-lists" name="Order lists" h={24}>
          <OrderListsTable />
        </Block>
        {can("inventory.read") && (
          <Block id="reorder-master" name="Inventory to reorder" h={16}>
            <ReorderTable list="master" />
          </Block>
        )}
        {can("inventory.read") && (
          <Block id="reorder-bar" name="Bar Inventory to reorder" h={16}>
            <ReorderTable list="bar" />
          </Block>
        )}
        {/* Kitchen ingredients are the kitchen's list (FLOW-289). */}
        {can("recipes.read") && (
          <Block id="reorder-kitchen" name="Kitchen ingredients to reorder" h={16}>
            <ReorderTable list="kitchen" />
          </Block>
        )}
      </PageGrid>
    </>
  );
}
