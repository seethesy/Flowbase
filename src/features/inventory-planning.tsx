import { useState } from "react";
import { Link } from "react-router-dom";
import type { ItemAllocationRow } from "../../shared/allocation";
import type { InventoryItem } from "../../shared/inventory";
import { conflictStateLabels, holdStatusLabels } from "../../shared/reservations";
import { addLocalDays } from "../../shared/time";
import { useResource } from "../app/useResource";
import { LoadError } from "../components/record-display";
import { LoadingSkeleton, Section } from "../components/shared";
import { planningApi } from "../services/planning";
import { date } from "./event-format";
import { quantityLabel } from "./inventory-labels";
import "./event-planning.css";

// What an item is committed to (FLOW-76, FLOW-77, FLOW-85), on the item page: a
// rental's availability over a chosen range, its holds and open conflicts, and a
// consumable's allocations in booking order. Event titles come back null for events
// the viewer can't open; those rows show no title and no link.

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const today = () => new Date().toLocaleDateString("en-CA");
const hiddenEvent = <span className="muted">An event you can't open</span>;

export function ItemPlanning({ item }: { item: InventoryItem }) {
  if (item.kind === "rental") return <RentalPlanning item={item} />;
  if (item.kind === "consumable") return <ConsumablePlanning item={item} />;
  return null;
}

function RentalPlanning({ item }: { item: InventoryItem }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addLocalDays(today(), 13));
  const valid = Boolean(from) && Boolean(to) && from <= to;
  // The range is part of the key, so changing it loads the new availability (AC1).
  const availability = useResource(["inventory-availability", item.id, from, to], () =>
    valid ? planningApi.availability(item.id, from, to) : Promise.resolve(null),
  );
  const conflicts = useResource(["inventory-conflicts", item.id], () =>
    planningApi.itemConflicts(item.id),
  );
  const figures = availability.data;
  return (
    <>
      <Section title="Availability">
        <form className="planning-add" aria-label="Availability range" onSubmit={(e) => e.preventDefault()}>
          <label>
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </form>
        {!valid && (
          <p role="alert" className="error-message">
            Choose a range that ends on or after the day it starts.
          </p>
        )}
        {valid && availability.error && <LoadError message={availability.error} />}
        {valid && !availability.error && !figures && <LoadingSkeleton />}
        {valid && figures && (
          <>
            <table className="stock-table" aria-label="Availability for the range">
              <tbody>
                <tr>
                  <th scope="row">Owned</th>
                  <td>{quantityLabel(figures.owned, item.unit)}</td>
                </tr>
                <tr>
                  <th scope="row">Available</th>
                  <td>{figures.onRequest ? "Available on request" : quantityLabel(figures.available ?? 0, item.unit)}</td>
                </tr>
                <tr>
                  <th scope="row">Available with tentative holds</th>
                  <td>
                    {figures.onRequest
                      ? "Available on request"
                      : quantityLabel(figures.availableWithTentative ?? 0, item.unit)}
                  </td>
                </tr>
              </tbody>
            </table>
            <h3>Holds in this range</h3>
            <ul className="planning-list">
              {figures.holds.map((hold) => (
                <li className="planning-row" key={hold.id}>
                  {hold.eventTitle ? (
                    <Link to={`/events/${hold.eventId}`}>{hold.eventTitle}</Link>
                  ) : (
                    hiddenEvent
                  )}
                  <span className="muted">
                    {holdStatusLabels[hold.status]} · {date(hold.windowStart)}–{date(hold.windowEnd)}
                  </span>
                  {hold.issue && (
                    <span className={`planning-badge ${hold.issue}`}>
                      {hold.issue === "conflict" ? "Conflict" : "Warning"}: {number(hold.shortfall)} short
                    </span>
                  )}
                  <span className="planning-actions">{number(hold.quantity)}</span>
                </li>
              ))}
              {!figures.holds.length && <li className="muted">Nothing is held in this range.</li>}
            </ul>
          </>
        )}
      </Section>
      <Section title="Open conflicts">
        {conflicts.error && <LoadError message={conflicts.error} />}
        {!conflicts.error && !conflicts.data && <LoadingSkeleton />}
        {conflicts.data && (
          <ul className="planning-list">
            {conflicts.data.map((conflict) => (
              <li className="planning-row" key={conflict.id}>
                <span className={`planning-badge ${conflict.kind}`}>
                  {conflict.kind === "conflict" ? "Conflict" : "Warning"}
                </span>
                {conflict.eventTitle ? (
                  <Link to={`/events/${conflict.eventId}`}>
                    {conflict.eventTitle}
                    {conflict.eventDate ? ` · ${date(conflict.eventDate)}` : ""}
                  </Link>
                ) : (
                  hiddenEvent
                )}
                <span>
                  {number(conflict.shortfall)} short ({number(conflict.allocated)} of {number(conflict.quantity)})
                </span>
                {conflict.state !== "open" && <span className="muted">{conflictStateLabels[conflict.state]}</span>}
              </li>
            ))}
            {!conflicts.data.length && <li className="muted">No open conflicts.</li>}
          </ul>
        )}
      </Section>
    </>
  );
}

function ConsumablePlanning({ item }: { item: InventoryItem }) {
  const allocations = useResource(["inventory-allocations", item.id], () => planningApi.allocations(item.id));
  return (
    <Section title="Allocations">
      {allocations.error && <LoadError message={allocations.error} />}
      {!allocations.error && !allocations.data && <LoadingSkeleton />}
      {allocations.data &&
        (allocations.data.length ? (
          <table className="stock-table" aria-label="Allocations in booking order">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Required</th>
                <th>Allocated</th>
                <th>Shortage</th>
                <th>Projected stock</th>
                <th>Order by</th>
              </tr>
            </thead>
            <tbody>
              {allocations.data.map((row) => (
                <AllocationRow key={row.eventId} row={row} unit={item.unit} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No event needs this item yet.</p>
        ))}
    </Section>
  );
}

function AllocationRow({ row, unit }: { row: ItemAllocationRow; unit: InventoryItem["unit"] }) {
  return (
    <tr>
      <td>{row.eventTitle ? <Link to={`/events/${row.eventId}`}>{row.eventTitle}</Link> : hiddenEvent}</td>
      <td>{row.eventDate ? date(row.eventDate) : "—"}</td>
      <td>{quantityLabel(row.required, unit)}</td>
      <td>{quantityLabel(row.allocated, unit)}</td>
      <td>{row.shortage > 0 ? <strong>{quantityLabel(row.shortage, unit)}</strong> : "—"}</td>
      <td>{quantityLabel(row.projectedStock, unit)}</td>
      <td>{row.orderBy ? date(row.orderBy) : "—"}</td>
    </tr>
  );
}
