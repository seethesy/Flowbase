import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Plus,
  ArrowUpRight,
  Mail,
  Phone,
  MapPin,
  MoreHorizontal,
  Pencil,
  Building2,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useDemo } from "../app/store";
import type { Client, Proposal } from "../types";
import { employees, contacts, events } from "../data/mock/fixtures";
import { date, money } from "../services/records";
import {
  PageHeader,
  Button,
  SearchInput,
  Select,
  FilterBar,
  DataTable,
  StatusBadge,
  Tabs,
  Section,
  Notes,
  FileList,
  ConfirmationDialog,
  EmptyState,
} from "../components/shared";
import { RecordForm } from "./forms";
import { ProposalDrawer } from "./proposals";
export const initials = (name: string) =>
  name
    .replace(/&/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
export function ClientList() {
  const store = useDemo();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [owner, setOwner] = useState("");
  const [create, setCreate] = useState(false);
  const data = store.clients.records.filter(
    (c) =>
      (c.name + " " + c.contact).toLowerCase().includes(search.toLowerCase()) &&
      (!status || c.status === status) &&
      (!owner || c.owner === owner),
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
        </span>
      ),
    },
    { accessorKey: "contact", header: "Contact" },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "phone", header: "Phone" },
    {
      accessorKey: "status",
      header: "Status",
      cell: (c) => <StatusBadge status={c.getValue() as string} />,
    },
    {
      id: "open",
      header: "Open proposals",
      accessorFn: (c) =>
        store.proposals.records.filter(
          (x) => x.clientId === c.id && !["Signed", "Lost"].includes(x.stage),
        ).length,
    },
    { accessorKey: "owner", header: "Account owner" },
    {
      accessorKey: "activity",
      header: "Last activity",
      cell: (c) => date(c.getValue() as string),
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
      <div className="module-summary">
        <div>
          <strong>{store.clients.records.length}</strong>
          <span>total clients</span>
        </div>
        <div>
          <strong>
            {store.clients.records.filter((c) => c.status === "Active").length}
          </strong>
          <span>active relationships</span>
        </div>
        <div>
          <strong>
            {
              store.clients.records.filter((c) => c.status === "Prospect")
                .length
            }
          </strong>
          <span>new opportunities</span>
        </div>
      </div>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search clients or contacts…"
        />
        <Select
          label="Statuses"
          options={["Active", "Prospect", "Inactive"]}
          value={status}
          onChange={setStatus}
        />
        <Select
          label="Owners"
          options={employees.map((e) => e.name)}
          value={owner}
          onChange={setOwner}
        />
        <span className="result-count">{data.length} clients</span>
      </FilterBar>
      <DataTable
        data={data}
        columns={columns}
        onRow={(c) => navigate(`/clients/${c.id}`)}
        label="clients"
      />
      {create && <RecordForm kind="client" onClose={() => setCreate(false)} />}
    </>
  );
}
export function RelatedProposals({
  clientId,
  onOpen,
}: {
  clientId: string;
  onOpen: (id: string) => void;
}) {
  const store = useDemo();
  const rows = store.proposals.records.filter((c) => c.clientId === clientId);
  const cols: ColumnDef<Proposal, unknown>[] = [
    { accessorKey: "name", header: "Proposal" },
    {
      accessorKey: "stage",
      header: "Status",
      cell: (c) => <StatusBadge status={c.getValue() as string} />,
    },
    {
      accessorKey: "value",
      header: "Value",
      cell: (c) => money(c.getValue() as number),
    },
  ];
  return (
    <DataTable
      data={rows}
      columns={cols}
      onRow={(c) => onOpen(c.id)}
      label="proposals"
    />
  );
}
export function ClientDetail() {
  const { id } = useParams();
  const store = useDemo();
  const c = store.clients.find(id!);
  const navigate = useNavigate();
  const [tab, setTab] = useState("Overview");
  const [edit, setEdit] = useState(false);
  const [create, setCreate] = useState(false);
  const [archive, setArchive] = useState(false);
  const [menu, setMenu] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  if (!c)
    return (
      <EmptyState
        title="Client not found"
        description="This demo record may have been archived."
      />
    );
  const relatedEvents = events.filter((e) => e.clientId === c.id);
  const eventPanel = (
    <Section title="Upcoming events">
      {relatedEvents.length ? (
        relatedEvents.map((e) => (
          <div className="event-row" key={e.id}>
            <div className="event-date">
              <b>{e.date.slice(-2)}</b>
              <span>OCT</span>
            </div>
            <div>
              <strong>{e.name}</strong>
              <small>
                {e.location} · {e.guests} guests
              </small>
            </div>
          </div>
        ))
      ) : (
        <EmptyState
          title="No upcoming events"
          description="Future events for this client will appear here."
        />
      )}
    </Section>
  );
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
            <StatusBadge status={c.status} />
            <span>Account owner · {c.owner}</span>
          </p>
        </div>
        <div className="page-actions">
          <Button variant="outline" onClick={() => setEdit(true)}>
            <Pencil size={14} />
            Edit
          </Button>
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Proposal
          </Button>
          <div className="menu-wrap">
            <Button
              variant="outline"
              size="icon"
              aria-label="More client actions"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={18} />
            </Button>
            {menu && (
              <div className="dropdown">
                <button
                  onClick={() => {
                    setArchive(true);
                    setMenu(false);
                  }}
                >
                  Archive client
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Tabs
        tabs={["Overview", "Contacts", "Proposals", "Events", "Notes", "Files"]}
        value={tab}
        onChange={setTab}
      />
      <div role="tabpanel" id="record-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "Overview" && (
          <div className="detail-grid">
            <div>
              <Section title="Client information">
                <div className="info-row">
                  <Building2 size={17} />
                  <div>
                    <small>Company</small>
                    <strong>{c.name}</strong>
                  </div>
                </div>
                <div className="info-row">
                  <MapPin size={17} />
                  <div>
                    <small>Billing & contact address</small>
                    <strong>{c.address || "No address added"}</strong>
                  </div>
                </div>
                <div className="info-grid">
                  <div>
                    <small>Account owner</small>
                    <strong>{c.owner}</strong>
                  </div>
                  <div>
                    <small>Last activity</small>
                    <strong>{date(c.activity)}</strong>
                  </div>
                </div>
              </Section>
              <Section title="Main contact">
                <div className="contact-profile">
                  <span className="avatar">{initials(c.contact)}</span>
                  <div>
                    <strong>{c.contact}</strong>
                    <small>Primary contact</small>
                  </div>
                </div>
                <div className="info-row">
                  <Mail size={16} />
                  <span>{c.email}</span>
                </div>
                <div className="info-row">
                  <Phone size={16} />
                  <span>{c.phone || "No phone added"}</span>
                </div>
              </Section>
            </div>
            <div>
              <Section
                title="Recent proposals"
                action={
                  <button
                    className="text-link"
                    onClick={() => setTab("Proposals")}
                  >
                    View all <ArrowUpRight size={14} />
                  </button>
                }
              >
                <RelatedProposals clientId={c.id} onOpen={setProposal} />
              </Section>
              {eventPanel}
              <Section title="Recent activity">
                <p>Account reviewed by {c.owner}</p>
                <small className="muted">
                  {date(c.activity)} · Client information updated
                </small>
              </Section>
            </div>
          </div>
        )}
        {tab === "Contacts" && (
          <Section title="People at this company">
            {contacts
              .filter((p) => p.clientId === c.id)
              .map((p) => (
                <div className="contact-profile" key={p.id}>
                  <span className="avatar">{initials(p.name)}</span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.role} · {p.email}
                    </small>
                  </div>
                </div>
              ))}
          </Section>
        )}
        {tab === "Proposals" && (
          <RelatedProposals clientId={c.id} onOpen={setProposal} />
        )}{" "}
        {tab === "Events" && eventPanel}
        {tab === "Notes" && (
          <Notes
            notes={c.notes}
            onAdd={async (text) => {
              await store.clients.save({
                ...c,
                notes: [
                  { text, date: new Date().toLocaleString() },
                  ...c.notes,
                ],
              });
              store.notify("Note added to this demo client.");
            }}
          />
        )}
        {tab === "Files" && (
          <Section title="Client files">
            <FileList />
          </Section>
        )}
      </div>
      {edit && (
        <RecordForm kind="client" record={c} onClose={() => setEdit(false)} />
      )}{" "}
      {create && (
        <RecordForm
          kind="proposal"
          clientId={c.id}
          onClose={() => setCreate(false)}
        />
      )}{" "}
      {proposal && (
        <ProposalDrawer id={proposal} onClose={() => setProposal(null)} />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title="Archive this client?"
        onConfirm={async () => {
          await store.clients.save({ ...c, status: "Inactive" });
          store.notify("Client archived in demo memory.");
          setArchive(false);
          navigate("/clients");
        }}
      >
        This marks {c.name} inactive in the current demo session. Related
        proposals remain available.
      </ConfirmationDialog>
    </>
  );
}
