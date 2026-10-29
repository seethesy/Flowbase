import { Allowed, usePermissions } from "../app/permissions";
import { isFtPlus } from "../../shared/access";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Pencil,
  Archive,
  RotateCcw,
  ArrowLeftRight,
  ClipboardCheck,
  PackagePlus,
} from "lucide-react";
import {
  barContainerLabels,
  ratioBasisLabels,
  type InventoryItem,
} from "../../shared/inventory";
import { unitLabel } from "../../shared/units";
import { allPages, inventoryApi, inventoryChangesApi } from "../services/core";
import { useResource } from "../app/useResource";
import { useOpenFor, useStateFor } from "../app/useOpenFor";
import {
  Button,
  Section,
  ConfirmationDialog,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { Attachments } from "./attachments";
import { CostHistory, MovementHistory } from "./inventory-histories";
import { ItemForm } from "./inventory-item-form";
import {
  centsLabel,
  kindLabels,
  purchaseLabel,
  quantityLabel,
  subtypeLabel,
  variantLabel,
} from "./inventory-labels";
import { MovementForm, StockForm } from "./inventory-stock-forms";
import "./inventory.css";
import { effectiveRatio } from "../../shared/inventory-requirements";
import { useBusinessSettings } from "../services/settings";
import { canSeeRentalCosts } from "../../shared/visibility";

export function InventoryDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const settings = useBusinessSettings();
  const { actor, can } = usePermissions();
  const item = useResource(
    ["inventory-items", id],
    () => inventoryApi.get(id),
  );
  const pending = useResource(["inventory-pending", id], () => inventoryChangesApi.pending([id]));
  const [changeNotice, setChangeNotice] = useState("");
  const [edit, setEdit] = useOpenFor(id);
  const [stockForm, setStockForm] = useStateFor<
    "transfer" | "count" | "movement" | null
  >(id, null);
  const [archive, setArchive] = useOpenFor(id);
  // Bumped on every stock or cost change so the histories reload.
  const [version, setVersion] = useState(0);
  const saved = (next: InventoryItem) => {
    item.replace(next);
    setVersion((current) => current + 1);
  };
  const back = (
    <Link to="/inventory" className="back-link">
      ← All inventory
    </Link>
  );
  if (item.error)
    return (
      <>
        {back}
        <LoadError message={item.error} />
      </>
    );
  const i = item.data;
  if (!i) return <LoadingSkeleton />;
  const c = i.consumable;
  const ratio = effectiveRatio(i, settings.defaults);
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{i.name}</h1>
          <p>
            <span className="badge neutral">
              {[kindLabels[i.kind], subtypeLabel(i.subtype)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {i.code && <span className="sku">{i.code}</span>}
            {!i.active && <span className="badge error">Inactive</span>}
            {i.archivedAt && <span className="badge error">Archived</span>}
            {i.belowPar && <span className="badge warning">Below par</span>}
            {(pending.data?.length ?? 0) > 0 && <span className="badge warning">Pending changes</span>}
          </p>
        </div>
        <div className="page-actions">
          {actor && (can("inventory.write") || isFtPlus(actor)) && (
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
          {i.archivedAt ? (
            actor && (can("inventory.write") || isFtPlus(actor)) && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (i.kind !== "consumable" && !can("rentals.apply_directly")) {
                    await inventoryChangesApi.submit([{ type: "archive", itemId: i.id, archived: false }]);
                    setChangeNotice("Restore submitted for Admin approval."); pending.reload();
                  } else item.replace(await inventoryApi.setArchived(i.id, false));
                }}
              >
                <RotateCcw size={14} />
                Restore
              </Button>
            )
          ) : (
            actor && (can("inventory.write") || isFtPlus(actor)) && (
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                Archive
              </Button>
            )
          )}
        </div>
      </div>
      {changeNotice && <p role="status">{changeNotice}</p>}
      {!!pending.data?.length && <Section title="Pending changes"><ul>{pending.data.map((change) => (
        <li key={`${change.approvalId}:${change.field}`}>
          {change.field} proposed by {change.proposedBy} on {new Date(change.proposedAt).toLocaleString()}
        </li>
      ))}</ul></Section>}
      <div className="detail-grid">
        <Section title="Item details">
          <small>Category</small>
          <p>{i.category || "—"}</p>
          <small>Group / variant</small>
          <p>{variantLabel(i) || "—"}</p>
          <small>Ratio</small>
          <p>
            {ratio
              ? `${ratio.quantity} ${ratioBasisLabels[ratio.basis]}${!i.ratio ? " (category default)" : ""}`
              : "—"}
          </p>
          {i.rental && (
            <>
              <small>Price</small>
              <p>{centsLabel(i.rental.priceCents)}</p>
              {actor && canSeeRentalCosts(actor) && (
                <>
                  <small>Internal cost</small>
                  <p>{centsLabel(i.rental.internalCostCents ?? null)}</p>
                  <small>Replacement cost</small>
                  <p>{centsLabel(i.rental.replacementCostCents ?? null)}</p>
                </>
              )}
              {i.rental.vendorId && (
                <>
                  <small>Sub-rented from</small>
                  <p>
                    <Link to={`/vendors/${i.rental.vendorId}`}>
                      {i.rental.vendorName ?? "Vendor"}
                    </Link>{" "}
                    · available on request
                  </p>
                  {actor && canSeeRentalCosts(actor) && (
                    <>
                      <small>Vendor cost</small>
                      <p>{centsLabel(i.rental.vendorCostCents ?? null)}</p>
                    </>
                  )}
                  <small>Lead time</small>
                  <p>
                    {i.rental.leadTimeDays === null
                      ? "—"
                      : `${i.rental.leadTimeDays} day${i.rental.leadTimeDays === 1 ? "" : "s"}`}
                  </p>
                </>
              )}
              <small>Dimensions</small>
              <p>{i.rental.dimensions || "—"}</p>
              <small>Buffer days before / after</small>
              <p>
                {i.rental.bufferDaysBefore} / {i.rental.bufferDaysAfter}
              </p>
              <small>Assembly notes</small>
              <p>{i.rental.assemblyNotes || "—"}</p>
              <small>Notes</small>
              <p>{i.rental.notes || "—"}</p>
              {i.rental.colors.length > 0 && (
                <>
                  <small>Colors</small>
                  <p>{i.rental.colors.join(", ")}</p>
                </>
              )}
            </>
          )}
          {i.service && (
            <>
              <small>Price</small>
              <p>
                {i.service.pricedByQuote
                  ? "Priced by quote"
                  : `${centsLabel(i.service.priceCents)} ${ratioBasisLabels[i.service.priceBasis]}`}
              </p>
              {i.service.addons.map((addon, index) => (
                <p key={index}>
                  {addon.name}: {centsLabel(addon.priceCents)} per guest
                </p>
              ))}
            </>
          )}
          <small>Description</small>
          <p>{i.description || "—"}</p>
        </Section>
        {c && (
          <Section title="Purchasing">
            <small>Bought as</small>
            <p>{purchaseLabel(c)}</p>
            <small>Recipe unit</small>
            <p>{c.recipeUnit ? unitLabel(c.recipeUnit) : "—"}</p>
            <small>Unit cost</small>
            <p>
              {c.costHidden
                ? "Cost hidden for your role and employment type."
                : c.unitCostCents === null
                  ? "—"
                  : `${centsLabel(c.unitCostCents)} per ${unitLabel(c.purchaseUnit)}`}
            </p>
            {i.bar && (
              <>
                <small>Brand / varietal</small>
                <p>{i.bar.brand || "—"}</p>
                <small>Subcategory</small>
                <p>{i.bar.subcategory || "—"}</p>
                <small>Container</small>
                <p>
                  {i.bar.container ? barContainerLabels[i.bar.container] : "—"}
                </p>
              </>
            )}
            <small>{i.bar ? "Distributor" : "Preferred vendor"}</small>
            <p>
              {c.preferredVendorId ? (
                <Link to={`/vendors/${c.preferredVendorId}`}>
                  {c.preferredVendor}
                </Link>
              ) : (
                c.preferredVendor || "—"
              )}
            </p>
            <small>Par level</small>
            <p>
              {c.parLevel === null ? "—" : quantityLabel(c.parLevel, i.unit)}
            </p>
            <small>Storage</small>
            <p>{c.storageSectionName ?? "—"}</p>
          </Section>
        )}
      </div>
      {i.rental?.components.length || i.service?.includes.length ? (
        <IncludedItems item={i} />
      ) : null}
      {i.kind === "service" ? (
        <Section title="Stock">
          <p className="muted">Services aren't stocked.</p>
        </Section>
      ) : (
        <Section
          title="Stock by section"
          action={
            !i.archivedAt && (
              <div className="page-actions">
                <Allowed action="inventory.move" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("movement")}
                  >
                    <PackagePlus size={14} />
                    Record movement
                  </Button>
                </Allowed>
                <Allowed action="inventory.count" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("count")}
                  >
                    <ClipboardCheck size={14} />
                    Count
                  </Button>
                </Allowed>
                <Allowed action="inventory.move" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("transfer")}
                  >
                    <ArrowLeftRight size={14} />
                    Transfer
                  </Button>
                </Allowed>
              </div>
            )
          }
        >
          <table className="stock-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {i.stock.map((level) => (
                <tr key={`${level.sectionId}:${level.color ?? ""}`}>
                  <td>
                    {level.sectionName}
                    {level.color
                      ? ` · ${level.color}`
                      : i.rental?.colors.length
                        ? " · Unassigned color"
                        : ""}
                  </td>
                  <td>{quantityLabel(level.quantity, i.unit)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                <td>
                  <strong>{quantityLabel(i.totalQuantity, i.unit)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
      {i.kind !== "service" && (
        <MovementHistory
          item={i}
          version={version}
          onCorrected={() => {
            item.reload();
            setVersion((current) => current + 1);
          }}
        />
      )}
      {c && !c.costHidden && <CostHistory item={i} version={version} />}
      <Attachments recordType="inventory_item" recordId={i.id} title="Photos" />
      {edit && (
        <ItemForm item={i} onClose={() => setEdit(false)} onSaved={saved} />
      )}
      {stockForm === "movement" && (
        <MovementForm
          item={i}
          onClose={() => setStockForm(null)}
          onSaved={saved}
        />
      )}
      {(stockForm === "transfer" || stockForm === "count") && (
        <StockForm
          item={i}
          mode={stockForm}
          onClose={() => setStockForm(null)}
          onSaved={saved}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title="Archive this item?"
        onConfirm={async () => {
          if (i.kind !== "consumable" && !can("rentals.apply_directly")) {
            await inventoryChangesApi.submit([{ type: "archive", itemId: i.id, archived: true }]);
            setChangeNotice("Archive submitted for Admin approval."); pending.reload();
            setArchive(false);
            return;
          }
          await inventoryApi.setArchived(i.id, true);
          setArchive(false);
          navigate("/inventory");
        }}
      >
        {i.name} will be hidden from inventory lists.
      </ConfirmationDialog>
    </>
  );
}

function IncludedItems({ item }: { item: InventoryItem }) {
  const items = useResource(["inventory-items", "all"], () => allPages((cursor) => inventoryApi.list({}, cursor)));
  const lines = item.rental?.components ?? item.service?.includes ?? [];
  return (
    <Section title={item.service ? "Includes" : "Kit components"}>
      {items.error ? (
        <LoadError message={items.error} />
      ) : (
        <ul>
          {lines.map((line) => (
            <li key={line.itemId}>
              <Link to={`/inventory/${line.itemId}`}>
                {items.data?.find((row) => row.id === line.itemId)?.name ??
                  line.itemId}
              </Link>
              : {line.quantity}
              {"basis" in line
                ? ` ${ratioBasisLabels[line.basis as "per_guest" | "per_event"]}`
                : " per kit"}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
