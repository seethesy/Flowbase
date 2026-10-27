import { Allowed } from "../app/permissions";
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
  allergenLabels,
  barContainerLabels,
  ratioBasisLabels,
  type InventoryItem,
} from "../../shared/inventory";
import { unitLabel } from "../../shared/units";
import { inventoryApi } from "../services/core";
import { useResource } from "../app/useResource";
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

export function InventoryDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const item = useResource(() => inventoryApi.get(id), [id]);
  const [edit, setEdit] = useState(false);
  const [stockForm, setStockForm] = useState<
    "transfer" | "count" | "movement" | null
  >(null);
  const [archive, setArchive] = useState(false);
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
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="inventory.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          </Allowed>
          {i.archivedAt ? (
            <Allowed action="inventory.write">
              <Button
                variant="outline"
                onClick={async () =>
                  item.replace(await inventoryApi.setArchived(i.id, false))
                }
              >
                <RotateCcw size={14} />
                Restore
              </Button>
            </Allowed>
          ) : (
            <Allowed action="inventory.write">
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                Archive
              </Button>
            </Allowed>
          )}
        </div>
      </div>
      <div className="detail-grid">
        <Section title="Item details">
          <small>Category</small>
          <p>{i.category || "—"}</p>
          <small>Group / variant</small>
          <p>{variantLabel(i) || "—"}</p>
          <small>Ratio</small>
          <p>
            {i.ratio
              ? `${i.ratio.quantity} ${ratioBasisLabels[i.ratio.basis]}`
              : "—"}
          </p>
          {i.rental && (
            <>
              <small>Price</small>
              <p>{centsLabel(i.rental.priceCents)}</p>
            </>
          )}
          {i.service && (
            <>
              <small>Price</small>
              <p>
                {centsLabel(i.service.priceCents)}{" "}
                {ratioBasisLabels[i.service.priceBasis]}
              </p>
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
            <p>{c.preferredVendor || "—"}</p>
            <small>Par level</small>
            <p>
              {c.parLevel === null ? "—" : quantityLabel(c.parLevel, i.unit)}
            </p>
            <small>Storage</small>
            <p>{c.storageSectionName ?? "—"}</p>
            <small>Allergens</small>
            <p>
              {c.allergens
                .map((allergen) => allergenLabels[allergen])
                .join(", ") || "None flagged"}
            </p>
          </Section>
        )}
      </div>
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
                <tr key={level.sectionId}>
                  <td>{level.sectionName}</td>
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
