import { Dropdown } from "../../components/ui/Dropdown";
import { useState } from "react";
import { isFtPlus } from "../../../shared/access";
import {
  ratioBasisLabels,
  ratioBasisSchema,
  type InventoryItem,
  type ItemKind,
  type Section as StockSection,
} from "../../../shared/inventory";
import { allPages, inventoryApi, inventoryChangesApi, sectionsApi } from "../../services/core";
import { StaleReload, isStale } from "../../components/stale-reload";
import { vendorsApi } from "../../services/vendors";
import { useResource } from "../../app/useResource";
import { FormField, ErrorText, FormDrawer } from "../../components/shared";
import { useShownFields } from "../../app/live-edit/field-card";
import { useBusinessSettings } from "../../services/settings";
import { usePermissions } from "../../app/permissions";
import { canSeeRentalCosts } from "../../../shared/visibility";
import { CatalogIncludes } from "./inventory-includes";
import { RoundCheck } from "../../components/ui/round-check";
import { T, LabelT } from "../../app/copy";
import { buildItemInput, initialItemFields, type FieldName, type ItemFields } from "./inventory-item-input";
import { FieldInput, type ItemFieldsProps } from "./inventory-item-form-parts";
import { ItemClassificationSection } from "./inventory-item-classification";
import { ItemRentalSection } from "./inventory-item-rental";
import { ItemServiceSection } from "./inventory-item-service";
import { ItemConsumableSection } from "./inventory-item-consumable";

type ItemFormProps = {
  item?: InventoryItem;
  preset?: { kind: ItemKind; subtype: string };
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
};

// Edits reload the current version when the save was made from a stale copy
// (FLOW-186).
export function ItemForm(props: ItemFormProps) {
  return (
    <StaleReload
      record={props.item}
      load={(id) => inventoryApi.get(id)}
      what="item"
    >
      {({ record, conflict, onStale }) => (
        <ItemFormFields
          key={record?.updatedAt ?? "new"}
          {...props}
          item={record}
          conflict={conflict}
          onStale={onStale}
        />
      )}
    </StaleReload>
  );
}

// The form's state and save. Each item kind's fields are a section component,
// and the API input is built by buildItemInput (FLOW-317).
function ItemFormFields({
  item,
  preset,
  onClose,
  onSaved,
  conflict,
  onStale,
}: ItemFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const shownFacts = useShownFields("inventory.detail", "item-facts");
  const shows = (field: string) => !item || shownFacts(field);
  const [kind, setKind] = useState<ItemKind>(
    item?.kind ?? preset?.kind ?? "rental",
  );
  const [subtype, setSubtype] = useState(
    item?.subtype ?? preset?.subtype ?? "equipment",
  );
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [typeId, setTypeId] = useState(item?.typeId ?? "");
  const [fields, setFields] = useState<ItemFields>(() => initialItemFields(item));
  // The item reordered when its tier runs short (FLOW-170).
  const [housePick, setHousePick] = useState(item?.bar?.housePick ?? false);
  // Allergens are set on dishes, not ingredients (FLOW-95); an item keeps any it
  // already has.
  const allergens = item?.consumable?.allergens ?? [];
  const [active, setActive] = useState(item?.active ?? true);
  const [quoted, setQuoted] = useState(item?.service?.pricedByQuote ?? false);
  const [includes, setIncludes] = useState(
    item?.service?.includes ??
      item?.rental?.components.map((line) => ({
        ...line,
        basis: "per_event" as const,
      })) ??
      [],
  );
  const [addons, setAddons] = useState(item?.service?.addons ?? []);
  const { actor, can } = usePermissions();
  const rentalCostsVisible = actor !== null && canSeeRentalCosts(actor);
  const priceNeedsApproval =
    Boolean(item) && !can("rentals.apply_directly");
  // An existing item whose cost came back hidden: the user isn't FT+, so the form
  // leaves the cost alone.
  const costHidden = item?.consumable?.costHidden ?? false;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  // Ingredients are kept in kitchen storage, everything else at a location
  // (FLOW-289).
  const storageKind = subtype === "ingredient" ? "storage" : "location";
  const storage = useResource(
    ["sections", kind === "consumable" ? { kind: storageKind } : "none"],
    () =>
      kind === "consumable"
        ? sectionsApi.list({ kind: storageKind })
        : Promise.resolve([] as StockSection[]),
    { reference: true },
  );
  // The vendor directory (FLOW-84), for sub-rentals and preferred vendors.
  const vendors = useResource(
    ["vendors", "options"],
    () => allPages((cursor) => vendorsApi.list({}, cursor)),
    { reference: true },
  );
  const vendorOptions = (vendors.data ?? []).filter(
    (vendor) =>
      vendor.id === fields.rentalVendorId ||
      vendor.id === fields.preferredVendorId ||
      !vendor.archivedAt,
  );
  const set = (key: FieldName) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const form: ItemFieldsProps = { fields, set, setFields };
  // Per-category ratio defaults (FLOW-45).
  const settings = useBusinessSettings();
  const defaultRatio = settings.defaults.ratioDefaults.find(
    (row) =>
      row.category.toLowerCase() === fields.category.trim().toLowerCase(),
  );
  const save = async () => {
    if (!fields.name.trim()) return setError("Name is required.");
    const payload = buildItemInput({
      kind, subtype, fields, categoryId, typeId, active, quoted, includes,
      addons, housePick, allergens, rentalCostsVisible, costHidden,
    });
    setSaving(true);
    setError("");
    try {
      if (kind !== "consumable" && !can("rentals.apply_directly")) {
        if (!actor || !isFtPlus(actor)) throw new Error("Only full-time staff can propose Master inventory changes.");
        await inventoryChangesApi.submit(item
          ? [{ type: "replace", itemId: item.id, item: payload }]
          : [{ type: "create", item: payload }]);
        setNotice("Submitted for Admin approval. The published item is unchanged until approval.");
        return;
      }
      onSaved(
        item
          ? await inventoryApi.update(item.id, {
              ...payload,
              updatedAt: item.updatedAt,
            })
          : await inventoryApi.create(payload),
      );
      onClose();
    } catch (e) {
      if (item && isStale(e)) {
        await onStale();
        return;
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDrawer
      onClose={onClose}
      title={
        item
          ? <T id="inventory-item-form.item-form-fields.edit-item">Edit item</T>
          : preset
            ? `New ${preset.subtype === "bar" ? "bar item" : preset.subtype}`
            : <T id="inventory-item-form.item-form-fields.new-item">New item</T>
      }
      description={<T id="inventory-item-form.item-form-fields.saved-to-flowbase">Saved to Flowbase.</T>}
      wide
      onSubmit={save}
      before={<ErrorText message={conflict} />}
      error={error}
      saving={saving}
      saveLabel={<>{kind !== "consumable" && !can("rentals.apply_directly") ? <T id="inventory-item-form.item-form-fields.submit-for-approval">Submit for approval</T> : <T id="inventory-item-form.item-form-fields.save-item">Save item</T>}</>}
      cancelLabel={<T id="inventory-item-form.item-form-fields.cancel">Cancel</T>}
    >
      {notice && <p role="status" className="success-message">{notice}</p>}
      <ItemClassificationSection
        form={form}
        editing={Boolean(item)}
        preset={Boolean(preset)}
        shows={shows}
        kind={kind}
        setKind={setKind}
        subtype={subtype}
        setSubtype={setSubtype}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        typeId={typeId}
        setTypeId={setTypeId}
        housePick={housePick}
        setHousePick={setHousePick}
      />
      {shows("description") && (<FormField label={<T id="inventory-item-form.item-form-fields.description">Description</T>}>
        <textarea
          rows={2}
          value={fields.description}
          onChange={(e) => set("description")(e.target.value)}
        />
      </FormField>)}
      <div className="form-grid">
        <FormField
          label={<T id="inventory-item-form.item-form-fields.ratio">Ratio</T>}
          hint={
            defaultRatio
              ? <T id="inventory-item-form.item-form-fields.leave-empty-to-use-category" values={{ quantity: defaultRatio.quantity, ratioBasisLabels: <LabelT id="labels.ratio-basis" value={defaultRatio.basis}>{ratioBasisLabels[defaultRatio.basis]}</LabelT> }}>{"Leave empty to use category default: {quantity} {ratioBasisLabels}"}</T>
              : <T id="inventory-item-form.item-form-fields.e-g-2-per-guest">e.g. 2 per guest; leave empty for category default</T>
          }
        >
          <FieldInput form={form} name="ratioQuantity" type="number" />
        </FormField>
        <FormField label={<T id="inventory-item-form.item-form-fields.ratio-basis">Ratio basis</T>}>
          <Dropdown
            value={fields.ratioBasis}
            onChange={(e) => set("ratioBasis")(e.target.value)}
          >
            {ratioBasisSchema.options.map((basis) => (
              <option key={basis} value={basis}>
                {ratioBasisLabels[basis]}
              </option>
            ))}
          </Dropdown>
        </FormField>
      </div>
      {kind === "rental" && (
        <ItemRentalSection
          form={form}
          priceNeedsApproval={priceNeedsApproval}
          rentalCostsVisible={rentalCostsVisible}
          vendorOptions={vendorOptions}
        />
      )}
      {kind === "service" && (
        <ItemServiceSection
          form={form}
          quoted={quoted}
          setQuoted={setQuoted}
          addons={addons}
          setAddons={setAddons}
        />
      )}
      {(kind === "service" || (kind === "rental" && subtype === "decor")) && (
        <CatalogIncludes
          itemId={item?.id}
          service={kind === "service"}
          value={includes}
          onChange={setIncludes}
        />
      )}
      {kind === "consumable" && (
        <ItemConsumableSection
          form={form}
          subtype={subtype}
          costHidden={costHidden}
          vendorOptions={vendorOptions}
          storage={storage.data ?? []}
        />
      )}
      <label className="checkbox-filter">
        <RoundCheck
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <T id="inventory-item-form.item-form-fields.active">Active</T>
      </label>
    </FormDrawer>
  );
}
