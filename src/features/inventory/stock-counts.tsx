import { useState } from "react";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Dropdown } from "../../components/ui/Dropdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import {
  barCountStep,
  fitsCountStep,
  type CountLine,
  type SectionKind,
  type StockCount,
} from "../../../shared/inventory";
import { unitLabel } from "../../../shared/units";
import { countsApi, sectionsApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import {
  PageHeader,
  Button,
  ConfirmationDialog,
  LoadingSkeleton,
  ErrorText,
} from "../../components/shared";
import { changeLabel, dateTimeLabel, quantityLabel } from "./inventory";
import { T, useCopy, LabelT, joined } from "../../app/copy";
import "./stock-counts.css";

// Count mode (FLOW-82, FLOW-291): count a location (or kitchen storage) on a
// phone, item by item in shelf order. Each saved count writes a count movement for
// the difference, and an unfinished count can be resumed. Rentals are counted here
// only by people who can change Master inventory directly.
const subtypeLabels: Record<string, string> = {
  ingredient: "Ingredient",
  bar: "Bar",
  supply: "Supply",
};

// "Start stock count" on the Inventory and Bar Inventory tabs (FLOW-291): pick a
// location to count, or resume the count already open there.
export function StartCount({ kind = "location" }: { kind?: SectionKind }) {
  const navigate = useNavigate();
  const sections = useResource(
    ["sections", { kind }],
    () => sectionsApi.list({ kind }),
    { reference: true },
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
  return (
    <>
      <Dropdown
        variant="filter"
        aria-label="Start stock count"
        value=""
        options={[
          { value: "", label: <T id="stock-counts.start-count.start-stock-count">Start stock count</T>, text: "Start stock count" },
          ...(sections.data ?? []).map((section) => ({ value: section.id, label: section.name })),
        ]}
        onValueChange={(next) => next && void start(next)}
      />
      <ErrorText message={error} />
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
          <ErrorText message={error} />
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
    <Link to="/inventory" className="back-link">
      <T id="stock-counts.count-mode.all-inventory">← All inventory</T>
    </Link>
  );
  if (count.error)
    return (
      <>
        {back}
        <ErrorText message={count.error} />
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
      <PageHeader pageKey="inventory.count"
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
      <PageGrid pageKey="inventory.count">
      <Block id="progress" name="Count progress" h={3}>
      <p className="count-progress" role="status">
        <T id="stock-counts.count-mode.of-counted" values={{ counted, count: current.lines.length }}>{"{counted} of {count} counted"}</T>
      </p>
      </Block>
      <Block id="lines" name="Count lines" h={20}>
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
          <T id="stock-counts.count-mode.nothing-is-kept-at-this">{"Nothing is kept at this location yet. Stock an item here to count it."}</T>
        </p>
      )}
      </Block>
      </PageGrid>
      <ConfirmationDialog
        open={completing}
        onClose={() => setCompleting(false)}
        title={<T id="stock-counts.count-mode.finish-this-count">Finish this count?</T>}
        onConfirm={async () => {
          await countsApi.complete(current.id);
          setCompleting(false);
          navigate("/inventory");
        }}
      >
        {current.lines.length - counted > 0
          ? <T id="stock-counts.count-mode.items-weren-t-counted-their" values={{ value: current.lines.length - counted }}>{"{value} items weren't counted; their stock stays as it is."}</T>
          : <T id="stock-counts.count-mode.every-item-has-been-counted">Every item has been counted.</T>}
      </ConfirmationDialog>
    </>
  );
}
