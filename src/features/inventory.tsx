import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Plus,
  Package,
  Pencil,
  SlidersHorizontal,
  Truck,
  AlertTriangle,
  MoreHorizontal,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useDemo } from "../app/store";
import type { Item } from "../types";
import { purchaseOrders } from "../data/mock/fixtures";
import { stockStatus, money, date, today } from "../services/records";
import {
  PageHeader,
  Button,
  SearchInput,
  Select,
  FilterBar,
  DataTable,
  StatusBadge,
  Tabs,
  Section,
  Notes,
  FileList,
  DetailDrawer,
  FormField,
  ConfirmationDialog,
  EmptyState,
} from "../components/shared";
import { RecordForm } from "./forms";
export function InventoryList() {
  const store = useDemo();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [category, setCategory] = useState("");
  const [create, setCreate] = useState(false);
  const rows = store.inventory.records
    .filter(
      (i) =>
        (i.id + " " + i.name).toLowerCase().includes(search.toLowerCase()) &&
        (!category || i.category === category) &&
        (!status ||
          (status === "Alerts" && stockStatus(i) !== "In Stock") ||
          stockStatus(i) === status),
    );
  const quantity = (n: number, i: Item) => `${n} ${i.unit}`;
  const cols: ColumnDef<Item, unknown>[] = [
    {
      accessorKey: "id",
      header: "SKU",
      cell: (c) => <span className="sku">{c.getValue() as string}</span>,
    },
    { accessorKey: "name", header: "Item name" },
    { accessorKey: "category", header: "Category" },
    { accessorKey: "unit", header: "Unit" },
    {
      accessorKey: "onHand",
      header: "On hand",
      cell: (c) => quantity(c.getValue() as number, c.row.original),
    },
    {
      accessorKey: "reserved",
      header: "Reserved",
      cell: (c) => quantity(c.getValue() as number, c.row.original),
    },
    {
      id: "available",
      header: "Available",
      accessorFn: (i) => i.onHand - i.reserved,
      sortingFn: "basic",
      cell: (c) => (
        <strong>{quantity(c.getValue() as number, c.row.original)}</strong>
      ),
    },
    {
      accessorKey: "reorder",
      header: "Reorder point",
      cell: (c) => quantity(c.getValue() as number, c.row.original),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: stockStatus,
      cell: (c) => <StatusBadge status={c.getValue() as string} />,
    },
    { accessorKey: "supplier", header: "Supplier" },
  ];
  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Everything you need, right when you need it."
        eyebrow="STOCK & SUPPLIES"
      >
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          New Item
        </Button>
      </PageHeader>
      <div className="module-summary">
        <div>
          <strong>{store.inventory.records.length}</strong>
          <span>items tracked</span>
        </div>
        <div>
          <strong>
            {
              store.inventory.records
                .filter((i) => stockStatus(i) === "Low Stock").length
            }
          </strong>
          <span>running low</span>
        </div>
        <div>
          <strong>
            {
              store.inventory.records
                .filter((i) => stockStatus(i) === "Out of Stock").length
            }
          </strong>
          <span>out of stock</span>
        </div>
      </div>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search item name or SKU…"
        />
        <Select
          label="Categories"
          value={category}
          onChange={setCategory}
          options={[...new Set(store.inventory.records.map((i) => i.category))]}
        />
        <Select
          label="Stock statuses"
          value={status}
          onChange={setStatus}
          options={["In Stock", "Low Stock", "Out of Stock", "Alerts"]}
        />
        <span className="result-count">{rows.length} items</span>
      </FilterBar>
      <DataTable
        data={rows}
        columns={cols}
        onRow={(i) => navigate(`/inventory/${i.id}`)}
        label="items"
      />
      {create && <RecordForm kind="item" onClose={() => setCreate(false)} />}
    </>
  );
}
export function InventorySummaryCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="inventory-summary">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}
export function InventoryDetail() {
  const { id } = useParams();
  const store = useDemo();
  const item = store.inventory.find(id!);
  const [tab, setTab] = useState("Overview");
  const [edit, setEdit] = useState(false);
  const [operation, setOperation] = useState<"adjust" | "receive" | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [remove, setRemove] = useState(false);
  const [order, setOrder] = useState<string | null>(null);
  const navigate = useNavigate();
  if (!item)
    return (
      <EmptyState
        title="Item not found"
        description="This demo item may have been removed."
      />
    );
  const related = purchaseOrders.filter(
    (p) => p.itemId === item.id || p.supplier === item.supplier,
  );
  return (
    <>
      <Link to="/inventory" className="back-link">
        ← All inventory
      </Link>
      <div className="record-heading">
        <span className="item-placeholder">
          <Package size={32} />
        </span>
        <div>
          <h1>{item.name}</h1>
          <p>
            <span className="sku">{item.id}</span>
            <span className="badge neutral">{item.category}</span>
            <StatusBadge status={stockStatus(item)} />
          </p>
        </div>
        <div className="page-actions">
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          <Button onClick={() => setOperation("receive")}>
            <Truck size={16} />
            Simulate receipt
          </Button>
          <div className="menu-wrap">
            <Button
              variant="outline"
              size="icon"
              aria-label="More item actions"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={18} />
            </Button>
            {menu && (
              <div className="dropdown">
                <button
                  onClick={() => {
                    setRemove(true);
                    setMenu(false);
                  }}
                >
                  Remove demo item
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Tabs
        tabs={[
          "Overview",
          "Stock History",
          "Purchasing",
          "Usage",
          "Notes",
          "Files",
        ]}
        value={tab}
        onChange={setTab}
      />
      <div role="tabpanel" id="record-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "Overview" && (
          <>
            {stockStatus(item) !== "In Stock" && (
              <div className="stock-warning">
                <AlertTriangle size={19} />
                <div>
                  <strong>{stockStatus(item)} · Time to replenish</strong>
                  <p>
                    {item.onHand - item.reserved} {item.unit} available. Reorder
                    point is {item.reorder} {item.unit}.
                  </p>
                </div>
                <Button variant="outline" onClick={() => setTab("Purchasing")}>
                  View purchasing
                </Button>
              </div>
            )}
            <div className="stock-grid">
              <InventorySummaryCard
                label="On hand"
                value={item.onHand}
                unit={item.unit}
              />
              <InventorySummaryCard
                label="Reserved"
                value={item.reserved}
                unit={item.unit}
              />
              <InventorySummaryCard
                label="Available"
                value={item.onHand - item.reserved}
                unit={item.unit}
              />
              <InventorySummaryCard
                label="Reorder point"
                value={item.reorder}
                unit={item.unit}
              />
            </div>
            <div className="detail-grid">
              <Section title="Item information">
                <div className="info-grid">
                  {[
                    ["SKU", item.id],
                    ["Category", item.category],
                    ["Unit of measurement", item.unit],
                    ["Unit cost", `${money(item.cost)} / ${item.unit}`],
                    [
                      "Reorder quantity",
                      `${item.reorderQuantity} ${item.unit}`,
                    ],
                    ["Preferred supplier", item.supplier],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title="Stock management">
                <p>
                  Explore how stock changes affect availability in this session.
                </p>
                <p className="demo-callout">
                  Simulated operations only. No real inventory transaction is
                  saved.
                </p>
                <Button
                  variant="outline"
                  onClick={() => setOperation("adjust")}
                >
                  <SlidersHorizontal size={16} />
                  Simulate adjustment
                </Button>
              </Section>
            </div>
          </>
        )}
        {tab === "Stock History" && (
          <DataTable
            data={item.history}
            columns={[
              {
                accessorKey: "date",
                header: "Date",
                cell: (c) => date(c.getValue() as string),
              },
              { accessorKey: "type", header: "Movement type" },
              {
                accessorKey: "quantity",
                header: "Quantity change",
                cell: (c) => `${c.getValue()} ${item.unit}`,
              },
              { accessorKey: "reference", header: "Reference" },
              { accessorKey: "by", header: "Performed by" },
              {
                accessorKey: "balance",
                header: "Balance after",
                cell: (c) => `${c.getValue()} ${item.unit}`,
              },
            ]}
            label="movements"
          />
        )}
        {tab === "Purchasing" && (
          <div className="detail-grid">
            <Section title="Purchase orders">
              {related.length ? (
                related.map((p) => (
                  <button
                    className="order-row"
                    key={p.id}
                    onClick={() => setOrder(p.id)}
                  >
                    <div>
                      <strong>{p.id}</strong>
                      <small>
                        {p.supplier} · {money(p.value)}
                      </small>
                    </div>
                    <StatusBadge status={p.status} />
                  </button>
                ))
              ) : (
                <EmptyState
                  title="No purchase orders"
                  description="No orders are linked to this demo item."
                />
              )}
            </Section>
            <Section title="Supplier details">
              <div className="info-grid">
                <div>
                  <small>Preferred supplier</small>
                  <strong>{item.supplier}</strong>
                </div>
                <div>
                  <small>Last purchase price</small>
                  <strong>
                    {money(item.cost)} / {item.unit}
                  </strong>
                </div>
                <div>
                  <small>Last receipt date</small>
                  <strong>Oct 13, 2026</strong>
                </div>
              </div>
            </Section>
          </div>
        )}
        {tab === "Usage" && (
          <Section title="Reservations & usage">
            {item.reserved > 0 ? (
              <div className="order-row">
                <div>
                  <strong>Autumn leadership retreat</strong>
                  <small>Reserved for Oct 20, 2026</small>
                </div>
                <strong>
                  {item.reserved} {item.unit}
                </strong>
              </div>
            ) : (
              <EmptyState
                title="No active reservations"
                description="This item has no stock allocated to upcoming events."
              />
            )}
          </Section>
        )}
        {tab === "Notes" && (
          <Notes
            notes={item.notes}
            onAdd={async (text) => {
              await store.inventory.save({
                ...item,
                notes: [
                  { text, date: new Date().toLocaleString() },
                  ...item.notes,
                ],
              });
              store.notify("Inventory note added.");
            }}
          />
        )}
        {tab === "Files" && (
          <Section title="Item files">
            <FileList />
          </Section>
        )}
      </div>
      {edit && (
        <RecordForm kind="item" record={item} onClose={() => setEdit(false)} />
      )}
      <DetailDrawer
        open={!!operation}
        onClose={() => {
          setOperation(null);
          setError("");
        }}
        title={
          operation === "receive"
            ? "Simulate receiving stock"
            : "Simulate stock adjustment"
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const qty = Number(data.get("quantity"));
            const reference = String(data.get("reference") ?? "").trim();
            if (
              !Number.isFinite(qty) ||
              !Number.isInteger(qty) ||
              qty === 0 ||
              (operation === "receive" && qty < 0)
            ) {
              setError(
                "Enter a nonzero whole quantity. Receipts must be positive.",
              );
              return;
            }
            if (item.onHand + qty < item.reserved) {
              setError("The resulting stock cannot be below reserved stock.");
              return;
            }
            if (!reference) {
              setError("Enter a reason or purchase order reference.");
              return;
            }
            try {
            await store.inventory.save({
              ...item,
              onHand: item.onHand + qty,
              history: [
                {
                  date: today(),
                  type:
                    operation === "receive"
                      ? "Simulated receipt"
                      : "Simulated adjustment",
                  quantity: qty,
                  reference,
                  by: "Alex Chen",
                  balance: item.onHand + qty,
                },
                ...item.history,
              ],
            });
            store.notify("Simulated stock change applied in memory only.");
            setOperation(null);
            setError("");
            } catch (e) { setError((e as Error).message); }
          }}
        >
          <p className="demo-callout">
            This is a simulation. No production inventory transaction will be
            saved.
          </p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <FormField
            label={`Quantity change (${item.unit})`}
            hint={
              operation === "adjust"
                ? "Use a negative number to reduce stock."
                : "Enter the quantity received."
            }
          >
            <input name="quantity" type="number" step="1" required />
          </FormField>
          <FormField label="Reason / reference *">
            <input name="reference" required />
          </FormField>
          <div className="form-actions">
            <Button
              variant="outline"
              type="button"
              onClick={() => setOperation(null)}
            >
              Cancel
            </Button>
            <Button>Apply simulation</Button>
          </div>
        </form>
      </DetailDrawer>
      <ConfirmationDialog
        open={remove}
        onClose={() => setRemove(false)}
        title="Remove this demo item?"
        onConfirm={async () => {
          await store.inventory.remove(item.id);
          store.notify("Item removed from demo memory.");
          navigate("/inventory");
        }}
      >
        This removes {item.name} from the current session. Refreshing restores
        the sample data.
      </ConfirmationDialog>
      <DetailDrawer
        open={!!order}
        onClose={() => setOrder(null)}
        title={`Purchase order ${order ?? ""}`}
      >
        <p className="demo-callout">Read-only fictional purchase order.</p>
        <p>Supplier: {purchaseOrders.find((p) => p.id === order)?.supplier}</p>
        <p>
          Total: {money(purchaseOrders.find((p) => p.id === order)?.value ?? 0)}
        </p>
        <p>Order date: Oct 12, 2026</p>
        <StatusBadge
          status={
            purchaseOrders.find((p) => p.id === order)?.status ?? "Ordered"
          }
        />
      </DetailDrawer>
    </>
  );
}
