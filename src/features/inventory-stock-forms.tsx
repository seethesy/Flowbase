import { useState } from "react";
import {
  movementDirection,
  movementTypeLabels,
  sectionKindFor,
  type InventoryItem,
  type MovementInput,
  type StockMovement,
} from "../../shared/inventory";
import { unitLabel } from "../../shared/units";
import { inventoryApi, inventoryChangesApi, sectionsApi } from "../services/core";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { Button, DetailDrawer, FormField } from "../components/shared";
import { toNumber } from "./inventory-item-form";
import { changeLabel, dateTimeLabel } from "./inventory-labels";

export function StockForm({
  item,
  mode,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  mode: "transfer" | "count";
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const kind = sectionKindFor(item.kind) ?? "rental";
  const sections = useResource(
    ["sections", { kind }],
    () => sectionsApi.list({ kind }),
    { reference: true },
  );
  const [from, setFrom] = useState(item.stock[0]?.sectionId ?? "");
  const [to, setTo] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { can } = usePermissions();
  const [saving, setSaving] = useState(false);
  const options = (sections.data ?? []).map((section) => (
    <option key={section.id} value={section.id}>
      {section.name}
    </option>
  ));
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount))
      return setError("Enter a quantity.");
    if (!from || (mode === "transfer" && !to))
      return setError("Pick the sections.");
    setSaving(true);
    setError("");
    try {
      if (mode === "count" && item.kind === "rental" && !can("rentals.apply_directly")) {
        if (color) throw new Error("Choose the uncolored stock quantity for a Master adjustment.");
        await inventoryChangesApi.submit([{ type: "quantity", itemId: item.id,
          sectionId: from, quantity: amount }]);
        setNotice("Quantity adjustment submitted for Admin approval.");
        return;
      }
      onSaved(
        mode === "transfer"
          ? await inventoryApi.transfer(item.id, {
              fromSectionId: from,
              color,
              toSectionId: to,
              quantity: amount,
              reason,
            })
          : await inventoryApi.count(item.id, {
              sectionId: from,
              color,
              quantity: amount,
              reason,
            }),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={mode === "transfer" ? "Transfer stock" : "Count stock"}
      description={
        mode === "transfer"
          ? "Moves stock between sections and records a transfer."
          : "Records what you counted in a section; the difference is saved as a count movement."
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <FormField label={mode === "transfer" ? "From section" : "Section"}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Pick a section</option>
            {options}
          </select>
        </FormField>
        <ColorSelect item={item} value={color} onChange={setColor} />
        {mode === "transfer" && (
          <FormField label="To section">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Pick a section</option>
              {options}
            </select>
          </FormField>
        )}
        <FormField
          label={`${mode === "transfer" ? "Quantity" : "Counted quantity"} (${unitLabel(item.unit)})`}
        >
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {mode === "transfer" ? "Transfer" : mode === "count" && item.kind === "rental" && !can("rentals.apply_directly")
              ? "Submit for approval" : "Save count"}
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

// Receipts, adjustments, damage or loss and usage entered by hand (FLOW-71). Pulls
// and returns come from the event pull list once it exists.
const handMovementTypes = [
  "receive",
  "adjust",
  "damage_loss",
  "consume",
] as const;

export function MovementForm({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const kind = sectionKindFor(item.kind) ?? "rental";
  const sections = useResource(
    ["sections", { kind }],
    () => sectionsApi.list({ kind }),
    { reference: true },
  );
  const [type, setType] =
    useState<(typeof handMovementTypes)[number]>("receive");
  const [sectionId, setSectionId] = useState(item.stock[0]?.sectionId ?? "");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount) || amount === 0)
      return setError("Enter a quantity.");
    if (!sectionId) return setError("Pick a section.");
    const input: MovementInput = {
      type,
      sectionId,
      color,
      quantity: amount,
      reason,
    };
    setSaving(true);
    setError("");
    try {
      onSaved(await inventoryApi.addMovement(item.id, input));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const direction = movementDirection[type];
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Record movement"
      description="Adds a movement to the stock ledger. Quantities are never edited directly."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label="Type">
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as (typeof handMovementTypes)[number])
            }
          >
            {handMovementTypes.map((option) => (
              <option key={option} value={option}>
                {movementTypeLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <ColorSelect item={item} value={color} onChange={setColor} />
        <FormField label="Section">
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">Pick a section</option>
            {(sections.data ?? []).map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label={`${direction > 0 ? "Quantity in" : direction < 0 ? "Quantity out" : "Change"} (${unitLabel(item.unit)})`}
          hint={
            direction === 0 ? "Use a minus sign to remove stock." : undefined
          }
        >
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label={type === "adjust" ? "Reason *" : "Reason"}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Record
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function ColorSelect({
  item,
  value,
  onChange,
}: {
  item: InventoryItem;
  value: string;
  onChange: (value: string) => void;
}) {
  if (!item.rental?.colors.length) return null;
  return (
    <FormField label="Color">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Unassigned color</option>
        {item.rental.colors.map((color) => (
          <option key={color}>{color}</option>
        ))}
      </select>
    </FormField>
  );
}

// FLOW-71 AC3: correcting a movement records the difference as a new movement linked
// to it; the original stays as it was.
export function CorrectionForm({
  item,
  movement,
  current,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  movement: StockMovement;
  // The movement plus its corrections so far.
  current: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState(String(current));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount))
      return setError("Enter what the movement should have been.");
    if (!reason.trim()) return setError("Give a reason for the correction.");
    setSaving(true);
    setError("");
    try {
      await inventoryApi.correct(movement.id, { quantity: amount, reason });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Correct movement"
      description={`${movementTypeLabels[movement.type]} of ${changeLabel(current)} ${unitLabel(item.unit)} in ${movement.sectionName} on ${dateTimeLabel(movement.createdAt)}. The difference is recorded as a new, linked movement.`}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField
          label={`Should have been (${unitLabel(item.unit)})`}
          hint="Signed: a minus sign removes stock."
        >
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label="Reason *">
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save correction
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
