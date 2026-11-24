import { Dropdown } from "../../components/ui/Dropdown";
import { useState } from "react";
import {
  movementDirection,
  movementTypeLabels,
  sectionKindFor,
  type InventoryItem,
  type MovementInput,
  type StockMovement,
} from "../../../shared/inventory";
import { unitLabel } from "../../../shared/units";
import { inventoryApi, inventoryChangesApi, sectionsApi } from "../../services/core";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
import { FormField, FormDrawer } from "../../components/shared";
import { toNumber } from "./inventory-item-input";
import { changeLabel, dateTimeLabel } from "./inventory-labels";
import { T, LabelT } from "../../app/copy";

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
  const kind = sectionKindFor(item) ?? "location";
  const sections = useResource(
    ["sections", { kind }],
    () => sectionsApi.list({ kind }),
    { reference: true },
  );
  const [picked, setFrom] = useState(item.stock[0]?.sectionId ?? "");
  // Bar stock has no location on screen (FLOW-291): it's recorded where the item
  // already is, or at the first location.
  const barItem = item.list === "bar";
  const from = picked || (barItem ? sections.data?.[0]?.id ?? "" : "");
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
      return setError("Pick the locations.");
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
    <FormDrawer
      onClose={onClose}
      title={mode === "transfer" ? <T id="inventory-stock-forms.stock-form.transfer-stock">Transfer stock</T> : <T id="inventory-stock-forms.stock-form.count-stock">Count stock</T>}
      description={
        mode === "transfer"
          ? <T id="inventory-stock-forms.stock-form.moves-stock-between-locations-and">Moves stock between locations and records a transfer.</T>
          : <T id="inventory-stock-forms.stock-form.records-what-you-counted-at">Records what you counted; the difference is saved as a count movement.</T>
      }
      onSubmit={save}
      error={error}
      saving={saving}
      saveLabel={<>{mode === "transfer" ? <T id="inventory-stock-forms.stock-form.transfer">Transfer</T> : mode === "count" && item.kind === "rental" && !can("rentals.apply_directly")
              ? <T id="inventory-stock-forms.stock-form.submit-for-approval">Submit for approval</T> : <T id="inventory-stock-forms.stock-form.save-count">Save count</T>}</>}
      cancelLabel={<T id="inventory-stock-forms.stock-form.cancel">Cancel</T>}
    >
      {notice && <p role="status">{notice}</p>}
      {!barItem && <FormField label={mode === "transfer" ? <T id="inventory-stock-forms.stock-form.from-location">From location</T> : <T id="inventory-stock-forms.stock-form.location">Location</T>}>
        <Dropdown value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Pick a location</option>
          {options}
        </Dropdown>
      </FormField>}
      <ColorSelect item={item} value={color} onChange={setColor} />
      {mode === "transfer" && (
        <FormField label={<T id="inventory-stock-forms.stock-form.to-location">To location</T>}>
          <Dropdown value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Pick a location</option>
            {options}
          </Dropdown>
        </FormField>
      )}
      <FormField
        label={mode === "transfer" ? <T id="inventory-stock-forms.stock-form.quantity-unit" values={{ unit: unitLabel(item.unit) }}>{"Quantity ({unit})"}</T> : <T id="inventory-stock-forms.stock-form.counted-quantity-unit" values={{ unit: unitLabel(item.unit) }}>{"Counted quantity ({unit})"}</T>}
      >
        <input
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </FormField>
      <FormField label={<T id="inventory-stock-forms.stock-form.reason">Reason</T>}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </FormDrawer>
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
  const kind = sectionKindFor(item) ?? "location";
  const sections = useResource(
    ["sections", { kind }],
    () => sectionsApi.list({ kind }),
    { reference: true },
  );
  const [type, setType] =
    useState<(typeof handMovementTypes)[number]>("receive");
  const [picked, setSectionId] = useState(item.stock[0]?.sectionId ?? "");
  // Bar stock has no location on screen (FLOW-291), as in StockForm.
  const barItem = item.list === "bar";
  const sectionId = picked || (barItem ? sections.data?.[0]?.id ?? "" : "");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount) || amount === 0)
      return setError("Enter a quantity.");
    if (!sectionId) return setError("Pick a location.");
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
    <FormDrawer
      onClose={onClose}
      title={<T id="inventory-stock-forms.movement-form.record-movement">Record movement</T>}
      description={<T id="inventory-stock-forms.movement-form.adds-a-movement-to-the">Adds a movement to the stock ledger. Quantities are never edited directly.</T>}
      onSubmit={save}
      error={error}
      saving={saving}
      saveLabel={<T id="inventory-stock-forms.movement-form.record">Record</T>}
      cancelLabel={<T id="inventory-stock-forms.movement-form.cancel">Cancel</T>}
    >
      <FormField label={<T id="inventory-stock-forms.movement-form.type">Type</T>}>
        <Dropdown
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
        </Dropdown>
      </FormField>
      <ColorSelect item={item} value={color} onChange={setColor} />
      {!barItem && <FormField label={<T id="inventory-stock-forms.movement-form.location">Location</T>}>
        <Dropdown
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          <option value="">Pick a location</option>
          {(sections.data ?? []).map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </Dropdown>
      </FormField>}
      <FormField
        label={direction > 0 ? <T id="inventory-stock-forms.movement-form.quantity-in-unit" values={{ unit: unitLabel(item.unit) }}>{"Quantity in ({unit})"}</T> : direction < 0 ? <T id="inventory-stock-forms.movement-form.quantity-out-unit" values={{ unit: unitLabel(item.unit) }}>{"Quantity out ({unit})"}</T> : <T id="inventory-stock-forms.movement-form.change-unit" values={{ unit: unitLabel(item.unit) }}>{"Change ({unit})"}</T>}
        hint={
          direction === 0 ? <T id="inventory-stock-forms.movement-form.use-a-minus-sign-to">Use a minus sign to remove stock.</T> : undefined
        }
      >
        <input
          type="number"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </FormField>
      <FormField label={type === "adjust" ? <T id="inventory-stock-forms.movement-form.reason">Reason *</T> : <T id="inventory-stock-forms.movement-form.reason-2">Reason</T>}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </FormDrawer>
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
    <FormField label={<T id="inventory-stock-forms.color-select.color">Color</T>}>
      <Dropdown value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Unassigned color</option>
        {item.rental.colors.map((color) => (
          <option key={color}>{color}</option>
        ))}
      </Dropdown>
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
    <FormDrawer
      onClose={onClose}
      title={<T id="inventory-stock-forms.correction-form.correct-movement">Correct movement</T>}
      description={<T id="inventory-stock-forms.correction-form.of-in-on-the-difference" values={{ movementTypeLabels: <LabelT id="labels.movement-type" value={movement.type}>{movementTypeLabels[movement.type]}</LabelT>, changeLabel: changeLabel(current), unitLabel: unitLabel(item.unit), sectionName: movement.sectionName, createdAt: dateTimeLabel(movement.createdAt) }}>{"{movementTypeLabels} of {changeLabel} {unitLabel} in {sectionName} on {createdAt}. The difference is recorded as a new, linked movement."}</T>}
      onSubmit={save}
      error={error}
      saving={saving}
      saveLabel={<T id="inventory-stock-forms.correction-form.save-correction">Save correction</T>}
      cancelLabel={<T id="inventory-stock-forms.correction-form.cancel">Cancel</T>}
    >
      <FormField
        label={<T id="inventory-stock-forms.correction-form.should-have-been" values={{ unitLabel: unitLabel(item.unit) }}>{"Should have been ({unitLabel})"}</T>}
        hint={<T id="inventory-stock-forms.correction-form.signed-a-minus-sign-removes">Signed: a minus sign removes stock.</T>}
      >
        <input
          type="number"
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </FormField>
      <FormField label={<T id="inventory-stock-forms.correction-form.reason">Reason *</T>}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </FormDrawer>
  );
}
