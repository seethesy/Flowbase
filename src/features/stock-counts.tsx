import { useState } from "react";
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
import { countsApi, inventoryApi, sectionsApi } from "../services/core";
import { useResource } from "../app/useResource";
import {
  PageHeader,
  Button,
  DataTable,
  Section,
  ConfirmationDialog,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "./clients";
import { changeLabel, dateTimeLabel, quantityLabel } from "./inventory";
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
    () => sectionsApi.list({ kind: "consumable" }),
    [],
  );
  const open = useResource(() => countsApi.list({ status: "open" }), []);
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
        ← All inventory
      </Link>
      <PageHeader
        title="Counts"
        subtitle="Count a storage section item by item. A count you leave part-way picks up where you stopped."
        eyebrow="STOCK & SUPPLIES"
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {failed ? (
        <LoadError message={failed} />
      ) : !sections.data || !open.data ? (
        <LoadingSkeleton />
      ) : (
        <Section title="Storage sections">
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
                        Started {dateTimeLabel(count.startedAt)},{" "}
                        {count.countedItems} counted
                      </small>
                    )}
                  </div>
                  <Button
                    variant={count ? "default" : "outline"}
                    onClick={() => void start(section.id)}
                    aria-label={`${count ? "Resume" : "Start"} counting ${section.name}`}
                  >
                    <ClipboardCheck size={14} />
                    {count ? "Resume count" : "Start count"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
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
          {[subtypeLabels[line.subtype ?? ""], line.category, line.code]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <small>
          In system: {quantityLabel(line.systemQuantity, line.unit)}
          {line.parLevel !== null &&
            ` · Par ${quantityLabel(line.parLevel, line.unit)}`}
          {line.belowPar && <span className="badge warning">Below par</span>}
        </small>
      </div>
      {line.counted && (
        <p className="count-result" role="status">
          <CheckCircle2 size={14} /> Counted{" "}
          {quantityLabel(line.counted.quantity, line.unit)} (
          {changeLabel(line.counted.difference)})
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
            <span>Counted ({unit})</span>
            <input
              type="number"
              inputMode="decimal"
              step={step ?? "any"}
              min="0"
              value={quantity}
              autoFocus={autoFocus}
              onChange={(e) => setQuantity(e.target.value)}
            />
            {step && <small>Nearest {step}</small>}
          </label>
          <label className="form-field">
            <span>Reason</span>
            <input
              value={reason}
              placeholder="Optional"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={saving}
            aria-label={`Save count for ${line.name}`}
          >
            {line.counted ? "Recount" : "Save"}
          </Button>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
        </form>
      ) : (
        count.status === "open" && (
          <p className="muted">You can't count this item.</p>
        )
      )}
    </li>
  );
}

export function CountMode() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const count = useResource(() => countsApi.get(id), [id]);
  const [completing, setCompleting] = useState(false);
  const back = (
    <Link to="/inventory/counts" className="back-link">
      ← All counts
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
        title={`Count: ${current.sectionName}`}
        subtitle={
          current.status === "open"
            ? "Type what's on the shelf. Each save records the difference; you can stop and come back."
            : `Completed ${dateTimeLabel(current.completedAt ?? current.startedAt)}.`
        }
        eyebrow="COUNT MODE"
      >
        {current.status === "open" && (
          <Button variant="outline" onClick={() => setCompleting(true)}>
            Finish count
          </Button>
        )}
      </PageHeader>
      <p className="count-progress" role="status">
        {counted} of {current.lines.length} counted
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
          Nothing is kept in this section yet. Set an item's storage section to
          count it here.
        </p>
      )}
      <ConfirmationDialog
        open={completing}
        onClose={() => setCompleting(false)}
        title="Finish this count?"
        onConfirm={async () => {
          await countsApi.complete(current.id);
          setCompleting(false);
          navigate("/inventory/counts");
        }}
      >
        {current.lines.length - counted > 0
          ? `${current.lines.length - counted} items weren't counted; their stock stays as it is.`
          : "Every item has been counted."}
      </ConfirmationDialog>
    </>
  );
}

// Consumables below par (FLOW-82): ingredients, bar stock and supplies.
export function LowStockList() {
  const navigate = useNavigate();
  const items = useResource(
    () => inventoryApi.list({ kind: "consumable", belowPar: true }),
    [],
  );
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item" },
    {
      id: "subtype",
      header: "Type",
      accessorFn: (item) => subtypeLabels[item.subtype ?? ""] ?? "",
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
        ← All inventory
      </Link>
      <PageHeader
        title="Low stock"
        subtitle="Ingredients, bar stock and supplies below their par level."
        eyebrow="STOCK & SUPPLIES"
      >
        <Button variant="outline" asChild>
          <Link to="/inventory/counts">
            <ClipboardCheck size={16} />
            Counts
          </Link>
        </Button>
      </PageHeader>
      {items.error ? (
        <LoadError message={items.error} />
      ) : !items.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={items.data}
          columns={columns}
          onRow={(item) => navigate(`/inventory/${item.id}`)}
          label="items below par"
          exportName="low stock"
        />
      )}
    </>
  );
}
