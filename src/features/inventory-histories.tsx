import { Allowed } from "../app/permissions";
import { useState } from "react";
import {
  costSourceLabels,
  movementTypeLabels,
  type InventoryItem,
  type StockMovement,
} from "../../shared/inventory";
import { unitLabel } from "../../shared/units";
import { inventoryApi } from "../services/core";
import { LoadMore, usePagedList } from "../app/paging";
import { Button, Section, LoadingSkeleton } from "../components/shared";
import { LoadError } from "./clients";
import { centsLabel, changeLabel, dateTimeLabel } from "./inventory-labels";
import { CorrectionForm } from "./inventory-stock-forms";
import "./inventory.css";

// The item's stock ledger, newest first (FLOW-71).
export function MovementHistory({
  item,
  version,
  onCorrected,
}: {
  item: InventoryItem;
  version: number;
  onCorrected: () => void;
}) {
  // Newest first, a page at a time (FLOW-179). Corrections are newer than the
  // movement they correct, so they're loaded before it and its total is right.
  const movements = usePagedList(
    (cursor) => inventoryApi.movements(item.id, cursor),
    [item.id, version],
  );
  const [correcting, setCorrecting] = useState<StockMovement | null>(null);
  const all = movements.data ?? [];
  const total = (movement: StockMovement) =>
    movement.quantity +
    all
      .filter((other) => other.correctsId === movement.id)
      .reduce((sum, other) => sum + other.quantity, 0);
  return (
    <Section title="Movement history">
      {movements.error ? (
        <LoadError message={movements.error} />
      ) : !movements.data ? (
        <LoadingSkeleton />
      ) : !all.length ? (
        <p className="muted">No stock movements yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="stock-table movement-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Section</th>
                <th>Change</th>
                <th>Reason</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {all.map((movement) => (
                <tr key={movement.id}>
                  <td>{dateTimeLabel(movement.createdAt)}</td>
                  <td>
                    {movementTypeLabels[movement.type]}
                    {movement.correctsId && (
                      <span className="badge neutral">Correction</span>
                    )}
                    {movement.correctedBy.length > 0 && (
                      <span className="badge warning">Corrected</span>
                    )}
                  </td>
                  <td>
                    {movement.sectionName}
                    {movement.color ? ` · ${movement.color}` : ""}
                  </td>
                  <td>{changeLabel(movement.quantity)}</td>
                  <td>{movement.reason || "—"}</td>
                  <td>
                    {!movement.correctsId &&
                      movement.type !== "transfer" &&
                      !item.archivedAt && (
                        <Allowed action="inventory.move" item={item}>
                          <Button
                            variant="ghost"
                            onClick={() => setCorrecting(movement)}
                            aria-label={`Correct the ${movementTypeLabels[movement.type].toLowerCase()} of ${dateTimeLabel(movement.createdAt)}`}
                          >
                            Correct
                          </Button>
                        </Allowed>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {correcting && (
        <CorrectionForm
          item={item}
          movement={correcting}
          current={total(correcting)}
          onClose={() => setCorrecting(null)}
          onSaved={onCorrected}
        />
      )}
      <LoadMore list={movements} label="Show older movements" />
    </Section>
  );
}

// Unit-cost history (FLOW-83), for FT+ users.
export function CostHistory({
  item,
  version,
}: {
  item: InventoryItem;
  version: number;
}) {
  const history = usePagedList(
    (cursor) => inventoryApi.costHistory(item.id, cursor),
    [item.id, version],
  );
  const unit = item.consumable ? unitLabel(item.consumable.purchaseUnit) : "";
  return (
    <Section title="Cost history">
      {history.error ? (
        <LoadError message={history.error} />
      ) : !history.data ? (
        <LoadingSkeleton />
      ) : !history.data.length ? (
        <p className="muted">No cost changes yet.</p>
      ) : (
        <table className="stock-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Cost per {unit}</th>
              <th>Was</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((change) => (
              <tr key={change.id}>
                <td>{dateTimeLabel(change.changedAt)}</td>
                <td>{centsLabel(change.unitCostCents)}</td>
                <td>{centsLabel(change.previousCents)}</td>
                <td>{costSourceLabels[change.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore list={history} label="Show older changes" />
    </Section>
  );
}
