import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, Pencil, Archive, RotateCcw, TriangleAlert } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  contactRoleLabels,
  contactRoleSchema,
  type Client,
  type ClientInput,
  type Contact,
  type ContactInput,
} from "../../shared/core-records";
import { ApiRequestError, clientsApi, eventsApi } from "../services/core";
import { useResource } from "../app/useResource";
import { useOpenFor } from "../app/useOpenFor";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  Tabs,
  Section,
  ConfirmationDialog,
  EmptyState,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
} from "../components/shared";
import { EventForm, EventTable } from "./events";
import { Attachments } from "./attachments";
import "./clients.css";

export const initials = (name: string) =>
  name
    .replace(/&/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");

export function LoadError({ message }: { message: string }) {
  return (
    <p role="alert" className="error-message">
      {message}
    </p>
  );
}

const primaryContact = (client: Client) =>
  client.contacts.find((contact) => contact.role === "primary_poc") ??
  client.contacts[0];
export const hidden = (value: string | null) =>
  value === null ? "Hidden" : value || "—";

// Real client records (FLOW-53), replacing the prototype's mock clients.
export function ClientList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  const clients = useResource(() => clientsApi.list({ archived }), [archived]);
  const term = search.toLowerCase();
  const data = (clients.data ?? []).filter((client) =>
    [client.name, ...client.contacts.map((contact) => contact.name)]
      .join(" ")
      .toLowerCase()
      .includes(term),
  );
  const columns: ColumnDef<Client, unknown>[] = [
    {
      accessorKey: "name",
      header: "Client",
      cell: (c) => (
        <span className="company-cell">
          <span className="company-avatar">
            {initials(c.row.original.name)}
          </span>
          <strong>{c.getValue() as string}</strong>
          {c.row.original.possibleDuplicateOf && (
            <span className="badge warning">Possible duplicate</span>
          )}
        </span>
      ),
    },
    {
      id: "kind",
      header: "Type",
      accessorFn: (client) =>
        client.kind === "person" ? "Person" : "Organization",
    },
    {
      id: "contact",
      header: "Primary contact",
      accessorFn: (client) => primaryContact(client)?.name ?? "—",
    },
    {
      id: "email",
      header: "Email",
      accessorFn: (client) => {
        const contact = primaryContact(client);
        return contact ? hidden(contact.email) : "—";
      },
    },
    {
      id: "phone",
      header: "Phone",
      accessorFn: (client) => {
        const contact = primaryContact(client);
        return contact ? hidden(contact.phone) : "—";
      },
    },
    {
      id: "tags",
      header: "Tags",
      accessorFn: (client) => client.tags.join(", "),
    },
  ];
  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Good relationships start with the little details."
        eyebrow="Clients"
      >
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          New Client
        </Button>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search clients or contacts…"
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="result-count">{data.length} clients</span>
      </FilterBar>
      {clients.error ? (
        <LoadError message={clients.error} />
      ) : clients.loading && !clients.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(client) => navigate(`/clients/${client.id}`)}
          label="clients"
        />
      )}
      {create && (
        <ClientForm
          onClose={() => setCreate(false)}
          onSaved={(client) => navigate(`/clients/${client.id}`)}
        />
      )}
    </>
  );
}

type ContactDraft = ContactInput & { key: string; hiddenDetails: boolean };
const draftOf = (contact: Contact, index: number): ContactDraft => ({
  key: contact.id ?? String(index),
  id: contact.id,
  name: contact.name,
  role: contact.role,
  // Hidden details stay undefined so the API keeps what it has.
  email: contact.email ?? undefined,
  phone: contact.phone ?? undefined,
  notes: contact.notes,
  hiddenDetails: contact.email === null,
});

export function ClientForm({
  client,
  onClose,
  onSaved,
}: {
  client?: Client;
  onClose: () => void;
  onSaved: (client: Client) => void;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [kind, setKind] = useState<Client["kind"]>(
    client?.kind ?? "organization",
  );
  const [tags, setTags] = useState(client?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [contacts, setContacts] = useState<ContactDraft[]>(
    client?.contacts.map(draftOf) ?? [
      {
        key: "new-0",
        name: "",
        role: "primary_poc",
        email: "",
        phone: "",
        hiddenDetails: false,
      },
    ],
  );
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [saving, setSaving] = useState(false);
  const update = (key: string, patch: Partial<ContactDraft>) =>
    setContacts((current) =>
      current.map((contact) =>
        contact.key === key ? { ...contact, ...patch } : contact,
      ),
    );
  const save = async (allowDuplicate: boolean) => {
    if (!name.trim()) return setError("Name is required.");
    if (contacts.some((contact) => !contact.name.trim()))
      return setError("Every contact needs a name.");
    const input: ClientInput = {
      name,
      kind,
      notes,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
        notes: contact.notes,
      })),
      allowDuplicate,
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        client
          ? await clientsApi.update(client.id, input)
          : await clientsApi.create(input),
      );
      onClose();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === "POSSIBLE_DUPLICATE")
        setDuplicates(e.duplicates);
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={client ? "Edit client" : "New client"}
      description="Saved to Flowbase."
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {duplicates.length > 0 && (
          <div role="alert" className="error-message">
            <p>
              <TriangleAlert size={14} /> A client with this email or phone
              already exists:
            </p>
            <ul>
              {duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  <Link to={`/clients/${duplicate.id}`} onClick={onClose}>
                    {duplicate.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => void save(true)}
            >
              Create anyway
            </Button>
          </div>
        )}
        <FormField label="Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <div className="form-grid">
          <FormField label="Type">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Client["kind"])}
            >
              <option value="organization">Organization</option>
              <option value="person">Person</option>
            </select>
          </FormField>
          <FormField label="Tags" hint="Separate tags with commas.">
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading">Contacts</h3>
        {contacts.map((contact, index) => (
          <fieldset
            className="form-group"
            key={contact.key}
            aria-label={`Contact ${index + 1}`}
          >
            <div className="form-grid">
              <FormField label="Contact name *">
                <input
                  value={contact.name}
                  onChange={(e) => update(contact.key, { name: e.target.value })}
                />
              </FormField>
              <FormField label="Role">
                <select
                  value={contact.role}
                  onChange={(e) =>
                    update(contact.key, {
                      role: contactRoleSchema.parse(e.target.value),
                    })
                  }
                >
                  {contactRoleSchema.options.map((role) => (
                    <option key={role} value={role}>
                      {contactRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </FormField>
              {contact.hiddenDetails ? (
                <p className="muted">
                  Email and phone are visible to full-time staff only.
                </p>
              ) : (
                <>
                  <FormField label="Email">
                    <input
                      type="email"
                      value={contact.email ?? ""}
                      onChange={(e) =>
                        update(contact.key, { email: e.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="Phone">
                    <input
                      value={contact.phone ?? ""}
                      onChange={(e) =>
                        update(contact.key, { phone: e.target.value })
                      }
                    />
                  </FormField>
                </>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setContacts((current) =>
                  current.filter((other) => other.key !== contact.key),
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
              ...current,
              {
                key: `new-${Date.now()}`,
                name: "",
                role: "billing",
                email: "",
                phone: "",
                hiddenDetails: false,
              },
            ])
          }
        >
          <Plus size={14} /> Add contact
        </Button>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save client
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

export function ClientDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useResource(() => clientsApi.get(id), [id]);
  const events = useResource(() => eventsApi.list({ clientId: id }), [id]);
  const [tab, setTab] = useState("Overview");
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  const [newEvent, setNewEvent] = useOpenFor(id);
  if (client.error)
    return (
      <>
        <Link to="/clients" className="back-link">
          ← All clients
        </Link>
        <LoadError message={client.error} />
      </>
    );
  const c = client.data;
  if (!c) return <LoadingSkeleton />;
  return (
    <>
      <Link to="/clients" className="back-link">
        ← All clients
      </Link>
      <div className="record-heading">
        <span className="company-avatar large">{initials(c.name)}</span>
        <div>
          <h1>{c.name}</h1>
          <p>
            <span className="badge neutral">
              {c.kind === "person" ? "Person" : "Organization"}
            </span>
            {c.archivedAt && <span className="badge error">Archived</span>}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          <Button onClick={() => setNewEvent(true)}>
            <Plus size={16} />
            New Event
          </Button>
          {c.archivedAt ? (
            <Button
              variant="outline"
              onClick={async () =>
                client.replace(await clientsApi.setArchived(c.id, false))
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
        </div>
      </div>
      {c.possibleDuplicateOf && (
        <p role="note" className="demo-callout">
          Possible duplicate of{" "}
          <Link to={`/clients/${c.possibleDuplicateOf.id}`}>
            {c.possibleDuplicateOf.name}
          </Link>
          , created by a salesperson who can't see that client.
        </p>
      )}
      <Tabs
        tabs={["Overview", "Contacts", "Events", "Files"]}
        value={tab}
        onChange={setTab}
      />
      <div role="tabpanel" id="record-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "Overview" && (
          <div className="detail-grid">
            <Section title="Client information">
              <div className="info-grid">
                <div>
                  <small>Tags</small>
                  <strong>{c.tags.join(", ") || "None"}</strong>
                </div>
                <div>
                  <small>Contacts</small>
                  <strong>{c.contacts.length}</strong>
                </div>
              </div>
              <h3 className="form-subheading">Notes</h3>
              <p>{c.notes || "No notes yet."}</p>
            </Section>
            <Section title="Upcoming events">
              <EventTable events={events.data ?? []} error={events.error} />
            </Section>
          </div>
        )}
        {tab === "Contacts" && (
          <Section title="Contacts">
            {c.contacts.length ? (
              c.contacts.map((contact) => (
                <div className="contact-profile" key={contact.id}>
                  <span className="avatar">{initials(contact.name)}</span>
                  <div>
                    <strong>{contact.name}</strong>
                    <small>
                      {contactRoleLabels[contact.role]} ·{" "}
                      {hidden(contact.email)} · {hidden(contact.phone)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No contacts"
                description="Add contacts from Edit."
              />
            )}
          </Section>
        )}
        {tab === "Events" && (
          <EventTable events={events.data ?? []} error={events.error} />
        )}
        {tab === "Files" && (
          <Attachments recordType="client" recordId={c.id} title="Client files" />
        )}
      </div>
      {edit && (
        <ClientForm
          client={c}
          onClose={() => setEdit(false)}
          onSaved={client.replace}
        />
      )}
      {newEvent && (
        <EventForm
          clientId={c.id}
          onClose={() => setNewEvent(false)}
          onSaved={(event) => navigate(`/events/${event.id}`)}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title="Archive this client?"
        onConfirm={async () => {
          await clientsApi.setArchived(c.id, true);
          setArchive(false);
          navigate("/clients");
        }}
      >
        {c.name} will be hidden from the client list. You can restore it from
        Show archived.
      </ConfirmationDialog>
    </>
  );
}
