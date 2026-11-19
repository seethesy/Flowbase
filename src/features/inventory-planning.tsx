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
import { T } from "../app/live-copy";

// What an item is committed to (FLOW-76, FLOW-77, FLOW-85), on the item page: a
// rental's availability over a chosen range, its holds and open conflicts, and a
// consumable's allocations in booking order. Event titles come back null for events
// the viewer can't open; those rows show no title and no link.

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const today = () => new Date().toLocaleDateString("en-CA");
const hiddenEvent = <span className="muted"><T id="inventory-planning.file.an-event-you-can-t-open">{"An event you can't open"}</T></span>;

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
      <Section title={<T id="inventory-planning.rental-planning.availability">Availability</T>}>
        <form className="planning-add" aria-label="Availability range" onSubmit={(e) => e.preventDefault()}>
          <label>
            <T id="inventory-planning.rental-planning.from">{"From "}</T><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <T id="inventory-planning.rental-planning.to">{"To "}</T><input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </form>
        {!valid && (
          <p role="alert" className="error-message">
            <T id="inventory-planning.rental-planning.choose-a-range-that-ends-on">Choose a range that ends on or after the day it starts.</T>
          </p>
        )}
        {valid && availability.error && <LoadError message={availability.error} />}
        {valid && !availability.error && !figures && <LoadingSkeleton />}
        {valid && figures && (
          <>
            <table className="stock-table" aria-label="Availability for the range">
              <tbody>
                <tr>
                  <th scope="row"><T id="inventory-planning.rental-planning.owned">Owned</T></th>
                  <td>{quantityLabel(figures.owned, item.unit)}</td>
                </tr>
                <tr>
                  <th scope="row"><T id="inventory-planning.rental-planning.available">Available</T></th>
                  <td>{figures.onRequest ? <T id="inventory-planning.rental-planning.available-on-request">Available on request</T> : quantityLabel(figures.available ?? 0, item.unit)}</td>
                </tr>
                <tr>
                  <th scope="row"><T id="inventory-planning.rental-planning.available-with-tentative-holds">Available with tentative holds</T></th>
                  <td>
                    {figures.onRequest
                      ? <T id="inventory-planning.rental-planning.available-on-request">Available on request</T>
                      : quantityLabel(figures.availableWithTentative ?? 0, item.unit)}
                  </td>
                </tr>
              </tbody>
            </table>
            <h3><T id="inventory-planning.rental-planning.holds-in-this-range">Holds in this range</T></h3>
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
                      <T id="inventory-planning.rental-planning.short" values={{ value: hold.issue === "conflict" ? <T id="inventory-planning.rental-planning.conflict">Conflict</T> : <T id="inventory-planning.rental-planning.warning">Warning</T>, shortfall: number(hold.shortfall) }}>{"{value}: {shortfall} short"}</T>
                    </span>
                  )}
                  <span className="planning-actions">{number(hold.quantity)}</span>
                </li>
              ))}
              {!figures.holds.length && <li className="muted"><T id="inventory-planning.rental-planning.nothing-is-held-in-this-range">Nothing is held in this range.</T></li>}
            </ul>
          </>
        )}
      </Section>
      <Section title={<T id="inventory-planning.rental-planning.open-conflicts">Open conflicts</T>}>
        {conflicts.error && <LoadError message={conflicts.error} />}
        {!conflicts.error && !conflicts.data && <LoadingSkeleton />}
        {conflicts.data && (
          <ul className="planning-list">
            {conflicts.data.map((conflict) => (
              <li className="planning-row" key={conflict.id}>
                <span className={`planning-badge ${conflict.kind}`}>
                  {conflict.kind === "conflict" ? <T id="inventory-planning.rental-planning.conflict">Conflict</T> : <T id="inventory-planning.rental-planning.warning">Warning</T>}
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
                  <T id="inventory-planning.rental-planning.short-of" values={{ shortfall: number(conflict.shortfall), allocated: number(conflict.allocated), quantity: number(conflict.quantity) }}>{"{shortfall} short ({allocated} of {quantity})"}</T>
                </span>
                {conflict.state !== "open" && <span className="muted">{conflictStateLabels[conflict.state]}</span>}
              </li>
            ))}
            {!conflicts.data.length && <li className="muted"><T id="inventory-planning.rental-planning.no-open-conflicts">No open conflicts.</T></li>}
          </ul>
        )}
      </Section>
    </>
  );
}

function ConsumablePlanning({ item }: { item: InventoryItem }) {
  const allocations = useResource(["inventory-allocations", item.id], () => planningApi.allocations(item.id));
  return (
    <Section title={<T id="inventory-planning.consumable-planning.allocations">Allocations</T>}>
      {allocations.error && <LoadError message={allocations.error} />}
      {!allocations.error && !allocations.data && <LoadingSkeleton />}
      {allocations.data &&
        (allocations.data.length ? (
          <table className="stock-table" aria-label="Allocations in booking order">
            <thead>
              <tr>
                <th><T id="inventory-planning.consumable-planning.event">Event</T></th>
                <th><T id="inventory-planning.consumable-planning.date">Date</T></th>
                <th><T id="inventory-planning.consumable-planning.required">Required</T></th>
                <th><T id="inventory-planning.consumable-planning.allocated">Allocated</T></th>
                <th><T id="inventory-planning.consumable-planning.shortage">Shortage</T></th>
                <th><T id="inventory-planning.consumable-planning.projected-stock">Projected stock</T></th>
                <th><T id="inventory-planning.consumable-planning.order-by">Order by</T></th>
              </tr>
            </thead>
            <tbody>
              {allocations.data.map((row) => (
                <AllocationRow key={row.eventId} row={row} unit={item.unit} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted"><T id="inventory-planning.consumable-planning.no-event-needs-this-item-yet">No event needs this item yet.</T></p>
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
