import { useState } from "react";
import { Block, PageGrid } from "../app/page-grid";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  barCountStep,
  fitsCountStep,
  type CountLine,
  type InventoryItem,
  type StockCount,
} from "../../shared/inventory";
import { unitLabel } from "../../shared/units";
import { allPages, countsApi, inventoryApi, sectionsApi } from "../services/core";
import { useResource } from "../app/useResource";
import { LoadMore, usePagedList } from "../app/paging";
import {
  PageHeader,
  Button,
  DataTable,
  Section,
  ConfirmationDialog,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { changeLabel, dateTimeLabel, quantityLabel } from "./inventory";
import { T, useCopy, LabelT, joined } from "../app/copy";
import "./stock-counts.css";

// Count mode (FLOW-82): count a storage section on a phone, item by item in shelf
// order. Each saved count writes a count movement for the difference, and an
// unfinished count can be resumed. Rental counts stay on the item page.
const subtypeLabels: Record<string, string> = {
  ingredient: "Ingredient",
  bar: "Bar",
  supply: "Supply",
};

export function CountList() {
  const navigate = useNavigate();
  const sections = useResource(
    ["sections", { kind: "consumable" }],
    () => sectionsApi.list({ kind: "consumable" }),
    { reference: true },
  );
  // Every open count: at most one per section, so this stays small (FLOW-179).
  const open = useResource(
    ["counts", { status: "open" }, "all"],
    () => allPages((cursor) => countsApi.list({ status: "open" }, cursor)),
  );
  const [error, setError] = useState("");
  const start = async (sectionId: string) => {
    setError("");
    try {
      const count = await countsApi.start(sectionId);
      navigate(`/inventory/counts/${count.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const failed = sections.error ?? open.error;
  return (
    <>
      <Link to="/inventory" className="back-link">
        <T id="stock-counts.count-list.all-inventory">← All inventory</T>
      </Link>
      <PageHeader
        title={<T id="stock-counts.count-list.counts">Counts</T>}
        subtitle={<T id="stock-counts.count-list.count-a-storage-section-item">Count a storage section item by item. A count you leave part-way picks up where you stopped.</T>}
        eyebrow={<T id="stock-counts.count-list.stock-supplies">{"STOCK & SUPPLIES"}</T>}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <PageGrid pageKey="inventory.counts">
      <Block id="sections" name="Storage sections" h={20}>
      {failed ? (
        <LoadError message={failed} />
      ) : !sections.data || !open.data ? (
        <LoadingSkeleton />
      ) : (
        <Section title={<T id="stock-counts.count-list.storage-sections">Storage sections</T>}>
          <ul className="count-sections">
            {sections.data.map((section) => {
              const count = open.data?.find(
                (other) => other.sectionId === section.id,
              );
              return (
                <li key={section.id}>
                  <div>
                    <strong>{section.name}</strong>
                    {count && (
                      <small>
                        <T id="stock-counts.count-list.started-counted" values={{ startedAt: dateTimeLabel(count.startedAt), countedItems: count.countedItems }}>{"Started {startedAt}, {countedItems} counted"}</T>
                      </small>
                    )}
                  </div>
                  <Button
                    variant={count ? "default" : "outline"}
                    onClick={() => void start(section.id)}
                    aria-label={`${count ? "Resume" : "Start"} counting ${section.name}`}
                  >
                    <ClipboardCheck size={14} />
                    {count ? <T id="stock-counts.count-list.resume-count">Resume count</T> : <T id="stock-counts.count-list.start-count">Start count</T>}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      </Block>
      </PageGrid>
    </>
  );
}

function CountLineRow({
  count,
  line,
  autoFocus,
  onSaved,
}: {
  count: StockCount;
  line: CountLine;
  autoFocus: boolean;
  onSaved: (count: StockCount) => void;
}) {
  const optionalPlaceholder = useCopy("stock-counts.count-line-row.optional.placeholder", "Optional");
  const [quantity, setQuantity] = useState(
    line.counted ? String(line.counted.quantity) : "",
  );
  const [reason, setReason] = useState(line.counted?.reason ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editable = count.status === "open" && line.canCount;
  // Beer and wine count to the nearest 0.5, liquor to the nearest 0.25.
  const step = line.subtype === "bar" ? barCountStep(line.category) : null;
  const save = async () => {
    const amount = quantity.trim() === "" ? NaN : Number(quantity);
    if (Number.isNaN(amount) || amount < 0)
      return setError("Enter the quantity you counted.");
    if (!fitsCountStep(amount, step))
      return setError(`Round to the nearest ${step}.`);
    setSaving(true);
    setError("");
    try {
      onSaved(
        await countsApi.saveLine(count.id, {
          itemId: line.itemId,
          quantity: amount,
          reason,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const unit = unitLabel(line.unit);
  return (
    <li
      className={`count-line${line.counted ? " counted" : ""}`}
      aria-label={line.name}
    >
      <div className="count-line-heading">
        <strong>{line.name}</strong>
        <small>
          {joined([
            subtypeLabels[line.subtype ?? ""] && <LabelT id="labels.item-subtype" value={line.subtype ?? ""}>{subtypeLabels[line.subtype ?? ""]}</LabelT>,
            line.category,
            line.code,
          ])}
        </small>
        <small>
          <T id="stock-counts.count-line-row.in-system" values={{ quantityLabel: quantityLabel(line.systemQuantity, line.unit) }}>{"In system: {quantityLabel}"}</T>
          {line.parLevel !== null &&
            <T id="stock-counts.count-line-row.par" values={{ quantityLabel: quantityLabel(line.parLevel, line.unit) }}>{" · Par {quantityLabel}"}</T>}
          {line.belowPar && <span className="badge warning"><T id="stock-counts.count-line-row.below-par">Below par</T></span>}
        </small>
      </div>
      {line.counted && (
        <p className="count-result" role="status">
          <CheckCircle2 size={14} /><T id="stock-counts.count-line-row.counted" values={{ quantityLabel: quantityLabel(line.counted.quantity, line.unit), changeLabel: changeLabel(line.counted.difference) }}>{" Counted {quantityLabel} ({changeLabel})"}</T>
        </p>
      )}
      {editable ? (
        <form
          className="count-entry"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="form-field">
            <span><T id="stock-counts.count-line-row.counted-2" values={{ unit }}>{"Counted ({unit})"}</T></span>
            <input
              type="number"
              inputMode="decimal"
              step={step ?? "any"}
              min="0"
              value={quantity}
              autoFocus={autoFocus}
              onChange={(e) => setQuantity(e.target.value)}
            />
            {step && <small><T id="stock-counts.count-line-row.nearest" values={{ step }}>{"Nearest {step}"}</T></small>}
          </label>
          <label className="form-field">
            <span><T id="stock-counts.count-line-row.reason">Reason</T></span>
            <input
              value={reason}
              placeholder={optionalPlaceholder} data-copy-id="stock-counts.count-line-row.optional.placeholder"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={saving}
            aria-label={`Save count for ${line.name}`}
          >
            {line.counted ? <T id="stock-counts.count-line-row.recount">Recount</T> : <T id="stock-counts.count-line-row.save">Save</T>}
          </Button>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
        </form>
      ) : (
        count.status === "open" && (
          <p className="muted"><T id="stock-counts.count-line-row.you-can-t-count-this">{"You can't count this item."}</T></p>
        )
      )}
    </li>
  );
}

export function CountMode() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const count = useResource(
    ["counts", id],
    () => countsApi.get(id),
  );
  const [completing, setCompleting] = useState(false);
  const back = (
    <Link to="/inventory/counts" className="back-link">
      <T id="stock-counts.count-mode.all-counts">← All counts</T>
    </Link>
  );
  if (count.error)
    return (
      <>
        {back}
        <LoadError message={count.error} />
      </>
    );
  const current = count.data;
  if (!current) return <LoadingSkeleton />;
  const counted = current.lines.filter((line) => line.counted).length;
  // Resume where the count left off: the first item not yet counted.
  const next = current.lines.find((line) => !line.counted && line.canCount);
  return (
    <>
      {back}
      <PageHeader
        title={<T id="stock-counts.count-mode.count" values={{ sectionName: current.sectionName }}>{"Count: {sectionName}"}</T>}
        subtitle={
          current.status === "open"
            ? <T id="stock-counts.count-mode.type-what-s-on-the">{"Type what's on the shelf. Each save records the difference; you can stop and come back."}</T>
            : <T id="stock-counts.count-mode.completed" values={{ dateTimeLabel: dateTimeLabel(current.completedAt ?? current.startedAt) }}>{"Completed {dateTimeLabel}."}</T>
        }
        eyebrow={<T id="stock-counts.count-mode.count-mode">COUNT MODE</T>}
      >
        {current.status === "open" && (
          <Button variant="outline" onClick={() => setCompleting(true)}>
            <T id="stock-counts.count-mode.finish-count">Finish count</T>
          </Button>
        )}
      </PageHeader>
      <p className="count-progress" role="status">
        <T id="stock-counts.count-mode.of-counted" values={{ counted, count: current.lines.length }}>{"{counted} of {count} counted"}</T>
      </p>
      {current.lines.length ? (
        <ol className="count-lines">
          {current.lines.map((line) => (
            <CountLineRow
              key={`${line.itemId}-${line.counted?.countedAt ?? ""}`}
              count={current}
              line={line}
              autoFocus={line.itemId === next?.itemId}
              onSaved={count.replace}
            />
          ))}
        </ol>
      ) : (
        <p className="muted">
          <T id="stock-counts.count-mode.nothing-is-kept-in-this">{"Nothing is kept in this section yet. Set an item's storage section to count it here."}</T>
        </p>
      )}
      <ConfirmationDialog
        open={completing}
        onClose={() => setCompleting(false)}
        title={<T id="stock-counts.count-mode.finish-this-count">Finish this count?</T>}
        onConfirm={async () => {
          await countsApi.complete(current.id);
          setCompleting(false);
          navigate("/inventory/counts");
        }}
      >
        {current.lines.length - counted > 0
          ? <T id="stock-counts.count-mode.items-weren-t-counted-their" values={{ value: current.lines.length - counted }}>{"{value} items weren't counted; their stock stays as it is."}</T>
          : <T id="stock-counts.count-mode.every-item-has-been-counted">Every item has been counted.</T>}
      </ConfirmationDialog>
    </>
  );
}

// Consumables below par (FLOW-82): ingredients, bar stock and supplies.
export function LowStockList() {
  const navigate = useNavigate();
  const items = usePagedList(
    ["inventory-items", "below-par"],
    (cursor) => inventoryApi.list({ kind: "consumable", belowPar: true }, cursor),
  );
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item" },
    {
      id: "subtype",
      header: "Type",
      accessorFn: (item) => subtypeLabels[item.subtype ?? ""] ?? "",
      cell: ({ row }) => {
        const label = subtypeLabels[row.original.subtype ?? ""];
        return label ? <LabelT id="labels.item-subtype" value={row.original.subtype ?? ""}>{label}</LabelT> : "";
      },
    },
    {
      id: "onHand",
      header: "On hand",
      accessorFn: (item) => quantityLabel(item.totalQuantity, item.unit),
    },
    {
      id: "par",
      header: "Par",
      accessorFn: (item) =>
        quantityLabel(item.consumable?.parLevel ?? 0, item.unit),
    },
    {
      id: "short",
      header: "Short by",
      accessorFn: (item) =>
        quantityLabel(
          (item.consumable?.parLevel ?? 0) - item.totalQuantity,
          item.unit,
        ),
    },
    {
      id: "storage",
      header: "Storage",
      accessorFn: (item) => item.consumable?.storageSectionName ?? "—",
    },
    {
      id: "vendor",
      header: "Vendor",
      accessorFn: (item) => item.consumable?.preferredVendor || "—",
    },
  ];
  return (
    <>
      <Link to="/inventory" className="back-link">
        <T id="stock-counts.low-stock-list.all-inventory">← All inventory</T>
      </Link>
      <PageHeader
        title={<T id="stock-counts.low-stock-list.low-stock">Low stock</T>}
        subtitle={<T id="stock-counts.low-stock-list.ingredients-bar-stock-and-supplies">Ingredients, bar stock and supplies below their par level.</T>}
        eyebrow={<T id="stock-counts.low-stock-list.stock-supplies">{"STOCK & SUPPLIES"}</T>}
      >
        <Button variant="outline" asChild>
          <Link to="/inventory/counts">
            <ClipboardCheck size={16} />
            <T id="stock-counts.low-stock-list.counts">Counts</T>
          </Link>
        </Button>
      </PageHeader>
      {items.error ? (
        <LoadError message={items.error} />
      ) : !items.data ? (
        <LoadingSkeleton />
      ) : (
        <PageGrid pageKey="inventory.low-stock">
          <Block id="list" name="List" h={24}>
          <DataTable copyKey="stock-counts.low-stock-list"
            data={items.data}
            columns={columns}
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label={<T id="stock-counts.low-stock-list.items-below-par">items below par</T>}
            exportName="low stock"
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={<T id="stock-counts.low-stock-list.load-more-items">Load more items</T>} />
          </Block>
        </PageGrid>
      )}
    </>
  );
}
