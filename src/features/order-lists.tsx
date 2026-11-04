import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { Button, LoadingSkeleton, PageHeader } from "../components/shared";
import { LoadError } from "../components/record-display";
import { orderListsApi } from "../services/order-lists";
import { isPlaced, outstanding, type OrderLine, type OrderList, type VendorOrder } from "../../shared/order-lists";
import { canSeeField } from "../../shared/visibility";
import { utcToBusinessTime, addLocalDays } from "../../shared/time";
import "./order-lists.css";

export function OrderLists() {
  const navigate = useNavigate();
  const lists = useResource(["order-lists"], orderListsApi.list);
  const today = utcToBusinessTime(new Date()).date;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addLocalDays(today, 30));
  const [error, setError] = useState("");
  const create = async () => {
    setError("");
    try { const list = await orderListsApi.create(from, to); navigate(`/inventory/orders/${list.id}`); }
    catch (cause) { setError((cause as Error).message); }
  };
  return <>
    <PageHeader title="Order lists" subtitle="Build a shopping list from event shortages and low stock." eyebrow="STOCK & SUPPLIES" />
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="order-list-builder">
      <label>From <input aria-label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To <input aria-label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <Button onClick={() => void create()}>Build list</Button>
    </div>
    {lists.error ? <LoadError message={lists.error} /> : lists.loading && !lists.data ? <LoadingSkeleton /> :
      <ul>{lists.data?.map((list) => <li key={list.id}><Link to={`/inventory/orders/${list.id}`}>
        {list.from} – {list.to} · {statusLabel(list.status)} · {list.lines.length} lines
      </Link></li>)}</ul>}
  </>;
}

const statusLabel = (status: string) => status.replaceAll("_", " ");
const dollars = (cents: number | null) => cents === null ? "—" : `$${(cents / 100).toFixed(2)}`;
const toCents = (value: string) => value.trim() === "" ? null : Math.round(Number(value) * 100);

export function OrderListDetail() {
  const { id = "" } = useParams();
  const { actor, can } = usePermissions();
  const list = useResource(["order-list", id], () => orderListsApi.get(id));
  const [draft, setDraft] = useState<OrderLine[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const data = list.data;
  if (list.error) return <LoadError message={list.error} />;
  if (!data) return <LoadingSkeleton />;
  const lines = draft ?? data.lines;
  const placed = isPlaced(data.status);
  const editing = (!placed || data.status === "approved") && data.status !== "submitted" && can("order_lists.write");
  const showCosts = actor !== null && canSeeField(actor, "internal_cost");
  const cancellable = can("order_lists.approve") && ["approved", "ordered"].includes(data.status);
  const cancelList = async () => {
    setError(""); setMessage("");
    try { list.replace(await orderListsApi.cancel(id)); setMessage("List cancelled."); }
    catch (cause) { setError((cause as Error).message); }
  };
  const groups = [...new Set(lines.map((line) => line.vendorName))].sort();
  const update = (index: number, values: Partial<OrderLine>) => setDraft(lines.map((line, at) => at === index ? { ...line, ...values } : line));
  const save = async () => {
    setError(""); setMessage("");
    try { list.replace(await orderListsApi.update(id, lines)); setDraft(null); setMessage("List saved."); }
    catch (cause) { setError((cause as Error).message); }
  };
  const submit = async () => {
    setError(""); setMessage("");
    try {
      if (draft) await orderListsApi.update(id, lines);
      list.replace(await orderListsApi.submit(id)); setDraft(null);
      setMessage("Submitted for Admin approval.");
    } catch (cause) { setError((cause as Error).message); }
  };
  return <div className="order-list-page">
    <Link to="/inventory/orders" className="back-link">← Order lists</Link>
    <PageHeader title={`Order list ${data.from} – ${data.to}`} subtitle={`${statusLabel(data.status)} · ${lines.length} lines`} eyebrow="STOCK & SUPPLIES">
      <Button variant="outline" onClick={() => window.print()}>Print list</Button>
      {editing && <Button variant="outline" onClick={() => void save()}>Save edits</Button>}
      {editing && data.status !== "approved" && <Button onClick={() => void submit()}>Submit for approval</Button>}
      {cancellable && <Button variant="outline" onClick={() => void cancelList()}>Cancel list</Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data.status === "submitted" && <p role="status">Edits are locked until Admin approves or rejects this list.</p>}
    {data.status === "approved" && !data.orders.length && <p role="status">Approved. Place each vendor's order on its portal, then record it below.</p>}
    {groups.map((vendor) => <section key={vendor} className="order-vendor">
      <h2>{vendor}</h2>
      <p>{lines.find((line) => line.vendorName === vendor)?.orderingInstructions || "No ordering instructions provided."}</p>
      <div className="table-scroll"><table><thead><tr><th>Item</th><th>Purchase qty</th><th>Order by</th><th>Events</th><th>Note</th><th className="order-screen-only"> </th></tr></thead>
        <tbody>{lines.map((line, index) => line.vendorName !== vendor ? null : <tr key={line.itemId}>
          <td>{line.itemName}</td><td>{editing ? <input aria-label={`Quantity for ${line.itemName}`} type="number" min="0" step="1" value={line.quantity}
            onChange={(event) => update(index, { quantity: Number(event.target.value) })} /> : line.quantity} {line.purchaseUnit}</td>
          <td>{line.orderBy ?? "—"}</td><td>{line.eventTitles.join(", ") || "Par level"}</td>
          <td>{editing ? <input aria-label={`Note for ${line.itemName}`} value={line.note}
            onChange={(event) => update(index, { note: event.target.value })} /> : line.note}</td>
          <td className="order-screen-only">{editing && <Button variant="outline" onClick={() => setDraft(lines.filter((_, at) => at !== index))}>Remove</Button>}</td>
        </tr>)}</tbody></table></div>
      {placed && !draft && <VendorOrderPanel list={data} vendor={vendor} showCosts={showCosts}
        canRecord={can("order_lists.approve")} canReceive={can("order_lists.write")}
        onChange={(next, note) => { list.replace(next); setMessage(note); setError(""); }}
        onError={(note) => { setError(note); setMessage(""); }} />}
    </section>)}
  </div>;
}

// One vendor's portal order (FLOW-87) and its deliveries (FLOW-88).
function VendorOrderPanel({ list, vendor, showCosts, canRecord, canReceive, onChange, onError }: {
  list: OrderList; vendor: string; showCosts: boolean; canRecord: boolean; canReceive: boolean;
  onChange: (list: OrderList, message: string) => void; onError: (message: string) => void;
}) {
  const orders = list.orders.filter((order) => order.vendorName === vendor);
  const active = orders.find((order) => order.status !== "cancelled");
  const cancelled = orders.filter((order) => order.status === "cancelled");
  const approved = list.lines.filter((line) => line.vendorName === vendor && line.quantity > 0);
  const run = async (action: () => Promise<OrderList>, message: string) => {
    try { onChange(await action(), message); } catch (cause) { onError((cause as Error).message); }
  };
  return <div className="vendor-order order-screen-only">
    {cancelled.map((order) => <p key={order.id} className="vendor-order-cancelled">
      Order {order.portalOrderNumber} was cancelled.</p>)}
    {active ? <>
      <h3>Order {active.portalOrderNumber} · {statusLabel(active.status)}</h3>
      <p>Ordered {active.orderedOn} · expected {active.expectedDelivery}{showCosts && ` · total ${dollars(active.totalCents)}`}</p>
      {active.notes && <p>{active.notes}</p>}
      <div className="table-scroll"><table><thead><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Note</th></tr></thead>
        <tbody>{active.lines.map((line) => <tr key={line.itemId}>
          <td>{line.itemName}</td>
          <td>{line.ordered} {line.purchaseUnit}{line.ordered !== line.approvedQuantity && ` (approved ${line.approvedQuantity})`}</td>
          <td>{line.received} {line.purchaseUnit}</td><td className="vendor-order-note">{line.note || "—"}</td>
        </tr>)}</tbody></table></div>
      {canRecord && active.status === "ordered" && <Button variant="outline"
        onClick={() => void run(() => orderListsApi.cancelOrder(list.id, active.id), "Order cancelled.")}>Cancel order</Button>}
      {canReceive && (active.status === "ordered" || active.status === "partially_received") &&
        <ReceiveForm key={`${active.id}-${active.receipts.length}`} order={active} showCosts={showCosts}
          onSubmit={(input) => run(() => orderListsApi.receive(list.id, active.id, input), "Delivery recorded.")} />}
    </> : canRecord && ["approved", "ordered", "partially_received"].includes(list.status) && approved.length > 0 &&
      <RecordOrderForm vendor={vendor} lines={approved} showCosts={showCosts}
        onSubmit={(input) => run(() => orderListsApi.recordOrder(list.id, input), `${vendor} order recorded.`)} />}
  </div>;
}

function RecordOrderForm({ vendor, lines, showCosts, onSubmit }: {
  vendor: string; lines: OrderLine[]; showCosts: boolean;
  onSubmit: (input: Parameters<typeof orderListsApi.recordOrder>[1]) => Promise<void>;
}) {
  const today = utcToBusinessTime(new Date()).date;
  const [portal, setPortal] = useState("");
  const [orderedOn, setOrderedOn] = useState(today);
  const [expected, setExpected] = useState("");
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((line) => [line.itemId, String(line.quantity)])));
  const [problem, setProblem] = useState("");
  const save = async () => {
    if (!portal.trim() || !expected) return setProblem("Enter the portal order number and expected delivery date.");
    setProblem("");
    await onSubmit({ vendorName: vendor, portalOrderNumber: portal.trim(), orderedOn, expectedDelivery: expected,
      totalCents: showCosts ? toCents(total) : null, notes,
      lines: lines.map((line) => ({ itemId: line.itemId, ordered: Number(quantities[line.itemId] || 0) })) });
  };
  return <form className="vendor-order-form" aria-label={`Record ${vendor} order`}
    onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <h3>Record the portal order</h3>
    {problem && <p role="alert" className="error-message">{problem}</p>}
    <label>Portal order number <input aria-label={`Portal order number for ${vendor}`} value={portal}
      onChange={(event) => setPortal(event.target.value)} /></label>
    <label>Order date <input type="date" aria-label={`Order date for ${vendor}`} value={orderedOn}
      onChange={(event) => setOrderedOn(event.target.value)} /></label>
    <label>Expected delivery <input type="date" aria-label={`Expected delivery for ${vendor}`} value={expected}
      onChange={(event) => setExpected(event.target.value)} /></label>
    {showCosts && <label>Order total ($) <input type="number" min="0" step="0.01" inputMode="decimal"
      aria-label={`Order total for ${vendor}`} value={total} onChange={(event) => setTotal(event.target.value)} /></label>}
    {lines.map((line) => <label key={line.itemId}>{line.itemName} ({line.purchaseUnit})
      <input type="number" min="0" step="1" inputMode="decimal" aria-label={`Ordered quantity for ${line.itemName}`}
        value={quantities[line.itemId]} onChange={(event) => setQuantities({ ...quantities, [line.itemId]: event.target.value })} /></label>)}
    <label>Changes or notes <input aria-label={`Order notes for ${vendor}`} value={notes}
      onChange={(event) => setNotes(event.target.value)} /></label>
    <Button type="submit">Mark as ordered</Button>
  </form>;
}

function ReceiveForm({ order, showCosts, onSubmit }: {
  order: VendorOrder; showCosts: boolean;
  onSubmit: (input: Parameters<typeof orderListsApi.receive>[2]) => Promise<void>;
}) {
  const open = order.lines.filter((line) => outstanding(line) > 0);
  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(open.map((line) => [line.itemId, String(outstanding(line))])));
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [complete, setComplete] = useState(false);
  const save = async () => {
    await onSubmit({ complete, lines: open.map((line) => ({ itemId: line.itemId,
      quantity: Number(received[line.itemId] || 0),
      unitCostCents: showCosts ? toCents(costs[line.itemId] ?? "") : null,
      note: notes[line.itemId] ?? "" })) });
    setCosts({}); setNotes({}); setComplete(false);
  };
  return <form className="vendor-order-form" aria-label={`Receive order ${order.portalOrderNumber}`}
    onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <h3>Receive a delivery</h3>
    {open.map((line) => <fieldset key={line.itemId}>
      <legend>{line.itemName} · {outstanding(line)} {line.purchaseUnit} to come</legend>
      <label>Received ({line.purchaseUnit}) <input type="number" min="0" step="any" inputMode="decimal"
        aria-label={`Received quantity for ${line.itemName}`} value={received[line.itemId] ?? ""}
        onChange={(event) => setReceived({ ...received, [line.itemId]: event.target.value })} /></label>
      {showCosts && <label>Actual cost per {line.purchaseUnit} ($) <input type="number" min="0" step="0.01" inputMode="decimal"
        aria-label={`Actual unit cost for ${line.itemName}`} value={costs[line.itemId] ?? ""}
        onChange={(event) => setCosts({ ...costs, [line.itemId]: event.target.value })} /></label>}
      <label>Short or damaged <input aria-label={`Delivery note for ${line.itemName}`} value={notes[line.itemId] ?? ""}
        placeholder="e.g. 1 case short, 2 bottles broken"
        onChange={(event) => setNotes({ ...notes, [line.itemId]: event.target.value })} /></label>
    </fieldset>)}
    <label className="vendor-order-complete"><input type="checkbox" checked={complete}
      onChange={(event) => setComplete(event.target.checked)} /> Nothing more is coming on this order</label>
    <Button type="submit">Record delivery</Button>
  </form>;
}
