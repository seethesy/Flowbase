import { Allowed } from "../app/permissions";
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

const daysLabel = (days: Weekday[]) =>
  days.map((day) => weekdayLabels[day]).join(", ") || "—";
const leadTimeLabel = (days: number | null) =>
  days === null ? "—" : `${days} day${days === 1 ? "" : "s"}`;
const hiddenNote = "Visible to full-time staff only.";

// Vendor and distributor directory (FLOW-84): distributors, rental vendors and
// event partners, with how to order from each.
export function VendorList() {
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
  const data = vendors.data ?? [];
  const columns: ColumnDef<Vendor, unknown>[] = [
    { accessorKey: "name", header: "Vendor" },
    {
      id: "type",
      header: "Type",
      accessorFn: (vendor) => vendorTypeLabels[vendor.type],
    },
    {
      id: "deliveryDays",
      header: "Delivery days",
      accessorFn: (vendor) => daysLabel(vendor.deliveryDays),
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
        title="Vendors"
        subtitle="Distributors, rental vendors and event partners, and how to order from each."
        eyebrow="Inventory"
      >
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Vendor
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search vendors…"
        />
        <select
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
        </select>
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="result-count">
          {data.length}
          {vendors.hasMore ? "+" : ""} vendors
        </span>
      </FilterBar>
      {vendors.error ? (
        <LoadError message={vendors.error} />
      ) : vendors.loading && !vendors.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable
            data={data}
            columns={columns}
            onRow={(vendor) => navigate(`/vendors/${vendor.id}`)}
            label="vendors"
            exportName="vendors"
          />
          <LoadMore list={vendors} label="Load more vendors" />
        </>
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
      title={vendor ? "Edit vendor" : "New vendor"}
      description="Saved to Flowbase. Portal passwords are never stored here."
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
        <FormField label="Name *">
          <input
            value={fields.name}
            onChange={(e) => set("name")(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Type">
          <select
            value={type}
            onChange={(e) => setType(vendorTypeSchema.parse(e.target.value))}
          >
            {vendorTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {vendorTypeLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <div className="form-grid">
          <FormField label="Vendor portal URL">
            {field("portalUrl", "url")}
          </FormField>
          <FormField label="Account number">
            {accountNumber === null ? (
              <p className="muted">{hiddenNote}</p>
            ) : (
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Order cutoff">{field("orderCutoff")}</FormField>
          <FormField label="Minimum order ($)">
            {field("minimumOrder", "number")}
          </FormField>
          <FormField label="Lead time (days)">
            {field("leadTimeDays", "number")}
          </FormField>
        </div>
        <fieldset className="form-group">
          <legend>Delivery days</legend>
          {weekdaySchema.options.map((day) => (
            <label className="checkbox-filter" key={day}>
              <input
                type="checkbox"
                checked={deliveryDays.includes(day)}
                onChange={(e) =>
                  setDeliveryDays((current) =>
                    e.target.checked
                      ? [...current, day]
                      : current.filter((other) => other !== day),
                  )
                }
              />
              {weekdayLabels[day]}
            </label>
          ))}
        </fieldset>
        <FormField label="Ordering instructions">
          <textarea
            rows={3}
            value={fields.orderingInstructions}
            onChange={(e) => set("orderingInstructions")(e.target.value)}
          />
        </FormField>
        <FormField label="Notes">
          <textarea
            rows={2}
            value={fields.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading">Contacts</h3>
        {contacts === null ? (
          <p className="muted">Vendor contacts are {hiddenNote.toLowerCase()}</p>
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
                  Remove contact
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
              <Plus size={14} /> Add contact
            </Button>
          </>
        )}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save vendor
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
      ← All vendors
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
            <span className="badge neutral">{vendorTypeLabels[v.type]}</span>
            {v.archivedAt && <span className="badge error">Archived</span>}
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="inventory.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              Edit
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
                Restore
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                Archive
              </Button>
            )}
          </Allowed>
        </div>
      </div>
      <div className="detail-grid">
        <Section title="Ordering">
          <small>Vendor portal</small>
          <p>
            {v.portalUrl ? (
              <a href={v.portalUrl} target="_blank" rel="noreferrer">
                {v.portalUrl} <ExternalLink size={12} aria-hidden />
              </a>
            ) : (
              "—"
            )}
          </p>
          <small>Account number</small>
          <p>
            {v.accountNumber === null ? (
              <span className="muted">{hiddenNote}</span>
            ) : (
              v.accountNumber || "—"
            )}
          </p>
          <small>Order cutoff</small>
          <p>{v.orderCutoff || "—"}</p>
          <small>Delivery days</small>
          <p>{daysLabel(v.deliveryDays)}</p>
          <small>Minimum order</small>
          <p>{centsLabel(v.minimumOrderCents)}</p>
          <small>Lead time</small>
          <p>{leadTimeLabel(v.leadTimeDays)}</p>
          <small>Ordering instructions</small>
          <p className="vendor-text">{v.orderingInstructions || "—"}</p>
          <small>Notes</small>
          <p className="vendor-text">{v.notes || "—"}</p>
        </Section>
        <Section title="Contacts">
          {v.contacts === null ? (
            <p className="muted">Vendor contacts are {hiddenNote.toLowerCase()}</p>
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
            <p className="muted">No contacts yet.</p>
          )}
        </Section>
      </div>
      <Section title="Items they supply">
        {v.items.length ? (
          <ul className="vendor-items">
            {v.items.map((item) => (
              <li key={item.id}>
                <Link to={`/inventory/${item.id}`}>{item.name}</Link>
                <small>
                  {item.relation === "sub_rental"
                    ? "Sub-rental"
                    : item.subtype
                      ? subtypeLabel(item.subtype)
                      : kindLabels[item.kind]}
                  {item.code && ` · ${item.code}`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No items yet. Pick this vendor on an item to list it here.
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
        title="Archive this vendor?"
        onConfirm={async () => {
          await vendorsApi.setArchived(v.id, true);
          setArchive(false);
          navigate("/vendors");
        }}
      >
        {v.name} will no longer be offered for new items. Items already linked
        keep the link.
      </ConfirmationDialog>
    </>
  );
}
