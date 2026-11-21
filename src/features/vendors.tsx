import { useDeletable } from "../app/deletable";
import { Dropdown } from "../components/ui/Dropdown";
import { Allowed } from "../app/permissions";
import { Block, PageGrid } from "../app/page-grid";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Pencil, Archive, RotateCcw, ExternalLink } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  vendorTypeLabels,
  vendorTypeSchema,
  weekdayLabels,
  weekdaySchema,
  type Vendor,
  type VendorContactInput,
  type VendorDetail as VendorRecord,
  type VendorInput,
  type VendorType,
  type Weekday,
} from "../../shared/vendors";
import { vendorsApi } from "../services/vendors";
import { useResource } from "../app/useResource";
import { useOpenFor } from "../app/useOpenFor";
import { LoadMore, useDebounced, usePagedList } from "../app/paging";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  Section,
  ConfirmationDialog,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { centsLabel, kindLabels, subtypeLabel } from "./inventory-labels";
import "./vendors.css";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy, LabelT, joined } from "../app/copy";

const daysLabel = (days: Weekday[]) =>
  days.map((day) => weekdayLabels[day]).join(", ") || "—";
// daysLabel on screen, with the weekday names editable (FLOW-257).
const DaysText = ({ days }: { days: Weekday[] }) =>
  days.length ? <>{joined(days.map((day) => <LabelT id="labels.weekday" value={day}>{weekdayLabels[day]}</LabelT>), ", ")}</> : <>—</>;
const leadTimeLabel = (days: number | null) =>
  days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`;
const hiddenNote = "Visible to full-time staff only.";

// Vendor and distributor directory (FLOW-84): distributors, rental vendors and
// event partners, with how to order from each.
export function VendorList() {
  const searchVendorsPlaceholder = useCopy("vendors.vendor-list.search-vendors.placeholder", "Search vendors…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<VendorType | "">("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  const term = useDebounced(search.trim());
  const vendors = usePagedList(
    ["vendors", "list", archived, type, term],
    (cursor) =>
      vendorsApi.list(
        { archived, type: type || undefined, search: term || undefined },
        cursor,
      ),
  );
  const deletable = useDeletable("vendor", () => vendors.reload());
  const data = vendors.data ?? [];
  const columns: ColumnDef<Vendor, unknown>[] = [
    { accessorKey: "name", header: "Vendor" },
    {
      id: "type",
      header: "Type",
      accessorFn: (vendor) => vendorTypeLabels[vendor.type],
      cell: ({ row }) => <LabelT id="labels.vendor-type" value={row.original.type}>{vendorTypeLabels[row.original.type]}</LabelT>,
    },
    {
      id: "deliveryDays",
      header: "Delivery days",
      accessorFn: (vendor) => daysLabel(vendor.deliveryDays),
      cell: ({ row }) => <DaysText days={row.original.deliveryDays} />,
    },
    {
      id: "orderCutoff",
      header: "Order cutoff",
      accessorFn: (vendor) => vendor.orderCutoff || "—",
    },
    {
      id: "leadTime",
      header: "Lead time",
      accessorFn: (vendor) => leadTimeLabel(vendor.leadTimeDays),
    },
  ];
  return (
    <>
      <PageHeader
        title={<T id="vendors.vendor-list.vendors">Vendors</T>}
        subtitle={<T id="vendors.vendor-list.distributors-rental-vendors-and-event">Distributors, rental vendors and event partners, and how to order from each.</T>}
        eyebrow={<T id="vendors.vendor-list.inventory">Inventory</T>}
      >
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="vendors.vendor-list.new-vendor">New Vendor</T>
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchVendorsPlaceholder} copyId="vendors.vendor-list.search-vendors.placeholder"
        />
        <Dropdown
          aria-label="Vendor type"
          value={type}
          onChange={(e) =>
            setType(e.target.value ? vendorTypeSchema.parse(e.target.value) : "")
          }
        >
          <option value="">All types</option>
          {vendorTypeSchema.options.map((option) => (
            <option key={option} value={option}>
              {vendorTypeLabels[option]}
            </option>
          ))}
        </Dropdown>
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="vendors.vendor-list.show-archived">Show archived</T>
        </label>
        <span className="result-count">
          {vendors.hasMore ? <T id="vendors.vendor-list.vendors-2" values={{ dataCount: data.length }}>{"{dataCount}+ vendors"}</T> : <T id="vendors.vendor-list.vendors-3" values={{ dataCount: data.length }}>{"{dataCount} vendors"}</T>}
        </span>
      </FilterBar>
      {vendors.error ? (
        <LoadError message={vendors.error} />
      ) : vendors.loading && !vendors.data ? (
        <LoadingSkeleton />
      ) : (
        <PageGrid pageKey="vendors.list">
          <Block id="list" name="List" h={24}>
          <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="vendors.vendor-list"
            data={data}
            columns={columns}
            onRow={(vendor) => navigate(`/vendors/${vendor.id}`)}
            label={<T id="vendors.vendor-list.vendors-4">vendors</T>}
            exportName="vendors"
          />
          <LoadMore list={vendors} label={<T id="vendors.vendor-list.load-more-vendors">Load more vendors</T>} />
        </Block>
          </PageGrid>
      )}
      {create && (
        <VendorForm
          onClose={() => setCreate(false)}
          onSaved={(vendor) => navigate(`/vendors/${vendor.id}`)}
        />
      )}
    </>
  );
}

type Row<T> = T & { key: string };
let nextKey = 0;
const keyed = <T,>(value: T): Row<T> => ({ ...value, key: `row-${nextKey++}` });
const dollars = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2);

// There is deliberately no password field (AC1): portal passwords stay out of
// Flowbase.
export function VendorForm({
  vendor,
  onClose,
  onSaved,
}: {
  vendor?: VendorRecord;
  onClose: () => void;
  onSaved: (vendor: VendorRecord) => void;
}) {
  const [fields, setFields] = useState({
    name: vendor?.name ?? "",
    portalUrl: vendor?.portalUrl ?? "",
    orderCutoff: vendor?.orderCutoff ?? "",
    minimumOrder: dollars(vendor?.minimumOrderCents ?? null),
    leadTimeDays:
      vendor?.leadTimeDays === null || vendor?.leadTimeDays === undefined
        ? ""
        : String(vendor.leadTimeDays),
    orderingInstructions: vendor?.orderingInstructions ?? "",
    notes: vendor?.notes ?? "",
  });
  const [type, setType] = useState<VendorType>(
    vendor?.type ?? "food_distributor",
  );
  const [deliveryDays, setDeliveryDays] = useState<Weekday[]>(
    vendor?.deliveryDays ?? [],
  );
  // null: hidden from this user (part-time), so the form leaves them alone.
  const [accountNumber, setAccountNumber] = useState<string | null>(
    vendor ? vendor.accountNumber : "",
  );
  const [contacts, setContacts] = useState<Row<VendorContactInput>[] | null>(
    vendor ? (vendor.contacts?.map(keyed) ?? null) : [],
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const field = (key: keyof typeof fields, type = "text") => (
    <input
      type={type}
      step={type === "number" ? "any" : undefined}
      value={fields[key]}
      onChange={(e) => set(key)(e.target.value)}
    />
  );
  const save = async () => {
    if (!fields.name.trim()) return setError("Name is required.");
    if (contacts?.some((contact) => !contact.name.trim()))
      return setError("Every contact needs a name.");
    const input: VendorInput = {
      name: fields.name,
      type,
      portalUrl: fields.portalUrl,
      orderCutoff: fields.orderCutoff,
      deliveryDays: weekdaySchema.options.filter((day) =>
        deliveryDays.includes(day),
      ),
      minimumOrderCents: fields.minimumOrder.trim()
        ? Math.round(Number(fields.minimumOrder) * 100)
        : null,
      leadTimeDays: fields.leadTimeDays.trim()
        ? Number(fields.leadTimeDays)
        : null,
      orderingInstructions: fields.orderingInstructions,
      notes: fields.notes,
      ...(accountNumber !== null && { accountNumber }),
      ...(contacts !== null && {
        contacts: contacts.map(({ id, name, role, email, phone }) => ({
          id,
          name,
          role,
          email,
          phone,
        })),
      }),
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        vendor
          ? await vendorsApi.update(vendor.id, input)
          : await vendorsApi.create(input),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const updateContact = (
    key: string,
    field: "name" | "role" | "email" | "phone",
    value: string,
  ) =>
    setContacts((current) =>
      (current ?? []).map((other) =>
        other.key === key ? { ...other, [field]: value } : other,
      ),
    );
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={vendor ? <T id="vendors.vendor-form.edit-vendor">Edit vendor</T> : <T id="vendors.vendor-form.new-vendor">New vendor</T>}
      description={<T id="vendors.vendor-form.saved-to-flowbase-portal-passwords">Saved to Flowbase. Portal passwords are never stored here.</T>}
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
        <FormField label={<T id="vendors.vendor-form.name">Name *</T>}>
          <input
            value={fields.name}
            onChange={(e) => set("name")(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label={<T id="vendors.vendor-form.type">Type</T>}>
          <Dropdown
            value={type}
            onChange={(e) => setType(vendorTypeSchema.parse(e.target.value))}
          >
            {vendorTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {vendorTypeLabels[option]}
              </option>
            ))}
          </Dropdown>
        </FormField>
        <div className="form-grid">
          <FormField label={<T id="vendors.vendor-form.vendor-portal-url">Vendor portal URL</T>}>
            {field("portalUrl", "url")}
          </FormField>
          <FormField label={<T id="vendors.vendor-form.account-number">Account number</T>}>
            {accountNumber === null ? (
              <p className="muted">{hiddenNote}</p>
            ) : (
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={<T id="vendors.vendor-form.order-cutoff">Order cutoff</T>}>{field("orderCutoff")}</FormField>
          <FormField label={<T id="vendors.vendor-form.minimum-order">Minimum order ($)</T>}>
            {field("minimumOrder", "number")}
          </FormField>
          <FormField label={<T id="vendors.vendor-form.lead-time-days">Lead time (days)</T>}>
            {field("leadTimeDays", "number")}
          </FormField>
        </div>
        <fieldset className="form-group">
          <legend><T id="vendors.vendor-form.delivery-days">Delivery days</T></legend>
          {weekdaySchema.options.map((day) => (
            <label className="checkbox-filter" key={day}>
              <RoundCheck
                checked={deliveryDays.includes(day)}
                onChange={(e) =>
                  setDeliveryDays((current) =>
                    e.target.checked
                      ? [...current, day]
                      : current.filter((other) => other !== day),
                  )
                }
              />
              <LabelT id="labels.weekday" value={day}>{weekdayLabels[day]}</LabelT>
            </label>
          ))}
        </fieldset>
        <FormField label={<T id="vendors.vendor-form.ordering-instructions">Ordering instructions</T>}>
          <textarea
            rows={3}
            value={fields.orderingInstructions}
            onChange={(e) => set("orderingInstructions")(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="vendors.vendor-form.notes">Notes</T>}>
          <textarea
            rows={2}
            value={fields.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading"><T id="vendors.vendor-form.contacts">Contacts</T></h3>
        {contacts === null ? (
          <p className="muted"><T id="vendors.vendor-form.vendor-contacts-are" values={{ hiddenNote: hiddenNote.toLowerCase() }}>{"Vendor contacts are {hiddenNote}"}</T></p>
        ) : (
          <>
            {contacts.map((contact, index) => (
              <fieldset
                className="form-group"
                key={contact.key}
                aria-label={`Vendor contact ${index + 1}`}
              >
                <div className="form-grid">
                  {(["name", "role", "email", "phone"] as const).map((key) => (
                    <FormField
                      key={key}
                      label={
                        {
                          name: "Contact name *",
                          role: "Role",
                          email: "Email",
                          phone: "Phone",
                        }[key]
                      }
                    >
                      <input
                        value={contact[key] ?? ""}
                        onChange={(e) =>
                          updateContact(contact.key, key, e.target.value)
                        }
                      />
                    </FormField>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setContacts((current) =>
                      (current ?? []).filter(
                        (other) => other.key !== contact.key,
                      ),
                    )
                  }
                >
                  <T id="vendors.vendor-form.remove-contact">Remove contact</T>
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setContacts((current) => [
                  ...(current ?? []),
                  keyed({ name: "", role: "", email: "", phone: "" }),
                ])
              }
            >
              <Plus size={14} /><T id="vendors.vendor-form.add-contact">{" Add contact"}</T>
            </Button>
          </>
        )}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="vendors.vendor-form.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="vendors.vendor-form.save-vendor">Save vendor</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

export function VendorDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const vendor = useResource(["vendors", id], () => vendorsApi.get(id));
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  const back = (
    <Link to="/vendors" className="back-link">
      <T id="vendors.vendor-detail.all-vendors">← All vendors</T>
    </Link>
  );
  if (vendor.error)
    return (
      <>
        {back}
        <LoadError message={vendor.error} />
      </>
    );
  const v = vendor.data;
  if (!v) return <LoadingSkeleton />;
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{v.name}</h1>
          <p>
            <span className="badge neutral"><LabelT id="labels.vendor-type" value={v.type}>{vendorTypeLabels[v.type]}</LabelT></span>
            {v.archivedAt && <span className="badge error"><T id="vendors.vendor-detail.archived">Archived</T></span>}
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="inventory.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              <T id="vendors.vendor-detail.edit">Edit</T>
            </Button>
          </Allowed>
          <Allowed action="inventory.write">
            {v.archivedAt ? (
              <Button
                variant="outline"
                onClick={async () =>
                  vendor.replace(await vendorsApi.setArchived(v.id, false))
                }
              >
                <RotateCcw size={14} />
                <T id="vendors.vendor-detail.restore">Restore</T>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                <T id="vendors.vendor-detail.archive">Archive</T>
              </Button>
            )}
          </Allowed>
        </div>
      </div>
      <div className="detail-grid">
        <Section title={<T id="vendors.vendor-detail.ordering">Ordering</T>}>
          <small><T id="vendors.vendor-detail.vendor-portal">Vendor portal</T></small>
          <p>
            {v.portalUrl ? (
              <a href={v.portalUrl} target="_blank" rel="noreferrer">
                {v.portalUrl} <ExternalLink size={12} aria-hidden />
              </a>
            ) : (
              "—"
            )}
          </p>
          <small><T id="vendors.vendor-detail.account-number">Account number</T></small>
          <p>
            {v.accountNumber === null ? (
              <span className="muted">{hiddenNote}</span>
            ) : (
              v.accountNumber || "—"
            )}
          </p>
          <small><T id="vendors.vendor-detail.order-cutoff">Order cutoff</T></small>
          <p>{v.orderCutoff || "—"}</p>
          <small><T id="vendors.vendor-detail.delivery-days">Delivery days</T></small>
          <p><DaysText days={v.deliveryDays} /></p>
          <small><T id="vendors.vendor-detail.minimum-order">Minimum order</T></small>
          <p>{centsLabel(v.minimumOrderCents)}</p>
          <small><T id="vendors.vendor-detail.lead-time">Lead time</T></small>
          <p>{leadTimeLabel(v.leadTimeDays)}</p>
          <small><T id="vendors.vendor-detail.ordering-instructions">Ordering instructions</T></small>
          <p className="vendor-text">{v.orderingInstructions || "—"}</p>
          <small><T id="vendors.vendor-detail.notes">Notes</T></small>
          <p className="vendor-text">{v.notes || "—"}</p>
        </Section>
        <Section title={<T id="vendors.vendor-detail.contacts">Contacts</T>}>
          {v.contacts === null ? (
            <p className="muted"><T id="vendors.vendor-detail.vendor-contacts-are" values={{ hiddenNote: hiddenNote.toLowerCase() }}>{"Vendor contacts are {hiddenNote}"}</T></p>
          ) : v.contacts.length ? (
            v.contacts.map((contact) => (
              <div className="contact-profile" key={contact.id}>
                <div>
                  <strong>{contact.name}</strong>
                  <small>
                    {[contact.role, contact.email, contact.phone]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="muted"><T id="vendors.vendor-detail.no-contacts-yet">No contacts yet.</T></p>
          )}
        </Section>
      </div>
      <Section title={<T id="vendors.vendor-detail.items-they-supply">Items they supply</T>}>
        {v.items.length ? (
          <ul className="vendor-items">
            {v.items.map((item) => (
              <li key={item.id}>
                <Link to={`/inventory/${item.id}`}>{item.name}</Link>
                <small>
                  {item.relation === "sub_rental"
                    ? <T id="vendors.vendor-detail.sub-rental">Sub-rental</T>
                    : item.subtype
                      ? subtypeLabel(item.subtype)
                      : <LabelT id="labels.item-kind" value={item.kind}>{kindLabels[item.kind]}</LabelT>}
                  {item.code && ` · ${item.code}`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            <T id="vendors.vendor-detail.no-items-yet-pick-this">No items yet. Pick this vendor on an item to list it here.</T>
          </p>
        )}
      </Section>
      {edit && (
        <VendorForm
          vendor={v}
          onClose={() => setEdit(false)}
          onSaved={vendor.replace}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="vendors.vendor-detail.archive-this-vendor">Archive this vendor?</T>}
        onConfirm={async () => {
          await vendorsApi.setArchived(v.id, true);
          setArchive(false);
          navigate("/vendors");
        }}
      >
        <T id="vendors.vendor-detail.will-no-longer-be-offered" values={{ name: v.name }}>{"{name} will no longer be offered for new items. Items already linked keep the link."}</T>
      </ConfirmationDialog>
    </>
  );
}
