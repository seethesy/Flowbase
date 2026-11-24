import { Allowed, usePermissions } from "../../app/permissions";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { FieldCard } from "../../app/live-edit/field-card";
import { isFtPlus } from "../../../shared/access";
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
} from "../../../shared/inventory";
import { unitLabel } from "../../../shared/units";
import { allPages, inventoryApi, inventoryChangesApi } from "../../services/core";
import { tasksApi } from "../../services/tasks";
import { useResource } from "../../app/useResource";
import { useOpenFor, useStateFor } from "../../app/useOpenFor";
import {
  Button,
  Section,
  ConfirmationDialog,
  LoadingSkeleton,
  ErrorText,
} from "../../components/shared";
import { Attachments } from "../common/attachments";
import { CostHistory, MovementHistory } from "./inventory-histories";
import { ItemForm } from "./inventory-item-form";
import { ItemPlanning } from "./inventory-planning";
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
import { effectiveRatio } from "../../../shared/inventory-requirements";
import { useBusinessSettings } from "../../services/settings";
import { canSeeRentalCosts } from "../../../shared/visibility";
import { Plural, T, LabelT, joined } from "../../app/copy";

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
  // Back to the item's own list (FLOW-289).
  const list = item.data?.list;
  const back = list === "kitchen" ? (
    <Link to="/kitchen/ingredients" className="back-link">
      <T id="inventory-detail.inventory-detail.all-ingredients">← All ingredients</T>
    </Link>
  ) : list === "bar" ? (
    <Link to="/inventory/bar" className="back-link">
      <T id="inventory-detail.inventory-detail.all-bar-inventory">← Bar Inventory</T>
    </Link>
  ) : (
    <Link to="/inventory" className="back-link">
      <T id="inventory-detail.inventory-detail.all-inventory">← All inventory</T>
    </Link>
  );
  if (item.error)
    return (
      <>
        {back}
        <ErrorText message={item.error} />
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
              {/* Every Master item reads "Rental" (FLOW-289). */}
              {i.list === "master"
                ? <T id="inventory-detail.inventory-detail.rental">Rental</T>
                : joined([<LabelT id="labels.item-kind" value={i.kind}>{kindLabels[i.kind]}</LabelT>, subtypeLabel(i.subtype)])}
            </span>
            {i.code && <span className="sku">{i.code}</span>}
            {!i.active && <span className="badge error"><T id="inventory-detail.inventory-detail.inactive">Inactive</T></span>}
            {i.archivedAt && <span className="badge error"><T id="inventory-detail.inventory-detail.archived">Archived</T></span>}
            {i.belowPar && <span className="badge warning"><T id="inventory-detail.inventory-detail.below-par">Below par</T></span>}
            {(pending.data?.length ?? 0) > 0 && <span className="badge warning"><T id="inventory-detail.inventory-detail.pending-changes">Pending changes</T></span>}
          </p>
        </div>
        <div className="page-actions">
          {actor && (can("inventory.write") || isFtPlus(actor)) && (
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              <T id="inventory-detail.inventory-detail.edit">Edit</T>
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
                <T id="inventory-detail.inventory-detail.restore">Restore</T>
              </Button>
            )
          ) : (
            actor && (can("inventory.write") || isFtPlus(actor)) && (
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                <T id="inventory-detail.inventory-detail.archive">Archive</T>
              </Button>
            )
          )}
        </div>
      </div>
      {changeNotice && <p role="status">{changeNotice}</p>}
      {!!pending.data?.length && <Section title={<T id="inventory-detail.inventory-detail.pending-changes">Pending changes</T>}><ul>{pending.data.map((change) => (
        <li key={`${change.approvalId}:${change.field}`}>
          <T id="inventory-detail.inventory-detail.proposed-by-on" values={{ field: change.field, proposedBy: change.proposedBy, toLocaleString: new Date(change.proposedAt).toLocaleString() }}>{"{field} proposed by {proposedBy} on {toLocaleString}"}</T>
        </li>
      ))}</ul></Section>}
      <div className="detail-grid">
        <PageGrid pageKey="inventory.detail" record={{ source: "inventory", id: i.id, row: i as unknown as Record<string, unknown> }}>
        <Block id="item-facts" name="Item details" w={6} h={16}>
        <FieldCard cardKey="item-facts" source="inventory" row={i as unknown as Record<string, unknown>}
          title={<T id="inventory-detail.inventory-detail.item-details">Item details</T>}
          fields={["name", "code", "category", "group", "unit", "description"]}>
        <Section title={<T id="inventory-detail.inventory-detail.item-details">Item details</T>}>
          <small><T id="inventory-detail.inventory-detail.category">Category</T></small>
          <p>{i.category || "—"}</p>
          <small><T id="inventory-detail.inventory-detail.group-variant">Group / variant</T></small>
          <p>{variantLabel(i) || "—"}</p>
          <small><T id="inventory-detail.inventory-detail.ratio">Ratio</T></small>
          <p>
            {ratio
              ? <>{ratio.quantity} <LabelT id="labels.ratio-basis" value={ratio.basis}>{ratioBasisLabels[ratio.basis]}</LabelT>{!i.ratio && <T id="inventory-detail.inventory-detail.category-default">{" (category default)"}</T>}</>
              : "—"}
          </p>
          {i.rental && (
            <>
              <small><T id="inventory-detail.inventory-detail.price">Price</T></small>
              <p>{centsLabel(i.rental.priceCents)}</p>
              {actor && canSeeRentalCosts(actor) && (
                <>
                  <small><T id="inventory-detail.inventory-detail.internal-cost">Internal cost</T></small>
                  <p>{centsLabel(i.rental.internalCostCents ?? null)}</p>
                  <small><T id="inventory-detail.inventory-detail.replacement-cost">Replacement cost</T></small>
                  <p>{centsLabel(i.rental.replacementCostCents ?? null)}</p>
                </>
              )}
              {i.rental.vendorId && (
                <>
                  <small><T id="inventory-detail.inventory-detail.sub-rented-from">Sub-rented from</T></small>
                  <p>
                    <Link to={`/vendors/${i.rental.vendorId}`}>
                      {i.rental.vendorName ?? <T id="inventory-detail.inventory-detail.vendor">Vendor</T>}
                    </Link><T id="inventory-detail.inventory-detail.available-on-request">{" · available on request"}</T>
                  </p>
                  {actor && canSeeRentalCosts(actor) && (
                    <>
                      <small><T id="inventory-detail.inventory-detail.vendor-cost">Vendor cost</T></small>
                      <p>{centsLabel(i.rental.vendorCostCents ?? null)}</p>
                    </>
                  )}
                  <small><T id="inventory-detail.inventory-detail.lead-time">Lead time</T></small>
                  <p>
                    {i.rental.leadTimeDays === null
                      ? "—"
                      : <Plural id="inventory-detail.inventory-detail.days" count={i.rental.leadTimeDays} one="{count} day" other="{count} days" />}
                  </p>
                </>
              )}
              <small><T id="inventory-detail.inventory-detail.dimensions">Dimensions</T></small>
              <p>{i.rental.dimensions || "—"}</p>
              <small><T id="inventory-detail.inventory-detail.buffer-days-before-after">Buffer days before / after</T></small>
              <p>
                {i.rental.bufferDaysBefore} / {i.rental.bufferDaysAfter}
              </p>
              <small><T id="inventory-detail.inventory-detail.assembly-notes">Assembly notes</T></small>
              <p>{i.rental.assemblyNotes || "—"}</p>
              <small><T id="inventory-detail.inventory-detail.notes">Notes</T></small>
              <p>{i.rental.notes || "—"}</p>
              {i.rental.colors.length > 0 && (
                <>
                  <small><T id="inventory-detail.inventory-detail.colors">Colors</T></small>
                  <p>{i.rental.colors.join(", ")}</p>
                </>
              )}
            </>
          )}
          {i.service && (
            <>
              <small><T id="inventory-detail.inventory-detail.price">Price</T></small>
              <p>
                {i.service.pricedByQuote
                  ? <T id="inventory-detail.inventory-detail.priced-by-quote">Priced by quote</T>
                  : <>{centsLabel(i.service.priceCents)} <LabelT id="labels.ratio-basis" value={i.service.priceBasis}>{ratioBasisLabels[i.service.priceBasis]}</LabelT></>}
              </p>
              {i.service.addons.map((addon, index) => (
                <p key={index}>
                  <T id="inventory-detail.inventory-detail.per-guest" values={{ name: addon.name, priceCents: centsLabel(addon.priceCents) }}>{"{name}: {priceCents} per guest"}</T>
                </p>
              ))}
            </>
          )}
          <small><T id="inventory-detail.inventory-detail.description">Description</T></small>
          <p>{i.description || "—"}</p>
        </Section>
        </FieldCard>
        </Block>
        {c && (
          <Block id="purchasing" name="Purchasing" w={6} h={14}>
          <Section title={<T id="inventory-detail.inventory-detail.purchasing">Purchasing</T>}>
            <small><T id="inventory-detail.inventory-detail.bought-as">Bought as</T></small>
            <p>{purchaseLabel(c)}</p>
            <small><T id="inventory-detail.inventory-detail.recipe-unit">Recipe unit</T></small>
            <p>{c.recipeUnit ? unitLabel(c.recipeUnit) : "—"}</p>
            <small><T id="inventory-detail.inventory-detail.unit-cost">Unit cost</T></small>
            <p>
              {c.costHidden
                ? <T id="inventory-detail.inventory-detail.cost-hidden-for-your-role">Cost hidden for your role and employment type.</T>
                : c.unitCostCents === null
                  ? "—"
                  : <T id="inventory-detail.inventory-detail.per" values={{ unitCostCents: centsLabel(c.unitCostCents), unitLabel: unitLabel(c.purchaseUnit) }}>{"{unitCostCents} per {unitLabel}"}</T>}
            </p>
            {i.bar && (
              <>
                <small><T id="inventory-detail.inventory-detail.brand-varietal">Brand / varietal</T></small>
                <p>{i.bar.brand || "—"}</p>
                <small><T id="inventory-detail.inventory-detail.subcategory">Subcategory</T></small>
                <p>{i.bar.subcategory || "—"}</p>
                <small><T id="inventory-detail.inventory-detail.container">Container</T></small>
                <p>
                  {i.bar.container ? <LabelT id="labels.bar-container" value={i.bar.container}>{barContainerLabels[i.bar.container]}</LabelT> : "—"}
                </p>
                <small><T id="inventory-detail.inventory-detail.house-pick-for-its-tier">House pick for its tier</T></small>
                <p>{i.bar.housePick ? <T id="inventory-detail.inventory-detail.yes">Yes</T> : <T id="inventory-detail.inventory-detail.no">No</T>}</p>
              </>
            )}
            <small>{i.bar ? <T id="inventory-detail.inventory-detail.distributor">Distributor</T> : <T id="inventory-detail.inventory-detail.preferred-vendor">Preferred vendor</T>}</small>
            <p>
              {c.preferredVendorId ? (
                <Link to={`/vendors/${c.preferredVendorId}`}>
                  {c.preferredVendor}
                </Link>
              ) : (
                c.preferredVendor || "—"
              )}
            </p>
            <small><T id="inventory-detail.inventory-detail.par-level">Par level</T></small>
            <p>
              {c.parLevel === null ? "—" : quantityLabel(c.parLevel, i.unit)}
            </p>
            {/* Bar stock has no location on screen (FLOW-291). */}
            {i.list !== "bar" && <>
              <small><T id="inventory-detail.inventory-detail.storage">Storage</T></small>
              <p>{c.storageSectionName ?? "—"}</p>
            </>}
          </Section>
          </Block>
        )}
        {(i.rental?.components.length || i.service?.includes.length) ? (
          <Block id="included-items" name="Included items" w={12} h={10}>
            <IncludedItems item={i} />
          </Block>
        ) : null}
        {i.kind === "service" && can("tasks.read") && (
          <Block id="task-templates" name="Task templates" w={12} h={10}>
            <ServiceTaskTemplates itemId={i.id} />
          </Block>
        )}
        <Block id="stock" name="Stock" w={12} h={12}>
      {i.kind === "service" ? (
        <Section title={<T id="inventory-detail.inventory-detail.stock">Stock</T>}>
          <p className="muted"><T id="inventory-detail.inventory-detail.services-aren-t-stocked">{"Services aren't stocked."}</T></p>
        </Section>
      ) : (
        <Section
          title={i.list === "bar"
            ? <T id="inventory-detail.inventory-detail.stock">Stock</T>
            : <T id="inventory-detail.inventory-detail.stock-by-location">Stock by location</T>}
          action={
            !i.archivedAt && (
              <div className="page-actions">
                <Allowed action="inventory.move" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("movement")}
                  >
                    <PackagePlus size={14} />
                    <T id="inventory-detail.inventory-detail.record-movement">Record movement</T>
                  </Button>
                </Allowed>
                <Allowed action="inventory.count" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("count")}
                  >
                    <ClipboardCheck size={14} />
                    <T id="inventory-detail.inventory-detail.count">Count</T>
                  </Button>
                </Allowed>
                {i.list !== "bar" && <Allowed action="inventory.move" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("transfer")}
                  >
                    <ArrowLeftRight size={14} />
                    <T id="inventory-detail.inventory-detail.transfer">Transfer</T>
                  </Button>
                </Allowed>}
              </div>
            )
          }
        >
          {/* On hand per location (FLOW-291); bar items show only the total. */}
          <table className="stock-table">
            <thead>
              <tr>
                <th>{i.list === "kitchen"
                  ? <T id="inventory-detail.inventory-detail.storage-area">Storage area</T>
                  : i.list === "bar" ? null : <T id="inventory-detail.inventory-detail.location">Location</T>}</th>
                <th><T id="inventory-detail.inventory-detail.quantity">Quantity</T></th>
              </tr>
            </thead>
            <tbody>
              {(i.list === "bar" ? [] : i.stock).map((level) => (
                <tr key={`${level.sectionId}:${level.color ?? ""}`}>
                  <td>
                    {level.sectionName}
                    {level.color
                      ? ` · ${level.color}`
                      : i.rental?.colors.length
                        ? <T id="inventory-detail.inventory-detail.unassigned-color">{" · Unassigned color"}</T>
                        : ""}
                  </td>
                  <td>{quantityLabel(level.quantity, i.unit)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row"><T id="inventory-detail.inventory-detail.total">Total</T></th>
                <td>
                  <strong>{quantityLabel(i.totalQuantity, i.unit)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
        </Block>
        <Block id="planning" name="Planning" w={12} h={12}>
          <ItemPlanning item={i} />
        </Block>
        {i.kind !== "service" && (
          <Block id="movement-history" name="Movement history" w={12} h={12}>
            <MovementHistory
              item={i}
              version={version}
              onCorrected={() => {
                item.reload();
                setVersion((current) => current + 1);
              }}
            />
          </Block>
        )}
        {c && !c.costHidden && (
          <Block id="cost-history" name="Cost history" w={12} h={10}>
            <CostHistory item={i} version={version} />
          </Block>
        )}
        <Block id="photos" name="Photos" w={12} h={10}>
          <Attachments recordType="inventory_item" recordId={i.id} title="Photos" />
        </Block>
        </PageGrid>
      </div>
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
        title={<T id="inventory-detail.inventory-detail.archive-this-item">Archive this item?</T>}
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
        <T id="inventory-detail.inventory-detail.will-be-hidden-from-inventory" values={{ name: i.name }}>{"{name} will be hidden from inventory lists."}</T>
      </ConfirmationDialog>
    </>
  );
}

// The task templates that match this service (FLOW-138): each is applied once
// when an event with the service starts planning (FLOW-213 AC2). The link is set
// on the template.
function ServiceTaskTemplates({ itemId }: { itemId: string }) {
  const templates = useResource(["tasks", "templates"], () => tasksApi.templates());
  const linked = templates.data?.filter((template) => template.matchCatalogId === itemId) ?? [];
  return (
    <Section title={<T id="inventory-detail.service-task-templates.task-templates">Task templates</T>}>
      {templates.error ? (
        <ErrorText message={templates.error} />
      ) : !templates.data ? (
        <LoadingSkeleton />
      ) : linked.length ? (
        <ul>
          {linked.map((template) => (
            <li key={template.id}>
              <Link to="/tasks/templates">{template.name}</Link><T id="inventory-detail.service-task-templates.applied-when-planning-starts">: applied when planning starts</T>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          <T id="inventory-detail.service-task-templates.no-task-template-is-linked">{"No task template is linked. Link one from "}</T><Link to="/tasks/templates"><T id="inventory-detail.service-task-templates.task-templates">Task templates</T></Link>.
        </p>
      )}
    </Section>
  );
}

function IncludedItems({ item }: { item: InventoryItem }) {
  const items = useResource(["inventory-items", "all"], () => allPages((cursor) => inventoryApi.list({}, cursor)));
  const lines = item.rental?.components ?? item.service?.includes ?? [];
  return (
    <Section title={item.service ? <T id="inventory-detail.included-items.includes">Includes</T> : <T id="inventory-detail.included-items.kit-components">Kit components</T>}>
      {items.error ? (
        <ErrorText message={items.error} />
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
                ? <> <LabelT id="labels.ratio-basis" value={String(line.basis)}>{ratioBasisLabels[line.basis as "per_guest" | "per_event"]}</LabelT></>
                : <T id="inventory-detail.included-items.per-kit">{" per kit"}</T>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
