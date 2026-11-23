import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { orderListStatuses, type OrderList, type OrderListStatus } from "../../shared/order-lists";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { Block, PageGrid } from "../app/page-grid";
import { LabelT, T } from "../app/copy";
import { Allowed } from "../app/permissions";
import { useResource } from "../app/useResource";
import { LoadError } from "../components/record-display";
import { Button, DataTable, DetailDrawer, FilterBar, FormField, LoadingSkeleton } from "../components/shared";
import { Dropdown } from "../components/ui/Dropdown";
import { orderListsApi } from "../services/order-lists";
import { weekday } from "./calendar-entries";
import { InventoryHeading } from "./inventory-screen";

// The Inventory screen's Purchasing tab (FLOW-266) at /purchasing: every order
// list with its status, dates, events, lines and vendors, and how a list moves
// through its statuses. A list opens at /inventory/orders/<id>, where its lines
// are edited, submitted, approved and received.
const statusLabels: Record<OrderListStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};
const statusTone: Record<OrderListStatus, string> = {
  draft: "neutral",
  submitted: "purchasing-submitted",
  approved: "success",
  rejected: "error",
  ordered: "warning",
  partially_received: "info",
  received: "purchasing-received",
  cancelled: "purchasing-cancelled",
};
// The usual path, as the strip above the table shows it.
const flow: OrderListStatus[] = ["draft", "submitted", "approved", "ordered", "partially_received", "received"];

export function OrderListStatusPill({ status }: { status: OrderListStatus }) {
  return (
    <span className={`badge ${statusTone[status]}`}>
      <LabelT id="labels.order-list-status" value={status}>{statusLabels[status]}</LabelT>
    </span>
  );
}

const shortDate = (date: string) => weekday(date).split(", ")[1] ?? date;
export const listDates = (list: Pick<OrderList, "from" | "to">) =>
  list.from === list.to ? shortDate(list.from) : `${shortDate(list.from)} – ${shortDate(list.to)}`;
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

export function PurchasingPage() {
  const navigate = useNavigate();
  const lists = useResource(["order-lists"], orderListsApi.list);
  const [status, setStatus] = useState<OrderListStatus | "">("");
  const [creating, setCreating] = useState(false);
  const rows = (lists.data ?? []).filter((list) => !status || list.status === status);
  const columns: ColumnDef<OrderList, unknown>[] = [
    {
      id: "status",
      header: "Status",
      accessorFn: (list) => statusLabels[list.status],
      cell: ({ row }) => <OrderListStatusPill status={row.original.status} />,
    },
    { id: "dates", header: "Dates", accessorFn: (list) => list.from, cell: ({ row }) => listDates(row.original) },
    { id: "events", header: "Events", accessorFn: (list) => unique(list.lines.flatMap((line) => line.eventTitles)).join(", ") || "—" },
    { id: "lines", header: "Lines", accessorFn: (list) => list.lines.length },
    { id: "vendors", header: "Vendors", accessorFn: (list) => unique(list.lines.map((line) => line.vendorName)).length },
    {
      id: "updated",
      header: "Updated",
      accessorFn: (list) => list.updatedAt,
      cell: ({ row }) => weekday(utcToBusinessTime(new Date(row.original.updatedAt)).date),
    },
  ];
  return (
    <>
      <InventoryHeading tab="purchasing">
        <Button variant="outline" asChild>
          <Link to="/kitchen/orders"><T id="purchasing.page.vendor-orders">Vendor orders</T></Link>
        </Button>
        <Allowed action="order_lists.write">
          <Button onClick={() => setCreating(true)}><T id="purchasing.page.new-order-list">+ New order list</T></Button>
        </Allowed>
      </InventoryHeading>
      <PageGrid pageKey="inventory.purchasing">
        <Block id="filters" name="Filters" h={4}>
          <p className="inventory-flow">
            <T id="purchasing.page.how-an-order-list-moves">How an order list moves:</T>
            {flow.map((value, index) => (
              <span key={value}>
                {index > 0 && "→ "}
                <OrderListStatusPill status={value} />
              </span>
            ))}
          </p>
          <FilterBar>
            <Dropdown
              variant="filter"
              aria-label="Status"
              value={status}
              options={[
                { value: "", label: <T id="purchasing.page.all-statuses">All statuses</T>, text: "All statuses" },
                ...orderListStatuses.map((value) => ({
                  value,
                  label: <LabelT id="labels.order-list-status" value={value}>{statusLabels[value]}</LabelT>,
                  text: statusLabels[value],
                })),
              ]}
              onValueChange={(next) => setStatus(next as OrderListStatus | "")}
            />
          </FilterBar>
        </Block>
        <Block id="lists" name="Order lists" h={20}>
          {lists.error ? (
            <LoadError message={lists.error} />
          ) : !lists.data ? (
            <LoadingSkeleton />
          ) : (
            <DataTable
              copyKey="purchasing.table"
              openColumn
              data={rows}
              columns={columns}
              onRow={(list) => navigate(`/inventory/orders/${list.id}`)}
              label={<T id="purchasing.table.order-lists">order lists</T>}
              exportName="order-lists"
            />
          )}
          <p className="table-hint">
            <T id="purchasing.page.status-moves-through">{"Status moves through Submit, Approve and Receive on the list itself; lines are edited inside the list."}</T>
          </p>
        </Block>
      </PageGrid>
      {creating && <NewOrderList onClose={() => setCreating(false)} onCreated={(list) => navigate(`/inventory/orders/${list.id}`)} />}
    </>
  );
}

// "+ New order list": a date range; the list is built from the events and low
// stock in it (FLOW-86) and opens for editing.
function NewOrderList({ onClose, onCreated }: { onClose: () => void; onCreated: (list: OrderList) => void }) {
  const today = utcToBusinessTime(new Date()).date;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addLocalDays(today, 30));
  const [error, setError] = useState("");
  const create = async () => {
    setError("");
    try { onCreated(await orderListsApi.create(from, to)); }
    catch (cause) { setError((cause as Error).message); }
  };
  return (
    <DetailDrawer open onClose={onClose} title={<T id="purchasing.new-order-list.new-order-list">New order list</T>}
      description={<T id="purchasing.new-order-list.built-from-the-events">Built from the events and low stock in these dates.</T>}>
      <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <FormField label={<T id="purchasing.new-order-list.from">From</T>}>
          <input aria-label="From" type="date" required value={from} onChange={(event) => setFrom(event.target.value)} />
        </FormField>
        <FormField label={<T id="purchasing.new-order-list.to">To</T>}>
          <input aria-label="To" type="date" required value={to} onChange={(event) => setTo(event.target.value)} />
        </FormField>
        {error && <p role="alert" className="error-message">{error}</p>}
        <Button type="submit"><T id="purchasing.new-order-list.build-list">Build list</T></Button>
      </form>
    </DetailDrawer>
  );
}
