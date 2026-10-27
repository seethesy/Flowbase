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
import { eventsApi, venuesApi } from "../services/core";
import { useResource } from "../app/useResource";
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

const contactRoleLabels = { manager: "Manager", coordinator: "Coordinator" };

// Venues (FLOW-54): reused across events, with the areas used for layouts.
export function VenueList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  const venues = useResource(() => venuesApi.list({ archived }), [archived]);
  const data = (venues.data ?? []).filter((venue) =>
    `${venue.name} ${venue.address}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
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
        title="Venues"
        subtitle="Addresses, areas and load-in details, ready for every event."
        eyebrow="Venues"
      >
        <Allowed action="venues.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Venue
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search venues…"
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="result-count">{data.length} venues</span>
      </FilterBar>
      {venues.error ? (
        <LoadError message={venues.error} />
      ) : venues.loading && !venues.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(venue) => navigate(`/venues/${venue.id}`)}
          label="venues"
          exportName="venues"
        />
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

export function VenueForm({
  venue,
  onClose,
  onSaved,
}: {
  venue?: Venue;
  onClose: () => void;
  onSaved: (venue: Venue) => void;
}) {
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
          ? await venuesApi.update(venue.id, input)
          : await venuesApi.create(input),
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
      title={venue ? "Edit venue" : "New venue"}
      description="Saved to Flowbase."
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Address">
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </FormField>
        <FormField label="Jurisdiction" hint="Stored for future tax use.">
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
          >
            <option value="">Not set</option>
            {jurisdictionSchema.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Load-in notes">
          <textarea
            rows={2}
            value={loadInNotes}
            onChange={(e) => setLoadInNotes(e.target.value)}
          />
        </FormField>
        <FormField label="Parking notes">
          <textarea
            rows={2}
            value={parkingNotes}
            onChange={(e) => setParkingNotes(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading">Areas</h3>
        {areas.map((area, index) => (
          <div className="inline-row" key={area.key}>
            <FormField label={`Area ${index + 1}`}>
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
              Remove area
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setAreas((current) => [...current, keyed({ name: "" })])}
        >
          <Plus size={14} /> Add area
        </Button>
        <h3 className="form-subheading">Venue contacts</h3>
        {contacts === null ? (
          <p className="muted">
            Venue contacts are visible to full-time staff only.
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
                          ? "Contact name *"
                          : field === "email"
                            ? "Email"
                            : "Phone"
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
                  <FormField label="Role">
                    <select
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
                    </select>
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
                  keyed({
                    name: "",
                    role: "manager" as const,
                    email: "",
                    phone: "",
                  }),
                ])
              }
            >
              <Plus size={14} /> Add venue contact
            </Button>
          </>
        )}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save venue
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

export function VenueDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const venue = useResource(() => venuesApi.get(id), [id]);
  const events = useResource(() => eventsApi.list({ venueId: id }), [id]);
  const [edit, setEdit] = useState(false);
  const [archive, setArchive] = useState(false);
  const back = (
    <Link to="/venues" className="back-link">
      ← All venues
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
            {v.archivedAt && <span className="badge error">Archived</span>}
            <span>{v.address}</span>
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="venues.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              Edit
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
                Restore
              </Button>
            </Allowed>
          ) : (
            <Allowed action="venues.write">
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                Archive
              </Button>
            </Allowed>
          )}
        </div>
      </div>
      <div className="detail-grid">
        <Section title="Venue details">
          <small>Areas</small>
          <p>{v.areas.map((area) => area.name).join(", ") || "No areas yet."}</p>
          <small>Load-in</small>
          <p>{v.loadInNotes || "—"}</p>
          <small>Parking</small>
          <p>{v.parkingNotes || "—"}</p>
        </Section>
        <Section title="Venue contacts">
          {v.contacts === null ? (
            <p className="muted">
              Venue contacts are visible to full-time staff only.
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
            <p className="muted">No venue contacts yet.</p>
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
      <Section title="Event history">
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
        title="Archive this venue?"
        onConfirm={async () => {
          await venuesApi.setArchived(v.id, true);
          setArchive(false);
          navigate("/venues");
        }}
      >
        {v.name} will no longer be offered for new events.
      </ConfirmationDialog>
    </>
  );
}
