import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import {
  businessDefaultsSchema,
  companyProfileSchema,
  listKeys,
  listLabels,
  MAX_LOGO_LENGTH,
  type BusinessDefaults,
  type CompanyProfile,
  type ListKey,
  type ListValue,
} from "../../shared/settings";
import { ratioBasisLabels, ratioBasisSchema } from "../../shared/inventory";
import { settingsApi, useBusinessSettings } from "../services/settings";
import {
  Button,
  EmptyState,
  FormField,
  PageHeader,
  Section,
} from "../components/shared";
import { TimeTrackingSettings } from "./time-tracking";
import { dateTimeLabel } from "./inventory-labels";
import "./settings.css";

// Settings (FLOW-45). Everyone sees how time tracking works; Admin also edits the
// company profile, the defaults and the configurable lists. Every change is audited.
export function SettingsPage() {
  const permissions = usePermissions();
  const manage = permissions.can("settings.manage");
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          manage
            ? "How Flowbase works for the business. Changes apply without a deploy."
            : "How Flowbase works for you."
        }
      />
      {permissions.can("users.manage") && (
        <Section title="Staff access">
          <p>
            <Link to="/settings/users">Manage users</Link> ·{" "}
            <Link to="/staff">Staff directory</Link>
          </p>
        </Section>
      )}
      {manage && (
        <>
          <CompanySettings />
          <ListSettings />
          <DefaultSettings />
          <SettingsHistory />
        </>
      )}
      <TimeTrackingSettings />
    </>
  );
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to save. Please retry.";

function useSaveState() {
  const [state, setState] = useState<{
    busy: boolean;
    error: string;
    notice: string;
  }>({ busy: false, error: "", notice: "" });
  const run = async (work: () => Promise<unknown>, notice: string) => {
    setState({ busy: true, error: "", notice: "" });
    try {
      await work();
      setState({ busy: false, error: "", notice });
      return true;
    } catch (error) {
      setState({ busy: false, error: messageOf(error), notice: "" });
      return false;
    }
  };
  return { ...state, run, fail: (error: string) => setState({ busy: false, error, notice: "" }) };
}

function SaveMessages({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}

// Reads an image file, scales it to fit 600 × 240 and re-encodes it, so only a
// small PNG (or JPEG, when that's smaller) is stored.
async function resizeLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 600 / image.width, 240 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_LOGO_LENGTH) return png;
    const jpeg = canvas.toDataURL("image/jpeg", 0.85);
    if (jpeg.length <= MAX_LOGO_LENGTH) return jpeg;
    throw new Error("This logo is too detailed to store. Try a simpler image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CompanySettings() {
  const settings = useBusinessSettings();
  const [draft, setDraft] = useState<CompanyProfile>(settings.company);
  useEffect(() => setDraft(settings.company), [settings.company]);
  const save = useSaveState();
  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = companyProfileSchema.safeParse(draft);
    if (!parsed.success) return save.fail(parsed.error.issues[0].message);
    await save.run(() => settingsApi.saveCompany(parsed.data), "Company profile saved.");
  };
  return (
    <Section title="Company profile">
      <p className="settings-hint">Shown at the top of printed documents.</p>
      <form className="settings-form" noValidate onSubmit={(e) => void submit(e)}>
        <SaveMessages error={save.error} notice={save.notice} />
        <div className="form-grid">
          <FormField label="Company name *">
            <input
              value={draft.name}
              maxLength={200}
              onChange={(e) => set("name", e.target.value)}
            />
          </FormField>
          <FormField label="Website">
            <input
              value={draft.website}
              maxLength={200}
              onChange={(e) => set("website", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Sales contact" hint="e.g. Sales · sales@… · phone">
          <textarea
            rows={2}
            value={draft.salesContact}
            maxLength={500}
            onChange={(e) => set("salesContact", e.target.value)}
          />
        </FormField>
        <FormField label="Logo" hint="PNG, JPEG or WebP; resized before saving.">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              resizeLogo(file).then(
                (logo) => set("logo", logo),
                (error) => save.fail(messageOf(error)),
              );
            }}
          />
        </FormField>
        {draft.logo && (
          <div className="settings-logo">
            <img src={draft.logo} alt="Logo preview" />
            <Button type="button" variant="outline" onClick={() => set("logo", null)}>
              Remove logo
            </Button>
          </div>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={save.busy}>
            Save company profile
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ListSettings() {
  const settings = useBusinessSettings();
  const [key, setKey] = useState<ListKey>("staff_position");
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const save = useSaveState();
  const values = settings.lists[key] ?? [];
  const active = values.filter((value) => !value.archived);
  const archived = values.filter((value) => value.archived);
  const move = (value: ListValue, by: -1 | 1) => {
    const ids = active.map((item) => item.id);
    const from = ids.indexOf(value.id);
    const to = from + by;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void save.run(
      () => settingsApi.order(key, [...ids, ...archived.map((item) => item.id)]),
      "Order saved.",
    );
  };
  return (
    <Section title="Lists">
      <p className="settings-hint">
        The choices offered in forms. Archived values stay on records that
        already use them but can't be picked for new ones. Inventory sections
        are managed on <Link to="/inventory/sections">Inventory sections</Link>;
        bar categories are built in.
      </p>
      <SaveMessages error={save.error} notice={save.notice} />
      <FormField label="List">
        <select
          value={key}
          onChange={(e) => {
            setKey(e.target.value as ListKey);
            setRenaming(null);
          }}
        >
          {listKeys.map((option) => (
            <option key={option} value={option}>
              {listLabels[option]}
            </option>
          ))}
        </select>
      </FormField>
      <ul className="settings-list" aria-label={listLabels[key]}>
        {active.map((value, index) => (
          <li key={value.id}>
            {renaming?.id === value.id ? (
              <form
                className="settings-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save
                    .run(() => settingsApi.renameValue(value.id, renaming.label), "Renamed.")
                    .then((ok) => ok && setRenaming(null));
                }}
              >
                <input
                  aria-label={`New name for ${value.label}`}
                  value={renaming.label}
                  maxLength={100}
                  autoFocus
                  onChange={(e) => setRenaming({ id: value.id, label: e.target.value })}
                />
                <Button type="submit" disabled={save.busy}>
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span>{value.label}</span>
                <span className="settings-actions">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Move ${value.label} up`}
                    disabled={save.busy || index === 0}
                    onClick={() => move(value, -1)}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Move ${value.label} down`}
                    disabled={save.busy || index === active.length - 1}
                    onClick={() => move(value, 1)}
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={save.busy}
                    onClick={() => setRenaming({ id: value.id, label: value.label })}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="outline"
                    disabled={save.busy}
                    onClick={() =>
                      void save.run(
                        () => settingsApi.setArchived(value.id, true),
                        `${value.label} archived.`,
                      )
                    }
                  >
                    Archive
                  </Button>
                </span>
              </>
            )}
          </li>
        ))}
        {!active.length && <li className="settings-empty">No values yet.</li>}
      </ul>
      <form
        className="settings-inline"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return save.fail("Enter a value.");
          void save
            .run(() => settingsApi.addValue(key, label.trim()), `${label.trim()} added.`)
            .then((ok) => ok && setLabel(""));
        }}
      >
        <input
          aria-label={`Add to ${listLabels[key]}`}
          placeholder="New value"
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" disabled={save.busy}>
          Add
        </Button>
      </form>
      {archived.length > 0 && (
        <details className="settings-archived">
          <summary>Archived ({archived.length})</summary>
          <ul className="settings-list">
            {archived.map((value) => (
              <li key={value.id}>
                <span>{value.label}</span>
                <Button
                  variant="outline"
                  disabled={save.busy}
                  onClick={() =>
                    void save.run(
                      () => settingsApi.setArchived(value.id, false),
                      `${value.label} restored.`,
                    )
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

type DefaultsDraft = Omit<
  BusinessDefaults,
  | "urgentNotificationTypes"
  | "beoKeyFields"
  | "rentalBufferDaysBefore"
  | "rentalBufferDaysAfter"
  | "monthlySmsCap"
  | "idleCutoffMinutes"
  | "ratioDefaults"
> & {
  urgentNotificationTypes: string;
  beoKeyFields: string;
  rentalBufferDaysBefore: string;
  rentalBufferDaysAfter: string;
  monthlySmsCap: string;
  idleCutoffMinutes: string;
  ratioDefaults: { category: string; quantity: string; basis: string }[];
};
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const draftOf = (defaults: BusinessDefaults): DefaultsDraft => ({
  ...defaults,
  urgentNotificationTypes: defaults.urgentNotificationTypes.join("\n"),
  beoKeyFields: defaults.beoKeyFields.join("\n"),
  rentalBufferDaysBefore: String(defaults.rentalBufferDaysBefore),
  rentalBufferDaysAfter: String(defaults.rentalBufferDaysAfter),
  monthlySmsCap: String(defaults.monthlySmsCap),
  idleCutoffMinutes: String(defaults.idleCutoffMinutes),
  ratioDefaults: defaults.ratioDefaults.map((row) => ({
    category: row.category,
    quantity: String(row.quantity),
    basis: row.basis,
  })),
});
const numberOf = (value: string) => (value.trim() === "" ? NaN : Number(value));

function DefaultSettings() {
  const settings = useBusinessSettings();
  const [draft, setDraft] = useState(() => draftOf(settings.defaults));
  useEffect(() => setDraft(draftOf(settings.defaults)), [settings.defaults]);
  const save = useSaveState();
  const set = <K extends keyof DefaultsDraft>(key: K, value: DefaultsDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setRatio = (index: number, field: "category" | "quantity" | "basis", value: string) =>
    set(
      "ratioDefaults",
      draft.ratioDefaults.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  const categories = [
    ...new Set(
      (
        [
          "rental_category",
          "decor_category",
          "kitchen_equipment_category",
          "ingredient_category",
          "supply_category",
        ] as const
      ).flatMap((key) =>
        (settings.lists[key] ?? []).filter((v) => !v.archived).map((v) => v.label),
      ),
    ),
  ];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = businessDefaultsSchema.safeParse({
      ...draft,
      urgentNotificationTypes: lines(draft.urgentNotificationTypes),
      beoKeyFields: lines(draft.beoKeyFields),
      rentalBufferDaysBefore: numberOf(draft.rentalBufferDaysBefore),
      rentalBufferDaysAfter: numberOf(draft.rentalBufferDaysAfter),
      monthlySmsCap: numberOf(draft.monthlySmsCap),
      idleCutoffMinutes: numberOf(draft.idleCutoffMinutes),
      ratioDefaults: draft.ratioDefaults.map((row) => ({
        ...row,
        quantity: numberOf(row.quantity),
      })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return save.fail(
        issue.code === "invalid_type" || issue.code === "too_small" || issue.code === "too_big"
          ? `Check ${String(issue.path[0] ?? "the values")
              .replace(/([A-Z])/g, " $1")
              .toLowerCase()}: ${issue.message}`
          : issue.message,
      );
    }
    await save.run(() => settingsApi.saveDefaults(parsed.data), "Defaults saved.");
  };
  const number = (key: keyof DefaultsDraft, label: string, hint?: string, min = 0) => (
    <FormField label={label} hint={hint}>
      <input
        type="number"
        min={min}
        step={1}
        value={draft[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </FormField>
  );
  return (
    <Section title="Defaults">
      <form className="settings-form" noValidate onSubmit={(e) => void submit(e)}>
        <SaveMessages error={save.error} notice={save.notice} />
        <div className="form-grid">
          {number("rentalBufferDaysBefore", "Rental buffer days before", "Days a rental is held before its event.")}
          {number("rentalBufferDaysAfter", "Rental buffer days after", "Days a rental is held after its event.")}
          {number("monthlySmsCap", "Monthly SMS cap", "Texts sent per calendar month; 0 sends none.")}
          {number("idleCutoffMinutes", "Time tracking idle cutoff (minutes)", "Time stops after this long without typing or clicking.", 1)}
        </div>
        <FormField label="Default payment terms">
          <textarea
            rows={3}
            maxLength={2000}
            value={draft.paymentTerms}
            onChange={(e) => set("paymentTerms", e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <FormField label="Urgent notification types (SMS)" hint="One notification type per line.">
            <textarea
              rows={3}
              value={draft.urgentNotificationTypes}
              onChange={(e) => set("urgentNotificationTypes", e.target.value)}
            />
          </FormField>
          <FormField label="BEO key fields" hint="One field per line. A change to one sends an approved BEO back for approval.">
            <textarea
              rows={3}
              value={draft.beoKeyFields}
              onChange={(e) => set("beoKeyFields", e.target.value)}
            />
          </FormField>
        </div>
        <fieldset className="settings-ratios">
          <legend>Per-guest ratio defaults by category</legend>
          <p className="settings-hint">A new inventory item in the category starts with this ratio.</p>
          <datalist id="ratio-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          {draft.ratioDefaults.map((row, index) => (
            <div className="settings-inline" key={index}>
              <input
                aria-label={`Ratio ${index + 1} category`}
                list="ratio-categories"
                placeholder="Category"
                value={row.category}
                onChange={(e) => setRatio(index, "category", e.target.value)}
              />
              <input
                aria-label={`Ratio ${index + 1} quantity`}
                type="number"
                min={0}
                step="any"
                placeholder="Quantity"
                value={row.quantity}
                onChange={(e) => setRatio(index, "quantity", e.target.value)}
              />
              <select
                aria-label={`Ratio ${index + 1} basis`}
                value={row.basis}
                onChange={(e) => setRatio(index, "basis", e.target.value)}
              >
                {ratioBasisSchema.options.map((basis) => (
                  <option key={basis} value={basis}>
                    {ratioBasisLabels[basis]}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  set(
                    "ratioDefaults",
                    draft.ratioDefaults.filter((_, i) => i !== index),
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              set("ratioDefaults", [
                ...draft.ratioDefaults,
                { category: "", quantity: "", basis: "per_guest" },
              ])
            }
          >
            Add ratio default
          </Button>
        </fieldset>
        <div className="form-actions">
          <Button type="submit" disabled={save.busy}>
            Save defaults
          </Button>
        </div>
      </form>
    </Section>
  );
}

const describe = (value: unknown): string =>
  value === null || value === undefined || value === ""
    ? "—"
    : Array.isArray(value)
      ? value.length
        ? value.map(describe).join(", ")
        : "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

function SettingsHistory() {
  const settings = useBusinessSettings();
  // Reloads after each change, which republishes the settings.
  const history = useResource(() => settingsApi.history(), [settings]);
  return (
    <Section title="Recent changes">
      {history.error && <p role="alert">Unable to load the change history.</p>}
      {history.data?.length === 0 && (
        <EmptyState
          title="No changes yet"
          description="Changes to settings and lists show here."
        />
      )}
      <ul className="settings-history">
        {history.data?.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.subject}</strong> · {entry.action} ·{" "}
            {entry.actorName ?? "System"} · {dateTimeLabel(entry.at)}
            {entry.action !== "archive" && entry.action !== "restore" && (
              <ul>
                {Object.entries(entry.changes)
                  .filter(([field]) => field !== "key")
                  .map(([field, change]) => (
                    <li key={field}>
                      {field}: {describe(change.before)} →{" "}
                      {describe(change.after)}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
