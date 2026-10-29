import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { Button, LoadingSkeleton, PageHeader } from "../components/shared";
import { LoadError } from "../components/record-display";
import { orderListsApi } from "../services/order-lists";
import type { OrderLine } from "../../shared/order-lists";
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
        {list.from} – {list.to} · {list.status} · {list.lines.length} lines
      </Link></li>)}</ul>}
  </>;
}

export function OrderListDetail() {
  const { id = "" } = useParams();
  const { actor } = usePermissions();
  const list = useResource(["order-list", id], () => orderListsApi.get(id));
  const [draft, setDraft] = useState<OrderLine[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const data = list.data;
  if (list.error) return <LoadError message={list.error} />;
  if (!data) return <LoadingSkeleton />;
  const lines = draft ?? data.lines;
  const editing = data.status !== "submitted" && !!actor && ["admin", "kitchen_lead"].includes(actor.role);
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
    <PageHeader title={`Order list ${data.from} – ${data.to}`} subtitle={`${data.status} · ${lines.length} lines`} eyebrow="STOCK & SUPPLIES">
      <Button variant="outline" onClick={() => window.print()}>Print list</Button>
      {editing && <Button variant="outline" onClick={() => void save()}>Save edits</Button>}
      {editing && <Button onClick={() => void submit()}>Submit for approval</Button>}
    </PageHeader>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data.status === "submitted" && <p role="status">Edits are locked until Admin approves or rejects this list.</p>}
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
    </section>)}
  </div>;
}
