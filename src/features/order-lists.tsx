import { useState } from "react";
import { Block, PageGrid } from "../app/page-grid";
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
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy } from "../app/copy";

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
    <PageHeader pageKey="inventory.order-lists" title={<T id="order-lists.order-lists.order-lists">Order lists</T>} subtitle={<T id="order-lists.order-lists.build-a-shopping-list-from">Build a shopping list from event shortages and low stock.</T>} eyebrow={<T id="order-lists.order-lists.stock-supplies">{"STOCK & SUPPLIES"}</T>} />
    {error && <p role="alert" className="error-message">{error}</p>}
    <PageGrid pageKey="inventory.order-lists">
    <Block id="builder" name="Build a list" h={3}>
    <div className="order-list-builder">
      <label><T id="order-lists.order-lists.from">{"From "}</T><input aria-label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><T id="order-lists.order-lists.to">{"To "}</T><input aria-label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <Button onClick={() => void create()}><T id="order-lists.order-lists.build-list">Build list</T></Button>
    </div>
    </Block>
    <Block id="lists" name="Order lists" h={16}>
    {lists.error ? <LoadError message={lists.error} /> : lists.loading && !lists.data ? <LoadingSkeleton /> :
      <ul>{lists.data?.map((list) => <li key={list.id}><Link to={`/inventory/orders/${list.id}`}>
        <T id="order-lists.order-lists.lines" values={{ from: list.from, to: list.to, statusLabel: statusLabel(list.status), count: list.lines.length }}>{"{from} – {to} · {statusLabel} · {count} lines"}</T>
      </Link></li>)}</ul>}
    </Block>
    </PageGrid>
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
    <Link to="/inventory/orders" className="back-link"><T id="order-lists.order-list-detail.order-lists">← Order lists</T></Link>
    <PageHeader pageKey="inventory.order-detail" title={<T id="order-lists.order-list-detail.order-list" values={{ from: data.from, to: data.to }}>{"Order list {from} – {to}"}</T>} subtitle={<T id="order-lists.order-list-detail.lines" values={{ statusLabel: statusLabel(data.status), linesCount: lines.length }}>{"{statusLabel} · {linesCount} lines"}</T>} eyebrow={<T id="order-lists.order-list-detail.stock-supplies">{"STOCK & SUPPLIES"}</T>}>
      <Button variant="outline" onClick={() => window.print()}><T id="order-lists.order-list-detail.print-list">Print list</T></Button>
      {editing && <Button variant="outline" onClick={() => void save()}><T id="order-lists.order-list-detail.save-edits">Save edits</T></Button>}
      {editing && data.status !== "approved" && <Button onClick={() => void submit()}><T id="order-lists.order-list-detail.submit-for-approval">Submit for approval</T></Button>}
      {cancellable && <Button variant="outline" onClick={() => void cancelList()}><T id="order-lists.order-list-detail.cancel-list">Cancel list</T></Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data.status === "submitted" && <p role="status"><T id="order-lists.order-list-detail.edits-are-locked-until-admin">Edits are locked until Admin approves or rejects this list.</T></p>}
    {data.status === "approved" && !data.orders.length && <p role="status"><T id="order-lists.order-list-detail.approved-place-each-vendor-s">{"Approved. Place each vendor's order on its portal, then record it below."}</T></p>}
    <PageGrid pageKey="inventory.order-detail">
    <Block id="vendors" name="Vendor orders" h={24}>
    {groups.map((vendor) => <section key={vendor} className="order-vendor">
      <h2>{vendor}</h2>
      <p>{lines.find((line) => line.vendorName === vendor)?.orderingInstructions || <T id="order-lists.order-list-detail.no-ordering-instructions-provided">No ordering instructions provided.</T>}</p>
      <div className="table-scroll"><table><thead><tr><th><T id="order-lists.order-list-detail.item">Item</T></th><th><T id="order-lists.order-list-detail.purchase-qty">Purchase qty</T></th><th><T id="order-lists.order-list-detail.order-by">Order by</T></th><th><T id="order-lists.order-list-detail.events">Events</T></th><th><T id="order-lists.order-list-detail.note">Note</T></th><th className="order-screen-only"> </th></tr></thead>
        <tbody>{lines.map((line, index) => line.vendorName !== vendor ? null : <tr key={line.itemId}>
          <td>{line.itemName}</td><td>{editing ? <input aria-label={`Quantity for ${line.itemName}`} type="number" min="0" step="1" value={line.quantity}
            onChange={(event) => update(index, { quantity: Number(event.target.value) })} /> : line.quantity} {line.purchaseUnit}</td>
          <td>{line.orderBy ?? "—"}</td><td>{line.eventTitles.join(", ") || <T id="order-lists.order-list-detail.par-level">Par level</T>}</td>
          <td>{editing ? <input aria-label={`Note for ${line.itemName}`} value={line.note}
            onChange={(event) => update(index, { note: event.target.value })}
            onBlur={() => { if (draft && line.note !== data.lines[index]?.note) void save(); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") update(index, { note: data.lines[index]?.note ?? "" });
            }} /> : line.note}</td>
          <td className="order-screen-only">{editing && <Button variant="outline" onClick={() => setDraft(lines.filter((_, at) => at !== index))}><T id="order-lists.order-list-detail.remove">Remove</T></Button>}</td>
        </tr>)}</tbody></table></div>
      {placed && !draft && <VendorOrderPanel list={data} vendor={vendor} showCosts={showCosts}
        canRecord={can("order_lists.approve")} canReceive={can("order_lists.write")}
        onChange={(next, note) => { list.replace(next); setMessage(note); setError(""); }}
        onError={(note) => { setError(note); setMessage(""); }} />}
    </section>)}
    </Block>
    </PageGrid>
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
      <T id="order-lists.vendor-order-panel.order-was-cancelled" values={{ portalOrderNumber: order.portalOrderNumber }}>{"Order {portalOrderNumber} was cancelled."}</T></p>)}
    {active ? <>
      <h3><T id="order-lists.vendor-order-panel.order" values={{ portalOrderNumber: active.portalOrderNumber, statusLabel: statusLabel(active.status) }}>{"Order {portalOrderNumber} · {statusLabel}"}</T></h3>
      <p><T id="order-lists.vendor-order-panel.ordered-expected" values={{ orderedOn: active.orderedOn, expectedDelivery: active.expectedDelivery }}>{"Ordered {orderedOn} · expected {expectedDelivery}"}</T>{showCosts && <T id="order-lists.vendor-order-panel.total" values={{ dollars: dollars(active.totalCents) }}>{" · total {dollars}"}</T>}</p>
      {active.notes && <p>{active.notes}</p>}
      <div className="table-scroll"><table><thead><tr><th><T id="order-lists.vendor-order-panel.item">Item</T></th><th><T id="order-lists.vendor-order-panel.ordered">Ordered</T></th><th><T id="order-lists.vendor-order-panel.received">Received</T></th><th><T id="order-lists.vendor-order-panel.note">Note</T></th></tr></thead>
        <tbody>{active.lines.map((line) => <tr key={line.itemId}>
          <td>{line.itemName}</td>
          <td>{line.ordered} {line.purchaseUnit}{line.ordered !== line.approvedQuantity && <T id="order-lists.vendor-order-panel.approved" values={{ approvedQuantity: line.approvedQuantity }}>{" (approved {approvedQuantity})"}</T>}</td>
          <td>{line.received} {line.purchaseUnit}</td><td className="vendor-order-note">{line.note || "—"}</td>
        </tr>)}</tbody></table></div>
      {canRecord && active.status === "ordered" && <Button variant="outline"
        onClick={() => void run(() => orderListsApi.cancelOrder(list.id, active.id), "Order cancelled.")}><T id="order-lists.vendor-order-panel.cancel-order">Cancel order</T></Button>}
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
    <h3><T id="order-lists.record-order-form.record-the-portal-order">Record the portal order</T></h3>
    {problem && <p role="alert" className="error-message">{problem}</p>}
    <label><T id="order-lists.record-order-form.portal-order-number">{"Portal order number "}</T><input aria-label={`Portal order number for ${vendor}`} value={portal}
      onChange={(event) => setPortal(event.target.value)} /></label>
    <label><T id="order-lists.record-order-form.order-date">{"Order date "}</T><input type="date" aria-label={`Order date for ${vendor}`} value={orderedOn}
      onChange={(event) => setOrderedOn(event.target.value)} /></label>
    <label><T id="order-lists.record-order-form.expected-delivery">{"Expected delivery "}</T><input type="date" aria-label={`Expected delivery for ${vendor}`} value={expected}
      onChange={(event) => setExpected(event.target.value)} /></label>
    {showCosts && <label><T id="order-lists.record-order-form.order-total">{"Order total ($) "}</T><input type="number" min="0" step="0.01" inputMode="decimal"
      aria-label={`Order total for ${vendor}`} value={total} onChange={(event) => setTotal(event.target.value)} /></label>}
    {lines.map((line) => <label key={line.itemId}>{line.itemName} ({line.purchaseUnit})
      <input type="number" min="0" step="1" inputMode="decimal" aria-label={`Ordered quantity for ${line.itemName}`}
        value={quantities[line.itemId]} onChange={(event) => setQuantities({ ...quantities, [line.itemId]: event.target.value })} /></label>)}
    <label><T id="order-lists.record-order-form.changes-or-notes">{"Changes or notes "}</T><input aria-label={`Order notes for ${vendor}`} value={notes}
      onChange={(event) => setNotes(event.target.value)} /></label>
    <Button type="submit"><T id="order-lists.record-order-form.mark-as-ordered">Mark as ordered</T></Button>
  </form>;
}

function ReceiveForm({ order, showCosts, onSubmit }: {
  order: VendorOrder; showCosts: boolean;
  onSubmit: (input: Parameters<typeof orderListsApi.receive>[2]) => Promise<void>;
}) {
  const eG1CaseShortPlaceholder = useCopy("order-lists.receive-form.e-g-1-case-short.placeholder", "e.g. 1 case short, 2 bottles broken");
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
    <h3><T id="order-lists.receive-form.receive-a-delivery">Receive a delivery</T></h3>
    {open.map((line) => <fieldset key={line.itemId}>
      <legend><T id="order-lists.receive-form.to-come" values={{ itemName: line.itemName, outstanding: outstanding(line), purchaseUnit: line.purchaseUnit }}>{"{itemName} · {outstanding} {purchaseUnit} to come"}</T></legend>
      <label><T id="order-lists.receive-form.received" values={{ purchaseUnit: line.purchaseUnit }}>{"Received ({purchaseUnit}) "}</T><input type="number" min="0" step="any" inputMode="decimal"
        aria-label={`Received quantity for ${line.itemName}`} value={received[line.itemId] ?? ""}
        onChange={(event) => setReceived({ ...received, [line.itemId]: event.target.value })} /></label>
      {showCosts && <label><T id="order-lists.receive-form.actual-cost-per" values={{ purchaseUnit: line.purchaseUnit }}>{"Actual cost per {purchaseUnit} ($) "}</T><input type="number" min="0" step="0.01" inputMode="decimal"
        aria-label={`Actual unit cost for ${line.itemName}`} value={costs[line.itemId] ?? ""}
        onChange={(event) => setCosts({ ...costs, [line.itemId]: event.target.value })} /></label>}
      <label><T id="order-lists.receive-form.short-or-damaged">{"Short or damaged "}</T><input aria-label={`Delivery note for ${line.itemName}`} value={notes[line.itemId] ?? ""}
        placeholder={eG1CaseShortPlaceholder} data-copy-id="order-lists.receive-form.e-g-1-case-short.placeholder"
        onChange={(event) => setNotes({ ...notes, [line.itemId]: event.target.value })} /></label>
    </fieldset>)}
    <label className="vendor-order-complete"><RoundCheck checked={complete}
      onChange={(event) => setComplete(event.target.checked)} /><T id="order-lists.receive-form.nothing-more-is-coming-on">{" Nothing more is coming on this order"}</T></label>
    <Button type="submit"><T id="order-lists.receive-form.record-delivery">Record delivery</T></Button>
  </form>;
}
