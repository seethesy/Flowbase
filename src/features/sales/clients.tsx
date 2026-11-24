import { useDeletable } from "../../app/live-edit/deletable";
import { Dropdown } from "../../components/ui/Dropdown";
import { Allowed, usePermissions } from "../../app/permissions";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { FieldCard, useShownFields } from "../../app/live-edit/field-card";
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
} from "../../../shared/core-records";
import {
  allPages,
  ApiRequestError,
  clientsApi,
  eventsApi,
} from "../../services/core";
import { useResource } from "../../app/useResource";
import { useOpenFor } from "../../app/useOpenFor";
import { LoadMore, useDebounced, usePagedList } from "../../app/paging";
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
  ErrorText,
} from "../../components/shared";
import { EventTable } from "../events/event-list";
import { Attachments } from "../common/attachments";
import { CommunicationLog } from "../common/communications";
import { StaleReload, isStale } from "../../components/stale-reload";
import { ClientSalesTracker } from "./sales";
import "./clients.css";

import { initials, hidden } from "../../components/record-display";
import { RoundCheck } from "../../components/ui/round-check";
import { T, useCopy, LabelT } from "../../app/copy";

const primaryContact = (client: Client) =>
  client.contacts.find((contact) => contact.role === "primary_poc") ??
  client.contacts[0];

// Real client records (FLOW-53), replacing the prototype's mock clients.
export function ClientList() {
  const { can } = usePermissions();
  const searchClientsOrContactsPlaceholder = useCopy("clients.client-list.search-clients-or-contacts.placeholder", "Search clients or contacts…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  // The API searches client and contact names across every client (FLOW-179).
  const term = useDebounced(search.trim());
  const clients = usePagedList(
    ["clients", "list", archived, term],
    (cursor) =>
      clientsApi.list({ archived, search: term || undefined }, cursor),
  );
  const deletable = useDeletable("client", () => clients.reload());
  const data = clients.data ?? [];
  const editClient = async (client: Client, change: { name?: string; kind?: Client["kind"]; tags?: string[];
    contactName?: string; contactEmail?: string; contactPhone?: string }) => {
    const current = await clientsApi.get(client.id);
    await clientsApi.update(client.id, {
      name: change.name ?? current.name, kind: change.kind ?? current.kind,
      assignedSalespersonId: current.assignedSalespersonId,
      notes: current.notes, tags: change.tags ?? current.tags,
      contacts: current.contacts.map((contact) => ({ id: contact.id,
        name: contact.id === primaryContact(current)?.id ? change.contactName ?? contact.name : contact.name,
        role: contact.role, notes: contact.notes,
        ...(contact.email !== null && { email: change.contactEmail !== undefined && contact.id === primaryContact(current)?.id ? change.contactEmail : contact.email }),
        ...(contact.phone !== null && { phone: change.contactPhone !== undefined && contact.id === primaryContact(current)?.id ? change.contactPhone : contact.phone }) })),
      updatedAt: current.updatedAt,
    });
    clients.reload();
  };
  const columns: ColumnDef<Client, unknown>[] = [
    {
      accessorKey: "name",
      header: "Client",
      meta: { edit: "text", canEdit: () => can("clients.write"), onEdit: (row, value) => editClient(row, { name: value }) },
      cell: (c) => (
        <span className="company-cell">
          <span className="company-avatar">
            {initials(c.row.original.name)}
          </span>
          <strong>{c.getValue() as string}</strong>
          {c.row.original.possibleDuplicateOf && (
            <span className="badge warning"><T id="clients.client-list.possible-duplicate">Possible duplicate</T></span>
          )}
        </span>
      ),
    },
    {
      id: "kind",
      header: "Type",
      accessorFn: (client) =>
        client.kind === "person" ? "Person" : "Organization",
      meta: { edit: "select", canEdit: () => can("clients.write"), editValue: (row) => row.kind,
        editOptions: [{ value: "person", label: "Person" }, { value: "organization", label: "Organization" }],
        onEdit: (row, value) => editClient(row, { kind: value === "person" ? "person" : "organization" }) },
      cell: ({ row }) =>
        row.original.kind === "person" ? <T id="clients.client-list.person">Person</T> : <T id="clients.client-list.organization">Organization</T>,
    },
    {
      id: "contact",
      header: "Primary contact",
      accessorFn: (client) => primaryContact(client)?.name ?? "—",
      meta: { edit: "text", canEdit: (row) => can("clients.write") && Boolean(primaryContact(row)),
        onEdit: (row, value) => editClient(row, { contactName: value }) },
    },
    {
      id: "email",
      header: "Email",
      accessorFn: (client) => {
        const contact = primaryContact(client);
        return contact ? hidden(contact.email) : "—";
      },
      meta: {
        fieldGroup: "client_contact",
        csv: (client) => primaryContact(client)?.email ?? "",
        editValue: (row) => primaryContact(row)?.email ?? "",
        edit: "text", canEdit: (row) => can("clients.write") && primaryContact(row)?.email != null,
        onEdit: (row, value) => editClient(row, { contactEmail: value }),
      },
    },
    {
      id: "phone",
      header: "Phone",
      accessorFn: (client) => {
        const contact = primaryContact(client);
        return contact ? hidden(contact.phone) : "—";
      },
      meta: {
        fieldGroup: "client_contact",
        csv: (client) => primaryContact(client)?.phone ?? "",
        editValue: (row) => primaryContact(row)?.phone ?? "",
        edit: "text", canEdit: (row) => can("clients.write") && primaryContact(row)?.phone != null,
        onEdit: (row, value) => editClient(row, { contactPhone: value }),
      },
    },
    {
      id: "tags",
      header: "Tags",
      accessorFn: (client) => client.tags.join(", "),
      meta: { edit: "text", canEdit: () => can("clients.write"),
        onEdit: (row, value) => editClient(row, { tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) }) },
    },
  ];
  return (
    <>
      <PageHeader pageKey="clients.list"
        title={<T id="clients.client-list.clients">Clients</T>}
        subtitle={<T id="clients.client-list.good-relationships-start-with-the">Good relationships start with the little details.</T>}
        eyebrow={<T id="clients.client-list.clients">Clients</T>}
      >
        <Allowed action="clients.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="clients.client-list.new-client">New Client</T>
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchClientsOrContactsPlaceholder} copyId="clients.client-list.search-clients-or-contacts.placeholder"
        />
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="clients.client-list.show-archived">Show archived</T>
        </label>
        <span className="result-count">
          {clients.hasMore ? <T id="clients.client-list.clients-2" values={{ dataCount: data.length }}>{"{dataCount}+ clients"}</T> : <T id="clients.client-list.clients-3" values={{ dataCount: data.length }}>{"{dataCount} clients"}</T>}
        </span>
      </FilterBar>
      {clients.error ? (
        <ErrorText message={clients.error} />
      ) : clients.loading && !clients.data ? (
        <LoadingSkeleton />
      ) : (
        <PageGrid pageKey="clients.list">
          <Block id="list" name="List" h={24}>
          <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="clients.client-list" openColumn
            data={data}
            columns={columns}
            onRow={(client) => navigate(`/clients/${client.id}`)}
            label={<T id="clients.client-list.clients-4">clients</T>}
            exportName="clients"
            exportAll={clients.loadAll}
          />
          <LoadMore list={clients} label={<T id="clients.client-list.load-more-clients">Load more clients</T>} />
        </Block>
          </PageGrid>
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

type ClientFormProps = {
  client?: Client;
  onClose: () => void;
  onSaved: (client: Client) => void;
};

// Edits reload the current version when the save was made from a stale copy
// (FLOW-186).
export function ClientForm(props: ClientFormProps) {
  return (
    <StaleReload
      record={props.client}
      load={(id) => clientsApi.get(id)}
      what="client"
    >
      {({ record, conflict, onStale }) => (
        <ClientFormFields
          key={record?.updatedAt ?? "new"}
          {...props}
          client={record}
          conflict={conflict}
          onStale={onStale}
        />
      )}
    </StaleReload>
  );
}

function ClientFormFields({
  client,
  onClose,
  onSaved,
  conflict,
  onStale,
}: ClientFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const shownFacts = useShownFields("clients.detail", "client-facts");
  const shows = (field: string) => !client || shownFacts(field);
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
          ? await clientsApi.update(client.id, {
              ...input,
              updatedAt: client.updatedAt,
            })
          : await clientsApi.create(input),
      );
      onClose();
    } catch (e) {
      if (client && isStale(e)) {
        await onStale();
        return;
      }
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
      title={client ? <T id="clients.client-form-fields.edit-client">Edit client</T> : <T id="clients.client-form-fields.new-client">New client</T>}
      description={<T id="clients.client-form-fields.saved-to-flowbase">Saved to Flowbase.</T>}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <ErrorText message={conflict} />
        <ErrorText message={error} />
        {duplicates.length > 0 && (
          <div role="alert" className="error-message">
            <p>
              <TriangleAlert size={14} /><T id="clients.client-form-fields.a-client-with-this-email">{" A client with this email or phone already exists:"}</T>
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
              <T id="clients.client-form-fields.create-anyway">Create anyway</T>
            </Button>
          </div>
        )}
        <FormField label={<T id="clients.client-form-fields.name">Name *</T>}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <div className="form-grid">
          <FormField label={<T id="clients.client-form-fields.type">Type</T>}>
            <Dropdown
              value={kind}
              onChange={(e) => setKind(e.target.value as Client["kind"])}
            >
              <option value="organization">Organization</option>
              <option value="person">Person</option>
            </Dropdown>
          </FormField>
          <FormField label={<T id="clients.client-form-fields.tags">Tags</T>} hint={<T id="clients.client-form-fields.separate-tags-with-commas">Separate tags with commas.</T>}>
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </FormField>
        </div>
        {shows("notes") && (<FormField label={<T id="clients.client-form-fields.notes">Notes</T>}>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
        )}
        <h3 className="form-subheading"><T id="clients.client-form-fields.contacts">Contacts</T></h3>
        {contacts.map((contact, index) => (
          <fieldset
            className="form-group"
            key={contact.key}
            aria-label={`Contact ${index + 1}`}
          >
            <div className="form-grid">
              <FormField label={<T id="clients.client-form-fields.contact-name">Contact name *</T>}>
                <input
                  value={contact.name}
                  onChange={(e) => update(contact.key, { name: e.target.value })}
                />
              </FormField>
              <FormField label={<T id="clients.client-form-fields.role">Role</T>}>
                <Dropdown
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
                </Dropdown>
              </FormField>
              {contact.hiddenDetails ? (
                <p className="muted">
                  <T id="clients.client-form-fields.email-and-phone-are-visible">Email and phone are visible to full-time staff only.</T>
                </p>
              ) : (
                <>
                  <FormField label={<T id="clients.client-form-fields.email">Email</T>}>
                    <input
                      type="email"
                      value={contact.email ?? ""}
                      onChange={(e) =>
                        update(contact.key, { email: e.target.value })
                      }
                    />
                  </FormField>
                  <FormField label={<T id="clients.client-form-fields.phone">Phone</T>}>
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
              <T id="clients.client-form-fields.remove-contact">Remove contact</T>
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
          <Plus size={14} /><T id="clients.client-form-fields.add-contact">{" Add contact"}</T>
        </Button>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="clients.client-form-fields.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="clients.client-form-fields.save-client">Save client</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

export function ClientDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useResource(
    ["clients", id],
    () => clientsApi.get(id),
  );
  const events = useResource(
    ["events", { clientId: id }, "all"],
    () => allPages((cursor) => eventsApi.list({ clientId: id }, cursor)),
  );
  const [tab, setTab] = useState("Overview");
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  if (client.error)
    return (
      <>
        <Link to="/clients" className="back-link">
          <T id="clients.client-detail.all-clients">← All clients</T>
        </Link>
        <ErrorText message={client.error} />
      </>
    );
  const c = client.data;
  if (!c) return <LoadingSkeleton />;
  return (
    <>
      <Link to="/clients" className="back-link">
        <T id="clients.client-detail.all-clients">← All clients</T>
      </Link>
      <div className="record-heading">
        <span className="company-avatar large">{initials(c.name)}</span>
        <div>
          <h1>{c.name}</h1>
          <p>
            <span className="badge neutral">
              {c.kind === "person" ? <T id="clients.client-detail.person">Person</T> : <T id="clients.client-detail.organization">Organization</T>}
            </span>
            {c.archivedAt && <span className="badge error"><T id="clients.client-detail.archived">Archived</T></span>}
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="clients.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              <T id="clients.client-detail.edit">Edit</T>
            </Button>
          </Allowed>
          {c.archivedAt ? (
            <Allowed action="clients.write">
              <Button
                variant="outline"
                onClick={async () =>
                  client.replace(await clientsApi.setArchived(c.id, false))
                }
              >
                <RotateCcw size={14} />
                <T id="clients.client-detail.restore">Restore</T>
              </Button>
            </Allowed>
          ) : (
            <Allowed action="clients.write">
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                <T id="clients.client-detail.archive">Archive</T>
              </Button>
            </Allowed>
          )}
        </div>
      </div>
      {c.possibleDuplicateOf && (
        <p role="note" className="demo-callout">
          <T id="clients.client-detail.possible-duplicate-of">{"Possible duplicate of "}</T>
          <Link to={`/clients/${c.possibleDuplicateOf.id}`}>
            {c.possibleDuplicateOf.name}
          </Link>
          <T id="clients.client-detail.created-by-a-salesperson-who">{", created by a salesperson who can't see that client."}</T>
        </p>
      )}
      <Tabs copyKey="clients.client-detail"
        tabs={["Overview", "Contacts", "Events", "Proposal tracker", "Communications", "Files"]}
        value={tab}
        onChange={setTab}
      />
      <div role="tabpanel" id="record-panel" aria-labelledby={`tab-${tab}`}>

        <div className="detail-grid">
          <PageGrid pageKey="clients.detail" record={{ source: "clients", id: c.id, row: c as unknown as Record<string, unknown> }}>
            {tab === "Overview" && (
              <Block id="client-facts" name="Client information" w={6} h={12}>
                <FieldCard cardKey="client-facts" source="clients" row={c as unknown as Record<string, unknown>}
                  title={<T id="clients.client-detail.client-information">Client information</T>}
                  fields={["name", "kind", "assignedSalespersonId", "notes", "createdAt"]}>
                  <Section title={<T id="clients.client-detail.client-information">Client information</T>}>
                    <div className="info-grid">
                      <div>
                        <small><T id="clients.client-detail.tags">Tags</T></small>
                        <strong>{c.tags.join(", ") || <T id="clients.client-detail.none">None</T>}</strong>
                      </div>
                      <div>
                        <small><T id="clients.client-detail.contacts">Contacts</T></small>
                        <strong>{c.contacts.length}</strong>
                      </div>
                    </div>
                    <h3 className="form-subheading"><T id="clients.client-detail.notes">Notes</T></h3>
                    <p>{c.notes || <T id="clients.client-detail.no-notes-yet">No notes yet.</T>}</p>
                  </Section>
                </FieldCard>
              </Block>
            )}
            {tab === "Overview" && (
              <Block id="upcoming-events" name="Upcoming events" w={6} h={12}>
                <Section title={<T id="clients.client-detail.upcoming-events">Upcoming events</T>}>
                  <EventTable events={events.data ?? []} error={events.error} onSaved={() => events.reload()} />
                </Section>
              </Block>
            )}
            {tab === "Contacts" && (
              <Block id="contacts" name="Contacts" w={12} h={12}>
                <Section title={<T id="clients.client-detail.contacts">Contacts</T>}>
                  {c.contacts.length ? (
                    c.contacts.map((contact) => (
                      <div className="contact-profile" key={contact.id}>
                        <span className="avatar">{initials(contact.name)}</span>
                        <div>
                          <strong>{contact.name}</strong>
                          <small>
                            <LabelT id="labels.contact-role" value={contact.role}>{contactRoleLabels[contact.role]}</LabelT> ·{" "}
                            {hidden(contact.email)} · {hidden(contact.phone)}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState
                      title={<T id="clients.client-detail.no-contacts">No contacts</T>}
                      description={<T id="clients.client-detail.add-contacts-from-edit">Add contacts from Edit.</T>}
                    />
                  )}
                </Section>
              </Block>
            )}
            {tab === "Events" && (
              <Block id="events" name="Events" w={12} h={12}>
                <EventTable events={events.data ?? []} error={events.error} onSaved={() => events.reload()} />
              </Block>
            )}
            {tab === "Proposal tracker" && (
              <Block id="proposal-tracker" name="Proposal tracker" w={12} h={14}>
                <ClientSalesTracker clientId={c.id} />
              </Block>
            )}
            {tab === "Communications" && (
              <Block id="communications" name="Communications" w={12} h={14}>
                <CommunicationLog target={{ clientId: c.id }} />
              </Block>
            )}
            {tab === "Files" && (
              <Block id="files" name="Files" w={12} h={12}>
                <Attachments recordType="client" recordId={c.id} title="Client files" />
              </Block>
            )}
          </PageGrid>
        </div>

      </div>
      {edit && (
        <ClientForm
          client={c}
          onClose={() => setEdit(false)}
          onSaved={client.replace}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="clients.client-detail.archive-this-client">Archive this client?</T>}
        onConfirm={async () => {
          await clientsApi.setArchived(c.id, true);
          setArchive(false);
          navigate("/clients");
        }}
      >
        <T id="clients.client-detail.will-be-hidden-from-the" values={{ name: c.name }}>{"{name} will be hidden from the client list. You can restore it from Show archived."}</T>
      </ConfirmationDialog>
    </>
  );
}
