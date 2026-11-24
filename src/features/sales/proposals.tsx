import { Dropdown } from "../../components/ui/Dropdown";
import { useState, useEffect, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useResource } from "../../app/useResource";
import { proposalsApi } from "../../services/proposals";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Plus,
  LayoutGrid,
  List,
  CalendarDays,
  GripVertical,
  MoreHorizontal,
  Flag,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useDemo } from "../../app/store";
import { stages, employees } from "../../data/mock/fixtures";
import type { Proposal, Stage } from "../../types";
import { money, date, transitionProposal } from "../../services/records";
import {
  PageHeader,
  Button,
  SearchInput,
  Select,
  FilterBar,
  DataTable,
  StatusBadge,
  DetailDrawer,
  FormField,
  FileList,
  EmptyState,
} from "../../components/shared";
import { RecordForm } from "../common/forms";
import { T, useCopy } from "../../app/copy";
import "./proposals.css";
export function ProposalDrawer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const store = useDemo();
  const c = store.proposals.find(id);
  const [edit, setEdit] = useState(false);
  const [target, setTarget] = useState<Stage>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!c) return null;
  const update = async (stage: Stage, lossReason?: string) => {
    try {
      await store.proposals.save(transitionProposal(c, stage, lossReason));
      store.notify(`Proposal moved to ${stage} · simulated.`);
      setTarget(undefined);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <DetailDrawer open onClose={onClose} title={c.name} wide>
        <div className="record-meta">
          <span>{c.id}</span>
          <StatusBadge status={c.stage} />
        </div>
        <h2 className="proposal-value">{money(c.value)}</h2>
        <p>{store.clients.find(c.clientId)?.name}</p>
        <div className="info-grid">
          <div>
            <small><T id="proposals.proposal-drawer.event-date">Event date</T></small>
            <strong>{date(c.eventDate)}</strong>
          </div>
          <div>
            <small><T id="proposals.proposal-drawer.owner">Owner</T></small>
            <strong>{c.owner}</strong>
          </div>
          <div>
            <small><T id="proposals.proposal-drawer.date-sent">Date sent</T></small>
            <strong>{date(c.sent)}</strong>
          </div>
          <div>
            <small><T id="proposals.proposal-drawer.last-updated">Last updated</T></small>
            <strong>{date(c.updated)}</strong>
          </div>
        </div>
        <FormField label={<T id="proposals.proposal-drawer.proposal-stage">Proposal stage</T>}>
          <Dropdown
            aria-label="Proposal stage"
            value={c.stage}
            onChange={(e) => {
              const stage = e.target.value as Stage;
              if (stage === "Lost") {
                setTarget(stage);
                setError("");
              } else update(stage);
            }}
          >
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Dropdown>
        </FormField>
        {target === "Lost" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              update("Lost", reason);
            }}
          >
            <p className="demo-callout">
              <T id="proposals.proposal-drawer.confirm-marking-this-proposal-lost">Confirm marking this proposal Lost. A loss reason is required.</T>
            </p>
            <FormField label={<T id="proposals.proposal-drawer.loss-reason">Loss reason</T>}>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </FormField>
            <div className="form-actions">
              <Button
                variant="outline"
                type="button"
                onClick={() => setTarget(undefined)}
              >
                <T id="proposals.proposal-drawer.cancel-loss">Cancel loss</T>
              </Button>
              <Button variant="destructive"><T id="proposals.proposal-drawer.confirm-lost">Confirm Lost</T></Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {c.lossReason && (
          <p className="demo-callout"><T id="proposals.proposal-drawer.loss-reason-2" values={{ lossReason: c.lossReason }}>{"Loss reason: {lossReason}"}</T></p>
        )}
        <Button variant="outline" onClick={() => setEdit(true)}>
          <T id="proposals.proposal-drawer.edit-proposal">Edit proposal</T>
        </Button>
        <h3 className="spaced"><T id="proposals.proposal-drawer.attachments">Attachments</T></h3>
        <FileList />
      </DetailDrawer>
      {edit && (
        <RecordForm kind="proposal" record={c} onClose={() => setEdit(false)} />
      )}
    </>
  );
}
function ProposalCard({
  proposal,
  onOpen,
}: {
  proposal: Proposal;
  onOpen: () => void;
}) {
  const store = useDemo();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: proposal.id });
  return (
    <article
      ref={setNodeRef}
      className={`proposal-card ${isDragging ? "dragging" : ""}`}
      style={
        transform
          ? { transform: `translate(${transform.x}px,${transform.y}px)` }
          : undefined
      }
    >
      <div className="proposal-card-top">
        <span>{proposal.id}</span>
        <div>
          {proposal.priority && <Flag size={13} className="priority" />}
          <button
            aria-label={`Drag ${proposal.name}`}
            className="drag-handle"
            {...listeners}
            {...attributes}
          >
            <GripVertical size={15} />
          </button>
        </div>
      </div>
      <button className="proposal-card-title" onClick={onOpen}>
        {proposal.name}
      </button>
      <p>{store.clients.find(proposal.clientId)?.name}</p>
      <strong>{money(proposal.value)}</strong>
      <div className="proposal-card-footer">
        <span>
          <CalendarDays size={13} />
          {date(proposal.eventDate).replace(", 2026", "")}
        </span>
        <span className="avatar tiny" title={proposal.owner}>
          {proposal.owner
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </span>
        <button aria-label={`Details for ${proposal.id}`} onClick={onOpen}>
          <MoreHorizontal size={17} />
        </button>
      </div>
    </article>
  );
}
function KanbanColumn({
  stage,
  count,
  total,
  children,
}: {
  stage: Stage;
  count: number;
  total: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${isOver ? "drop-active" : ""}`}
    >
      <div className="kanban-heading">
        <div>
          <span className={`stage-dot stage-${stage}`} />
          <h2>{stage}</h2>
          <span className="count">{count}</span>
        </div>
        <span>{money(total)}</span>
      </div>
      <div className="kanban-cards">{children}</div>
    </section>
  );
}
export function Proposals() {
  const searchProposalsPlaceholder = useCopy("proposals.proposals.search-proposals.placeholder", "Search proposals…");
  const store = useDemo();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const query = params.get("q") ?? "";
  useEffect(() => {
    setSearch(query);
  }, [query]);
  const [owner, setOwner] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const stage = params.get("stage") ?? "";
  const view = params.get("view") ?? "pipeline";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const rows = store.proposals.records.filter(
    (c) =>
      (c.name + " " + c.id + " " + store.clients.find(c.clientId)?.name)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!params.get("open") || !["Signed", "Lost"].includes(c.stage)) &&
      (!stage || c.stage === stage) &&
      (!owner || c.owner === owner) &&
      (!eventDate || c.eventDate >= eventDate),
  );
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const drop = async ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const c = store.proposals.find(String(active.id));
    if (!c) return;
    if (over.id === "Lost" && c.stage !== "Lost") {
      setSelected(c.id);
      store.notify(
        "Choose Lost in proposal details and enter a loss reason to confirm.",
      );
      return;
    }
    try {
      await store.proposals.save(transitionProposal(c, over.id as Stage));
      store.notify(`Moved to ${over.id} · simulated.`);
    } catch (e) {
      store.notify((e as Error).message);
    }
  };
  const columns: ColumnDef<Proposal, unknown>[] = [
    { accessorKey: "id", header: "Proposal number", meta: { edit: "none" } },
    { accessorKey: "name", header: "Proposal name", meta: { edit: "text", onEdit: (row, value) => store.proposals.save({ ...row, name: value }) } },
    {
      id: "client",
      header: "Client",
      accessorFn: (c) => store.clients.find(c.clientId)?.name,
    },
    {
      accessorKey: "value",
      header: "Value",
      cell: (c) => money(c.getValue() as number),
      meta: { edit: "number", onEdit: (row, value) => store.proposals.save({ ...row, value: Number(value) }) },
    },
    {
      accessorKey: "stage",
      header: "Status",
      cell: (c) => <StatusBadge status={c.getValue() as string} />,
    },
    {
      accessorKey: "sent",
      header: "Date sent",
      cell: (c) => date(c.getValue() as string),
    },
    {
      accessorKey: "eventDate",
      header: "Event date",
      cell: (c) => date(c.getValue() as string),
      meta: { edit: "date", onEdit: (row, value) => store.proposals.save({ ...row, eventDate: value }) },
    },
    { accessorKey: "owner", header: "Owner", meta: { edit: "select", editValue: (row) => row.owner,
      editOptions: employees.map((person) => ({ value: person.name, label: person.name })),
      onEdit: (row, value) => store.proposals.save({ ...row, owner: value }) } },
    { accessorKey: "updated", header: "Last updated", meta: { edit: "none" } },
  ];
  return (
    <>
      <PageHeader
        title={<T id="proposals.proposals.proposals">Proposals</T>}
        subtitle={<T id="proposals.proposals.keep-every-opportunity-moving-forward">Keep every opportunity moving forward.</T>}
        eyebrow={<T id="proposals.proposals.your-business-connected">YOUR BUSINESS, CONNECTED</T>}
      >
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          <T id="proposals.proposals.new-proposal">New Proposal</T>
        </Button>
      </PageHeader>
      <OpenAddendums />
      <div className="module-summary">
        <div>
          <strong>
            {
              store.proposals.records.filter(
                (c) => !["Signed", "Lost"].includes(c.stage),
              ).length
            }
          </strong>
          <span><T id="proposals.proposals.open-opportunities">open opportunities</T></span>
        </div>
        <div>
          <strong>
            {money(
              store.proposals.records
                .filter((c) => !["Signed", "Lost"].includes(c.stage))
                .reduce((a, c) => a + c.value, 0),
            )}
          </strong>
          <span><T id="proposals.proposals.in-your-pipeline">in your pipeline</T></span>
        </div>
        <div>
          <strong>
            {store.proposals.records.filter((c) => c.stage === "Signed").length}
          </strong>
          <span><T id="proposals.proposals.proposals-won-this-month">proposals won this month</T></span>
        </div>
      </div>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchProposalsPlaceholder} copyId="proposals.proposals.search-proposals.placeholder"
        />
        <Select
          label="Owners"
          value={owner}
          onChange={setOwner}
          options={employees.map((e) => e.name)}
        />
        <Select
          label="Stages"
          value={stage}
          onChange={(v) => change("stage", v)}
          options={stages}
        />
        <label className="date-filter">
          <T id="proposals.proposals.events-from">{"Events from "}</T>
          <input
            aria-label="Events from"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </label>
        <div className="view-toggle">
          <Button
            variant={view === "pipeline" ? "default" : "ghost"}
            onClick={() => change("view", "pipeline")}
          >
            <LayoutGrid size={15} />
            <T id="proposals.proposals.pipeline">Pipeline</T>
          </Button>
          <Button
            variant={view === "table" ? "default" : "ghost"}
            onClick={() => change("view", "table")}
          >
            <List size={15} />
            <T id="proposals.proposals.table">Table</T>
          </Button>
        </div>
      </FilterBar>
      {view === "table" ? (
        <DataTable copyKey="proposals.proposals" openColumn
          data={rows}
          columns={columns}
          onRow={(c) => setSelected(c.id)}
          label={<T id="proposals.proposals.proposals-2">proposals</T>}
        />
      ) : (
        <>
          <p className="board-hint">
            <T id="proposals.proposals.drag-cards-to-move-stages">Drag cards to move stages, or open a card to update its status with the keyboard.</T>
          </p>
          <DndContext sensors={sensors} onDragEnd={drop}>
            <div className="kanban-board">
              {stages
                .filter((s) => !stage || stage === s)
                .map((s) => (
                  <KanbanColumn
                    key={s}
                    stage={s}
                    count={rows.filter((c) => c.stage === s).length}
                    total={rows
                      .filter((c) => c.stage === s)
                      .reduce((a, c) => a + c.value, 0)}
                  >
                    {rows
                      .filter((c) => c.stage === s)
                      .map((c) => (
                        <ProposalCard
                          key={c.id}
                          proposal={c}
                          onOpen={() => setSelected(c.id)}
                        />
                      ))}
                    {!rows.some((c) => c.stage === s) && (
                      <EmptyState
                        title={<T id="proposals.proposals.no-proposals">No proposals</T>}
                        description={<T id="proposals.proposals.this-stage-is-ready-for">This stage is ready for its next opportunity.</T>}
                      />
                    )}
                  </KanbanColumn>
                ))}
            </div>
          </DndContext>
        </>
      )}
      {create && (
        <RecordForm kind="proposal" onClose={() => setCreate(false)} />
      )}{" "}
      {selected && (
        <ProposalDrawer id={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function OpenAddendums() {
  const pending = useResource(["open-addendums"], proposalsApi.openAddendums);
  if (!pending.data?.length) return null;
  return <section className="table-card" aria-label="Open addendums" style={{ padding: 16, marginBottom: 16 }}>
    <h2><T id="proposals.open-addendums.open-addendums">Open addendums</T></h2>
    <ul>{pending.data.map((row) => <li key={row.id}><Link to={`/events/${row.eventId}?proposal=${row.proposalId}`}><T id="proposals.open-addendums.sent-proposal-version" values={{ eventTitle: row.eventTitle, toLocaleDateString: new Date(row.sentAt).toLocaleDateString(), proposalVersionId: row.proposalVersionId }}>{"{eventTitle} · sent {toLocaleDateString} · proposal version {proposalVersionId}"}</T></Link></li>)}</ul>
  </section>;
}
