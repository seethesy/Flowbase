import { Allowed } from "../../app/permissions";
import { useState } from "react";
import {
  costSourceLabels,
  movementTypeLabels,
  type InventoryItem,
  type StockMovement,
} from "../../../shared/inventory";
import { unitLabel } from "../../../shared/units";
import { inventoryApi } from "../../services/core";
import { LoadMore, usePagedList } from "../../app/paging";
import { Button, Section, LoadingSkeleton, ErrorText } from "../../components/shared";
import { centsLabel, changeLabel, dateTimeLabel } from "./inventory-labels";
import { CorrectionForm } from "./inventory-stock-forms";
import { T, LabelT } from "../../app/copy";
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
    ["movements", item.id, version],
    (cursor) => inventoryApi.movements(item.id, cursor),
  );
  const [correcting, setCorrecting] = useState<StockMovement | null>(null);
  const all = movements.data ?? [];
  const total = (movement: StockMovement) =>
    movement.quantity +
    all
      .filter((other) => other.correctsId === movement.id)
      .reduce((sum, other) => sum + other.quantity, 0);
  return (
    <Section title={<T id="inventory-histories.movement-history.movement-history">Movement history</T>}>
      {movements.error ? (
        <ErrorText message={movements.error} />
      ) : !movements.data ? (
        <LoadingSkeleton />
      ) : !all.length ? (
        <p className="muted"><T id="inventory-histories.movement-history.no-stock-movements-yet">No stock movements yet.</T></p>
      ) : (
        <div className="table-scroll">
          <table className="stock-table movement-table">
            <thead>
              <tr>
                <th><T id="inventory-histories.movement-history.when">When</T></th>
                <th><T id="inventory-histories.movement-history.type">Type</T></th>
                <th><T id="inventory-histories.movement-history.section">Section</T></th>
                <th><T id="inventory-histories.movement-history.change">Change</T></th>
                <th><T id="inventory-histories.movement-history.reason">Reason</T></th>
                <th>
                  <span className="sr-only"><T id="inventory-histories.movement-history.actions">Actions</T></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {all.map((movement) => (
                <tr key={movement.id}>
                  <td>{dateTimeLabel(movement.createdAt)}</td>
                  <td>
                    <LabelT id="labels.movement-type" value={movement.type}>{movementTypeLabels[movement.type]}</LabelT>
                    {movement.correctsId && (
                      <span className="badge neutral"><T id="inventory-histories.movement-history.correction">Correction</T></span>
                    )}
                    {movement.correctedBy.length > 0 && (
                      <span className="badge warning"><T id="inventory-histories.movement-history.corrected">Corrected</T></span>
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
                            <T id="inventory-histories.movement-history.correct">Correct</T>
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
      <LoadMore list={movements} label={<T id="inventory-histories.movement-history.show-older-movements">Show older movements</T>} />
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
    ["cost-history", item.id, version],
    (cursor) => inventoryApi.costHistory(item.id, cursor),
  );
  const unit = item.consumable ? unitLabel(item.consumable.purchaseUnit) : "";
  return (
    <Section title={<T id="inventory-histories.cost-history.cost-history">Cost history</T>}>
      {history.error ? (
        <ErrorText message={history.error} />
      ) : !history.data ? (
        <LoadingSkeleton />
      ) : !history.data.length ? (
        <p className="muted"><T id="inventory-histories.cost-history.no-cost-changes-yet">No cost changes yet.</T></p>
      ) : (
        <table className="stock-table">
          <thead>
            <tr>
              <th><T id="inventory-histories.cost-history.when">When</T></th>
              <th><T id="inventory-histories.cost-history.cost-per" values={{ unit }}>{"Cost per {unit}"}</T></th>
              <th><T id="inventory-histories.cost-history.was">Was</T></th>
              <th><T id="inventory-histories.cost-history.source">Source</T></th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((change) => (
              <tr key={change.id}>
                <td>{dateTimeLabel(change.changedAt)}</td>
                <td>{centsLabel(change.unitCostCents)}</td>
                <td>{centsLabel(change.previousCents)}</td>
                <td><LabelT id="labels.cost-source" value={change.source}>{costSourceLabels[change.source]}</LabelT></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <LoadMore list={history} label={<T id="inventory-histories.cost-history.show-older-changes">Show older changes</T>} />
    </Section>
  );
}
