import { Dropdown } from "../components/ui/Dropdown";
import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Pencil, Archive, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  jurisdictionSchema,
  venueContactRoleSchema,
  type Venue,
  type VenueInput,
} from "../../shared/core-records";
import { allPages, eventsApi, venuesApi } from "../services/core";
import { StaleReload, isStale } from "../components/stale-reload";
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
import { EventTable } from "./events";
import { Attachments } from "./attachments";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy } from "../app/copy";

const contactRoleLabels = { manager: "Manager", coordinator: "Coordinator" };

// Venues (FLOW-54): reused across events, with the areas used for layouts.
export function VenueList() {
  const searchVenuesPlaceholder = useCopy("venues.venue-list.search-venues.placeholder", "Search venues…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  // The API searches names and addresses across every venue (FLOW-179).
  const term = useDebounced(search.trim());
  const venues = usePagedList(
    ["venues", "list", archived, term],
    (cursor) => venuesApi.list({ archived, search: term || undefined }, cursor),
  );
  const data = venues.data ?? [];
  const columns: ColumnDef<Venue, unknown>[] = [
    { accessorKey: "name", header: "Venue" },
    { accessorKey: "address", header: "Address" },
    {
      id: "jurisdiction",
      header: "Jurisdiction",
      accessorFn: (venue) => venue.jurisdiction ?? "—",
    },
    {
      id: "areas",
      header: "Areas",
      accessorFn: (venue) => venue.areas.map((area) => area.name).join(", "),
    },
  ];
  return (
    <>
      <PageHeader
        title={<T id="venues.venue-list.venues">Venues</T>}
        subtitle={<T id="venues.venue-list.addresses-areas-and-load-in">Addresses, areas and load-in details, ready for every event.</T>}
        eyebrow={<T id="venues.venue-list.venues">Venues</T>}
      >
        <Allowed action="venues.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="venues.venue-list.new-venue">New Venue</T>
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchVenuesPlaceholder} copyId="venues.venue-list.search-venues.placeholder"
        />
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="venues.venue-list.show-archived">Show archived</T>
        </label>
        <span className="result-count">
          {venues.hasMore ? <T id="venues.venue-list.venues-2" values={{ dataCount: data.length }}>{"{dataCount}+ venues"}</T> : <T id="venues.venue-list.venues-3" values={{ dataCount: data.length }}>{"{dataCount} venues"}</T>}
        </span>
      </FilterBar>
      {venues.error ? (
        <LoadError message={venues.error} />
      ) : venues.loading && !venues.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable copyKey="venues.venue-list"
            data={data}
            columns={columns}
            onRow={(venue) => navigate(`/venues/${venue.id}`)}
            label={<T id="venues.venue-list.venues-4">venues</T>}
            exportName="venues"
            exportAll={venues.loadAll}
          />
          <LoadMore list={venues} label={<T id="venues.venue-list.load-more-venues">Load more venues</T>} />
        </>
      )}
      {create && (
        <VenueForm
          onClose={() => setCreate(false)}
          onSaved={(venue) => navigate(`/venues/${venue.id}`)}
        />
      )}
    </>
  );
}

type Row<T> = T & { key: string };
let nextKey = 0;
const keyed = <T,>(value: T): Row<T> => ({ ...value, key: `row-${nextKey++}` });

type VenueFormProps = {
  venue?: Venue;
  onClose: () => void;
  onSaved: (venue: Venue) => void;
};

// Edits reload the current version when the save was made from a stale copy
// (FLOW-186).
export function VenueForm(props: VenueFormProps) {
  return (
    <StaleReload
      record={props.venue}
      load={(id) => venuesApi.get(id)}
      what="venue"
    >
      {({ record, conflict, onStale }) => (
        <VenueFormFields
          key={record?.updatedAt ?? "new"}
          {...props}
          venue={record}
          conflict={conflict}
          onStale={onStale}
        />
      )}
    </StaleReload>
  );
}

function VenueFormFields({
  venue,
  onClose,
  onSaved,
  conflict,
  onStale,
}: VenueFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const [name, setName] = useState(venue?.name ?? "");
  const [address, setAddress] = useState(venue?.address ?? "");
  const [jurisdiction, setJurisdiction] = useState<string>(
    venue?.jurisdiction ?? "",
  );
  const [loadInNotes, setLoadInNotes] = useState(venue?.loadInNotes ?? "");
  const [parkingNotes, setParkingNotes] = useState(venue?.parkingNotes ?? "");
  const [areas, setAreas] = useState<Row<{ id?: string; name: string }>[]>(
    (venue?.areas ?? []).map((area) => keyed({ id: area.id, name: area.name })),
  );
  // null: contacts are hidden from this user, so the form leaves them alone.
  const [contacts, setContacts] = useState<
    Row<NonNullable<VenueInput["contacts"]>[number]>[] | null
  >(venue ? (venue.contacts?.map(keyed) ?? null) : []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return setError("Name is required.");
    if (areas.some((area) => !area.name.trim()))
      return setError("Every area needs a name.");
    if (contacts?.some((contact) => !contact.name.trim()))
      return setError("Every venue contact needs a name.");
    const input: VenueInput = {
      name,
      address,
      jurisdiction: jurisdiction ? jurisdictionSchema.parse(jurisdiction) : null,
      loadInNotes,
      parkingNotes,
      areas: areas.map(({ id, name }) => ({ id, name })),
      contacts: contacts?.map(({ id, name, role, email, phone }) => ({
        id,
        name,
        role,
        email,
        phone,
      })),
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        venue
          ? await venuesApi.update(venue.id, {
              ...input,
              updatedAt: venue.updatedAt,
            })
          : await venuesApi.create(input),
      );
      onClose();
    } catch (e) {
      if (venue && isStale(e)) {
        await onStale();
        return;
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={venue ? <T id="venues.venue-form-fields.edit-venue">Edit venue</T> : <T id="venues.venue-form-fields.new-venue">New venue</T>}
      description={<T id="venues.venue-form-fields.saved-to-flowbase">Saved to Flowbase.</T>}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {conflict && (
          <p role="alert" className="error-message">
            {conflict}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label={<T id="venues.venue-form-fields.name">Name *</T>}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label={<T id="venues.venue-form-fields.address">Address</T>}>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="venues.venue-form-fields.jurisdiction">Jurisdiction</T>} hint={<T id="venues.venue-form-fields.stored-for-future-tax-use">Stored for future tax use.</T>}>
          <Dropdown
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
          >
            <option value="">Not set</option>
            {jurisdictionSchema.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Dropdown>
        </FormField>
        <FormField label={<T id="venues.venue-form-fields.load-in-notes">Load-in notes</T>}>
          <textarea
            rows={2}
            value={loadInNotes}
            onChange={(e) => setLoadInNotes(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="venues.venue-form-fields.parking-notes">Parking notes</T>}>
          <textarea
            rows={2}
            value={parkingNotes}
            onChange={(e) => setParkingNotes(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading"><T id="venues.venue-form-fields.areas">Areas</T></h3>
        {areas.map((area, index) => (
          <div className="inline-row" key={area.key}>
            <FormField label={<T id="venues.venue-form-fields.area" values={{ value: index + 1 }}>{"Area {value}"}</T>}>
              <input
                value={area.name}
                onChange={(e) =>
                  setAreas((current) =>
                    current.map((other) =>
                      other.key === area.key
                        ? { ...other, name: e.target.value }
                        : other,
                    ),
                  )
                }
              />
            </FormField>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setAreas((current) =>
                  current.filter((other) => other.key !== area.key),
                )
              }
            >
              <T id="venues.venue-form-fields.remove-area">Remove area</T>
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setAreas((current) => [...current, keyed({ name: "" })])}
        >
          <Plus size={14} /><T id="venues.venue-form-fields.add-area">{" Add area"}</T>
        </Button>
        <h3 className="form-subheading"><T id="venues.venue-form-fields.venue-contacts">Venue contacts</T></h3>
        {contacts === null ? (
          <p className="muted">
            <T id="venues.venue-form-fields.venue-contacts-are-visible-to">Venue contacts are visible to full-time staff only.</T>
          </p>
        ) : (
          <>
            {contacts.map((contact, index) => (
              <fieldset
                className="form-group"
                key={contact.key}
                aria-label={`Venue contact ${index + 1}`}
              >
                <div className="form-grid">
                  {(["name", "email", "phone"] as const).map((field) => (
                    <FormField
                      key={field}
                      label={
                        field === "name"
                          ? <T id="venues.venue-form-fields.contact-name">Contact name *</T>
                          : field === "email"
                            ? <T id="venues.venue-form-fields.email">Email</T>
                            : <T id="venues.venue-form-fields.phone">Phone</T>
                      }
                    >
                      <input
                        value={contact[field] ?? ""}
                        onChange={(e) =>
                          setContacts((current) =>
                            (current ?? []).map((other) =>
                              other.key === contact.key
                                ? { ...other, [field]: e.target.value }
                                : other,
                            ),
                          )
                        }
                      />
                    </FormField>
                  ))}
                  <FormField label={<T id="venues.venue-form-fields.role">Role</T>}>
                    <Dropdown
                      value={contact.role}
                      onChange={(e) =>
                        setContacts((current) =>
                          (current ?? []).map((other) =>
                            other.key === contact.key
                              ? {
                                  ...other,
                                  role: venueContactRoleSchema.parse(
                                    e.target.value,
                                  ),
                                }
                              : other,
                          ),
                        )
                      }
                    >
                      {venueContactRoleSchema.options.map((role) => (
                        <option key={role} value={role}>
                          {contactRoleLabels[role]}
                        </option>
                      ))}
                    </Dropdown>
                  </FormField>
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
                  <T id="venues.venue-form-fields.remove-contact">Remove contact</T>
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setContacts((current) => [
                  ...(current ?? []),
                  keyed({
                    name: "",
                    role: "manager" as const,
                    email: "",
                    phone: "",
                  }),
                ])
              }
            >
              <Plus size={14} /><T id="venues.venue-form-fields.add-venue-contact">{" Add venue contact"}</T>
            </Button>
          </>
        )}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="venues.venue-form-fields.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="venues.venue-form-fields.save-venue">Save venue</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

export function VenueDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const venue = useResource(
    ["venues", id],
    () => venuesApi.get(id),
  );
  const events = useResource(
    ["events", { venueId: id }, "all"],
    () => allPages((cursor) => eventsApi.list({ venueId: id }, cursor)),
  );
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  const back = (
    <Link to="/venues" className="back-link">
      <T id="venues.venue-detail.all-venues">← All venues</T>
    </Link>
  );
  if (venue.error)
    return (
      <>
        {back}
        <LoadError message={venue.error} />
      </>
    );
  const v = venue.data;
  if (!v) return <LoadingSkeleton />;
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{v.name}</h1>
          <p>
            {v.jurisdiction && (
              <span className="badge neutral">{v.jurisdiction}</span>
            )}
            {v.archivedAt && <span className="badge error"><T id="venues.venue-detail.archived">Archived</T></span>}
            <span>{v.address}</span>
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="venues.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              <T id="venues.venue-detail.edit">Edit</T>
            </Button>
          </Allowed>
          {v.archivedAt ? (
            <Allowed action="venues.write">
              <Button
                variant="outline"
                onClick={async () =>
                  venue.replace(await venuesApi.setArchived(v.id, false))
                }
              >
                <RotateCcw size={14} />
                <T id="venues.venue-detail.restore">Restore</T>
              </Button>
            </Allowed>
          ) : (
            <Allowed action="venues.write">
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                <T id="venues.venue-detail.archive">Archive</T>
              </Button>
            </Allowed>
          )}
        </div>
      </div>
      <div className="detail-grid">
        <Section title={<T id="venues.venue-detail.venue-details">Venue details</T>}>
          <small><T id="venues.venue-detail.areas">Areas</T></small>
          <p>{v.areas.map((area) => area.name).join(", ") || <T id="venues.venue-detail.no-areas-yet">No areas yet.</T>}</p>
          <small><T id="venues.venue-detail.load-in">Load-in</T></small>
          <p>{v.loadInNotes || "—"}</p>
          <small><T id="venues.venue-detail.parking">Parking</T></small>
          <p>{v.parkingNotes || "—"}</p>
        </Section>
        <Section title={<T id="venues.venue-detail.venue-contacts">Venue contacts</T>}>
          {v.contacts === null ? (
            <p className="muted">
              <T id="venues.venue-detail.venue-contacts-are-visible-to">Venue contacts are visible to full-time staff only.</T>
            </p>
          ) : v.contacts.length ? (
            v.contacts.map((contact) => (
              <div className="contact-profile" key={contact.id}>
                <div>
                  <strong>{contact.name}</strong>
                  <small>
                    {contactRoleLabels[contact.role]} · {contact.email || "—"} ·{" "}
                    {contact.phone || "—"}
                  </small>
                </div>
              </div>
            ))
          ) : (
            <p className="muted"><T id="venues.venue-detail.no-venue-contacts-yet">No venue contacts yet.</T></p>
          )}
        </Section>
      </div>
      <div className="detail-grid">
        <Attachments
          recordType="venue"
          recordId={v.id}
          group="floor_plan"
          title="Floor plans"
        />
        <Attachments
          recordType="venue"
          recordId={v.id}
          group="aerial"
          title="Aerial images"
        />
      </div>
      <Section title={<T id="venues.venue-detail.event-history">Event history</T>}>
        <EventTable events={events.data ?? []} error={events.error} />
      </Section>
      {edit && (
        <VenueForm
          venue={v}
          onClose={() => setEdit(false)}
          onSaved={venue.replace}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="venues.venue-detail.archive-this-venue">Archive this venue?</T>}
        onConfirm={async () => {
          await venuesApi.setArchived(v.id, true);
          setArchive(false);
          navigate("/venues");
        }}
      >
        <T id="venues.venue-detail.will-no-longer-be-offered" values={{ name: v.name }}>{"{name} will no longer be offered for new events."}</T>
      </ConfirmationDialog>
    </>
  );
}
