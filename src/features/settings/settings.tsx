import { Dropdown } from "../../components/ui/Dropdown";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { usePermissions } from "../../app/permissions";
import { useResource } from "../../app/useResource";
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
} from "../../../shared/settings";
import { ratioBasisLabels, ratioBasisSchema } from "../../../shared/inventory";
import { notificationCatalog, notificationTypes } from "../../../shared/notifications";
import { settingsApi, useBusinessSettings } from "../../services/settings";
import {
  Button,
  EmptyState,
  FormField,
  PageHeader,
  Section,
  ErrorText,
} from "../../components/shared";
import { TimeTrackingSettings } from "../staff/time-tracking";
import { dateTimeLabel } from "../inventory/inventory-labels";
import "./settings.css";
import { RoundCheck } from "../../components/ui/round-check";
import { T, useCopy } from "../../app/copy";

// Settings (FLOW-45). Everyone sees how time tracking works; Admin also edits the
// company profile, the defaults and the configurable lists. Every change is audited.
export function SettingsPage() {
  const permissions = usePermissions();
  const manage = permissions.can("settings.manage");
  return (
    <>
      <PageHeader pageKey="settings.page"
        title={<T id="settings.settings-page.settings">Settings</T>}
        subtitle={
          manage
            ? <T id="settings.settings-page.how-flowbase-works-for-the">How Flowbase works for the business. Changes apply without a deploy.</T>
            : <T id="settings.settings-page.how-flowbase-works-for-you">How Flowbase works for you.</T>
        }
      />
      <PageGrid pageKey="settings.page">
      {permissions.can("users.manage") && (
        <Block id="staff-access" name="Staff access" h={4}>
        <Section title={<T id="settings.settings-page.staff-access">Staff access</T>}>
          <p>
            <Link to="/settings/users"><T id="settings.settings-page.manage-users">Manage users</T></Link> ·{" "}
            <Link to="/settings/permissions"><T id="settings.settings-page.roles-permissions">Roles & permissions</T></Link> ·{" "}
            <Link to="/staff"><T id="settings.settings-page.staff-directory">Staff directory</T></Link>
          </p>
        </Section>
        </Block>
      )}
      {manage && (
        <Block id="deleted-records" name="Deleted records" h={5}>
        <Section title={<T id="settings.settings-page.deleted-records">Deleted records</T>}>
          <p><Link to="/settings/archived"><T id="settings.settings-page.archived">Archived: restore deleted records</T></Link></p>
          <p><Link to="/settings/inventory-categories"><T id="settings.settings-page.inventory-categories">Inventory categories</T></Link></p>
          <p><Link to="/settings/locations"><T id="settings.settings-page.locations">Locations</T></Link></p>
          {/* Admin only (FLOW-290): the matrix can grant settings.manage, not imports.run. */}
          {permissions.can("imports.run") && <p><Link to="/settings/imports"><T id="settings.settings-page.imports">Imports</T></Link></p>}
        </Section>
        </Block>
      )}
      {manage && <Block id="company" name="Company" h={14}><CompanySettings /></Block>}
      {manage && <Block id="lists" name="Lists" h={20}><ListSettings /></Block>}
      {manage && <Block id="defaults" name="Defaults" h={16}><DefaultSettings /></Block>}
      {manage && <Block id="history" name="History" h={12}><SettingsHistory /></Block>}
      <Block id="time-tracking" name="Time tracking" h={8}><TimeTrackingSettings /></Block>
      </PageGrid>
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
      <ErrorText message={error} />
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
    <Section title={<T id="settings.company-settings.company-profile">Company profile</T>}>
      <p className="settings-hint"><T id="settings.company-settings.shown-at-the-top-of">Shown at the top of printed documents.</T></p>
      <form className="settings-form" noValidate onSubmit={(e) => void submit(e)}>
        <SaveMessages error={save.error} notice={save.notice} />
        <div className="form-grid">
          <FormField label={<T id="settings.company-settings.company-name">Company name *</T>}>
            <input
              value={draft.name}
              maxLength={200}
              onChange={(e) => set("name", e.target.value)}
            />
          </FormField>
          <FormField label={<T id="settings.company-settings.website">Website</T>}>
            <input
              value={draft.website}
              maxLength={200}
              onChange={(e) => set("website", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label={<T id="settings.company-settings.sales-contact">Sales contact</T>} hint={<T id="settings.company-settings.e-g-sales-sales-phone">e.g. Sales · sales@… · phone</T>}>
          <textarea
            rows={2}
            value={draft.salesContact}
            maxLength={500}
            onChange={(e) => set("salesContact", e.target.value)}
          />
        </FormField>
        <FormField label={<T id="settings.company-settings.logo">Logo</T>} hint={<T id="settings.company-settings.png-jpeg-or-webp-resized">PNG, JPEG or WebP; resized before saving.</T>}>
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
              <T id="settings.company-settings.remove-logo">Remove logo</T>
            </Button>
          </div>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={save.busy}>
            <T id="settings.company-settings.save-company-profile">Save company profile</T>
          </Button>
        </div>
      </form>
    </Section>
  );
}

function ListSettings() {
  const newValuePlaceholder = useCopy("settings.list-settings.new-value.placeholder", "New value");
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
    <Section title={<T id="settings.list-settings.lists">Lists</T>}>
      <p className="settings-hint">
        <T id="settings.list-settings.the-choices-offered-in-forms">{"The choices offered in forms. Archived values stay on records that already use them but can't be picked for new ones. Inventory locations are managed on "}</T><Link to="/settings/locations"><T id="settings.list-settings.inventory-locations">Locations</T></Link><T id="settings.list-settings.bar-categories-are-built-in">; bar categories are built in.</T>
      </p>
      <SaveMessages error={save.error} notice={save.notice} />
      <FormField label={<T id="settings.list-settings.list">List</T>}>
        <Dropdown
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
        </Dropdown>
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
                  <T id="settings.list-settings.save">Save</T>
                </Button>
                <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                  <T id="settings.list-settings.cancel">Cancel</T>
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
                    <T id="settings.list-settings.rename">Rename</T>
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
                    <T id="settings.list-settings.archive">Archive</T>
                  </Button>
                </span>
              </>
            )}
          </li>
        ))}
        {!active.length && <li className="settings-empty"><T id="settings.list-settings.no-values-yet">No values yet.</T></li>}
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
          placeholder={newValuePlaceholder} data-copy-id="settings.list-settings.new-value.placeholder"
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" disabled={save.busy}>
          <T id="settings.list-settings.add">Add</T>
        </Button>
      </form>
      {archived.length > 0 && (
        <details className="settings-archived">
          <summary><T id="settings.list-settings.archived" values={{ archivedCount: archived.length }}>{"Archived ({archivedCount})"}</T></summary>
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
                  <T id="settings.list-settings.restore">Restore</T>
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
  | "beoKeyFields"
  | "rentalBufferDaysBefore"
  | "rentalBufferDaysAfter"
  | "monthlySmsCap"
  | "hideCompletedTasksAfterDays"
  | "idleCutoffMinutes"
  | "addendumReminderDays"
  | "paymentReminderDays"
  | "productionEscalationHours"
  | "beoApprovalDays"
  | "balanceWarningDays"
  | "runOfShowGuestThreshold"
  | "cleanupTemplate"
  | "ratioDefaults"
> & {
  beoKeyFields: string;
  rentalBufferDaysBefore: string;
  rentalBufferDaysAfter: string;
  monthlySmsCap: string;
  hideCompletedTasksAfterDays: string;
  idleCutoffMinutes: string;
  addendumReminderDays: string;
  paymentReminderDays: string;
  productionEscalationHours: string;
  beoApprovalDays: string;
  balanceWarningDays: string;
  runOfShowGuestThreshold: string;
  cleanupTemplate: string;
  ratioDefaults: { category: string; quantity: string; basis: string }[];
};
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
// One section per line: "Kitchen: wipe counters; empty fridge".
const templateText = (template: BusinessDefaults["cleanupTemplate"]) =>
  template.map((section) => `${section.section}: ${section.items.join("; ")}`).join("\n");
const templateOf = (value: string) =>
  lines(value).map((line) => {
    const at = line.indexOf(":");
    const name = at < 0 ? line : line.slice(0, at);
    const items = at < 0 ? "" : line.slice(at + 1);
    return {
      section: name.trim(),
      items: items
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean),
    };
  });
const draftOf = (defaults: BusinessDefaults): DefaultsDraft => ({
  ...defaults,
  beoKeyFields: defaults.beoKeyFields.join("\n"),
  rentalBufferDaysBefore: String(defaults.rentalBufferDaysBefore),
  rentalBufferDaysAfter: String(defaults.rentalBufferDaysAfter),
  monthlySmsCap: String(defaults.monthlySmsCap),
  hideCompletedTasksAfterDays: String(defaults.hideCompletedTasksAfterDays),
  idleCutoffMinutes: String(defaults.idleCutoffMinutes),
  addendumReminderDays: String(defaults.addendumReminderDays),
  paymentReminderDays: String(defaults.paymentReminderDays),
  productionEscalationHours: String(defaults.productionEscalationHours),
  beoApprovalDays: String(defaults.beoApprovalDays),
  balanceWarningDays: String(defaults.balanceWarningDays),
  runOfShowGuestThreshold: String(defaults.runOfShowGuestThreshold),
  cleanupTemplate: templateText(defaults.cleanupTemplate),
  ratioDefaults: defaults.ratioDefaults.map((row) => ({
    category: row.category,
    quantity: String(row.quantity),
    basis: row.basis,
  })),
});
const numberOf = (value: string) => (value.trim() === "" ? NaN : Number(value));

function DefaultSettings() {
  const categoryPlaceholder = useCopy("settings.default-settings.category.placeholder", "Category");
  const quantityPlaceholder = useCopy("settings.default-settings.quantity.placeholder", "Quantity");
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
      beoKeyFields: lines(draft.beoKeyFields),
      rentalBufferDaysBefore: numberOf(draft.rentalBufferDaysBefore),
      rentalBufferDaysAfter: numberOf(draft.rentalBufferDaysAfter),
      monthlySmsCap: numberOf(draft.monthlySmsCap),
      hideCompletedTasksAfterDays: numberOf(draft.hideCompletedTasksAfterDays),
      idleCutoffMinutes: numberOf(draft.idleCutoffMinutes),
      addendumReminderDays: numberOf(draft.addendumReminderDays),
      paymentReminderDays: numberOf(draft.paymentReminderDays),
      productionEscalationHours: numberOf(draft.productionEscalationHours),
      beoApprovalDays: numberOf(draft.beoApprovalDays),
      balanceWarningDays: numberOf(draft.balanceWarningDays),
      runOfShowGuestThreshold: numberOf(draft.runOfShowGuestThreshold),
      cleanupTemplate: templateOf(draft.cleanupTemplate),
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
    <Section title={<T id="settings.default-settings.defaults">Defaults</T>}>
      <form className="settings-form" noValidate onSubmit={(e) => void submit(e)}>
        <SaveMessages error={save.error} notice={save.notice} />
        <div className="form-grid">
          {number("rentalBufferDaysBefore", "Rental buffer days before", "Days a rental is held before its event.")}
          {number("rentalBufferDaysAfter", "Rental buffer days after", "Days a rental is held after its event.")}
          {number("monthlySmsCap", "Monthly SMS cap", "Texts sent per calendar month; 0 sends none.")}
          {number("hideCompletedTasksAfterDays", "Hide completed tasks after N days", "Completed tasks stay on the dashboard for this many days, from 0 to 90.")}
          {number("idleCutoffMinutes", "Time tracking idle cutoff (minutes)", "Time stops after this long without typing or clicking.", 1)}
          {number("addendumReminderDays", "Addendum reminder days", "Remind the salesperson when an addendum remains unsigned.", 1)}
          {number("paymentReminderDays", "Payment reminder days", "Days before a payment is due that the assigned salesperson is reminded.")}
          {number("productionEscalationHours", "Production escalation hours", "Hours before an unaddressed production alert reaches the Sales Manager.", 1)}
          {number("beoApprovalDays", "BEO approval warning days")}
          {number("balanceWarningDays", "Balance warning days")}
          {number("runOfShowGuestThreshold", "Run of show guest threshold", "Events at or above this guest count get a run of show on the BEO.", 1)}
        </div>
        <fieldset className="settings-urgent"><legend><T id="settings.default-settings.readiness-checks-start-days-before">Readiness checks start (days before event)</T></legend>
          {(Object.keys(draft.readinessStartDays) as (keyof BusinessDefaults["readinessStartDays"])[]).map((kind) =>
            <FormField key={kind} label={kind.replace("_", " ")}><input type="number" min="0" max="30" value={draft.readinessStartDays[kind]}
              onChange={(event) => set("readinessStartDays", { ...draft.readinessStartDays, [kind]: Number(event.target.value) })} /></FormField>)}
        </fieldset>
        <FormField label={<T id="settings.default-settings.default-payment-terms">Default payment terms</T>}>
          <textarea
            rows={3}
            maxLength={2000}
            value={draft.paymentTerms}
            onChange={(e) => set("paymentTerms", e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <fieldset className="settings-urgent">
            <legend><T id="settings.default-settings.urgent-notification-types-sms">Urgent notification types (SMS)</T></legend>
            <p className="settings-hint"><T id="settings.default-settings.recorded-in-the-sms-outbox">Recorded in the SMS outbox for staff who opted in. No text is sent by the stub provider.</T></p>
            {notificationTypes.map((type) => (
              <label key={type}>
                <RoundCheck
                  checked={draft.urgentNotificationTypes.includes(type)}
                  onChange={(e) =>
                    set(
                      "urgentNotificationTypes",
                      e.target.checked
                        ? [...draft.urgentNotificationTypes, type]
                        : draft.urgentNotificationTypes.filter((t) => t !== type),
                    )
                  }
                />
                {notificationCatalog[type].label}
              </label>
            ))}
          </fieldset>
          <FormField label={<T id="settings.default-settings.beo-key-fields">BEO key fields</T>} hint={<T id="settings.default-settings.one-field-key-per-line">One field key per line (date_time, location, guest_count, menu, dress_code, staff_roster, timeline, equipment). A change to one sends an approved BEO back for approval.</T>}>
            <textarea
              rows={3}
              value={draft.beoKeyFields}
              onChange={(e) => set("beoKeyFields", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label={<T id="settings.default-settings.beo-cleanup-checklist-template">BEO cleanup checklist template</T>} hint={<T id="settings.default-settings.one-section-per-line-items">One section per line, items separated by semicolons (Kitchen: wipe counters; empty fridge). Copied into each new BEO.</T>}>
          <textarea
            rows={5}
            value={draft.cleanupTemplate}
            onChange={(e) => set("cleanupTemplate", e.target.value)}
          />
        </FormField>
        <fieldset className="settings-ratios">
          <legend><T id="settings.default-settings.per-guest-ratio-defaults-by">Per-guest ratio defaults by category</T></legend>
          <p className="settings-hint"><T id="settings.default-settings.a-new-inventory-item-in">A new inventory item in the category starts with this ratio.</T></p>
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
                placeholder={categoryPlaceholder} data-copy-id="settings.default-settings.category.placeholder"
                value={row.category}
                onChange={(e) => setRatio(index, "category", e.target.value)}
              />
              <input
                aria-label={`Ratio ${index + 1} quantity`}
                type="number"
                min={0}
                step="any"
                placeholder={quantityPlaceholder} data-copy-id="settings.default-settings.quantity.placeholder"
                value={row.quantity}
                onChange={(e) => setRatio(index, "quantity", e.target.value)}
              />
              <Dropdown
                aria-label={`Ratio ${index + 1} basis`}
                value={row.basis}
                onChange={(e) => setRatio(index, "basis", e.target.value)}
              >
                {ratioBasisSchema.options.map((basis) => (
                  <option key={basis} value={basis}>
                    {ratioBasisLabels[basis]}
                  </option>
                ))}
              </Dropdown>
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
                <T id="settings.default-settings.remove">Remove</T>
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
            <T id="settings.default-settings.add-ratio-default">Add ratio default</T>
          </Button>
        </fieldset>
        <div className="form-actions">
          <Button type="submit" disabled={save.busy}>
            <T id="settings.default-settings.save-defaults">Save defaults</T>
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
  const history = useResource(
    ["settings-history", settings],
    () => settingsApi.history(),
    // Refetched after each save; the previous entries stay until it arrives.
    { keepPrevious: true },
  );
  return (
    <Section title={<T id="settings.settings-history.recent-changes">Recent changes</T>}>
      {history.error && <p role="alert"><T id="settings.settings-history.unable-to-load-the-change">Unable to load the change history.</T></p>}
      {history.data?.length === 0 && (
        <EmptyState
          title={<T id="settings.settings-history.no-changes-yet">No changes yet</T>}
          description={<T id="settings.settings-history.changes-to-settings-and-lists">Changes to settings and lists show here.</T>}
        />
      )}
      <ul className="settings-history">
        {history.data?.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.subject}</strong> · {entry.action} ·{" "}
            {entry.actorName ?? <T id="settings.settings-history.system">System</T>} · {dateTimeLabel(entry.at)}
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
