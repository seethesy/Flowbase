import { useState, useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
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
import { useDemo } from "../app/store";
import { stages, employees } from "../data/mock/fixtures";
import type { Contract, Stage } from "../types";
import { money, date, transitionContract } from "../services/records";
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
} from "../components/shared";
import { RecordForm } from "./forms";
export function ContractDrawer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const store = useDemo();
  const c = store.contracts.get(id);
  const [edit, setEdit] = useState(false);
  const [target, setTarget] = useState<Stage>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!c) return null;
  const update = (stage: Stage, lossReason?: string) => {
    try {
      store.contracts.save(transitionContract(c, stage, lossReason));
      store.notify(`Contract moved to ${stage} · simulated.`);
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
        <h2 className="contract-value">{money(c.value)}</h2>
        <p>{store.customers.get(c.customerId)?.name}</p>
        <div className="info-grid">
          <div>
            <small>Event date</small>
            <strong>{date(c.eventDate)}</strong>
          </div>
          <div>
            <small>Owner</small>
            <strong>{c.owner}</strong>
          </div>
          <div>
            <small>Date sent</small>
            <strong>{date(c.sent)}</strong>
          </div>
          <div>
            <small>Last updated</small>
            <strong>{date(c.updated)}</strong>
          </div>
        </div>
        <FormField label="Contract stage">
          <select
            aria-label="Contract stage"
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
          </select>
        </FormField>
        {target === "Lost" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update("Lost", reason);
            }}
          >
            <p className="demo-callout">
              Confirm marking this contract Lost. A loss reason is required.
            </p>
            <FormField label="Loss reason">
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
                Cancel loss
              </Button>
              <Button variant="destructive">Confirm Lost</Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {c.lossReason && (
          <p className="demo-callout">Loss reason: {c.lossReason}</p>
        )}
        <Button variant="outline" onClick={() => setEdit(true)}>
          Edit contract
        </Button>
        <h3 className="spaced">Attachments</h3>
        <FileList />
      </DetailDrawer>
      {edit && (
        <RecordForm kind="contract" record={c} onClose={() => setEdit(false)} />
      )}
    </>
  );
}
export function ContractCard({
  contract,
  onOpen,
}: {
  contract: Contract;
  onOpen: () => void;
}) {
  const store = useDemo();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: contract.id });
  return (
    <article
      ref={setNodeRef}
      className={`contract-card ${isDragging ? "dragging" : ""}`}
      style={
        transform
          ? { transform: `translate(${transform.x}px,${transform.y}px)` }
          : undefined
      }
    >
      <div className="contract-card-top">
        <span>{contract.id}</span>
        <div>
          {contract.priority && <Flag size={13} className="priority" />}
          <button
            aria-label={`Drag ${contract.name}`}
            className="drag-handle"
            {...listeners}
            {...attributes}
          >
            <GripVertical size={15} />
          </button>
        </div>
      </div>
      <button className="contract-card-title" onClick={onOpen}>
        {contract.name}
      </button>
      <p>{store.customers.get(contract.customerId)?.name}</p>
      <strong>{money(contract.value)}</strong>
      <div className="contract-card-footer">
        <span>
          <CalendarDays size={13} />
          {date(contract.eventDate).replace(", 2026", "")}
        </span>
        <span className="avatar tiny" title={contract.owner}>
          {contract.owner
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </span>
        <button aria-label={`Details for ${contract.id}`} onClick={onOpen}>
          <MoreHorizontal size={17} />
        </button>
      </div>
    </article>
  );
}
export function KanbanColumn({
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
export function Contracts() {
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
  const rows = store.contracts
    .list()
    .filter(
      (c) =>
        (c.name + " " + c.id + " " + store.customers.get(c.customerId)?.name)
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
  const drop = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const c = store.contracts.get(String(active.id));
    if (!c) return;
    if (over.id === "Lost" && c.stage !== "Lost") {
      setSelected(c.id);
      store.notify(
        "Choose Lost in contract details and enter a loss reason to confirm.",
      );
      return;
    }
    try {
      store.contracts.save(transitionContract(c, over.id as Stage));
      store.notify(`Moved to ${over.id} · simulated.`);
    } catch (e) {
      store.notify((e as Error).message);
    }
  };
  const columns: ColumnDef<Contract, unknown>[] = [
    { accessorKey: "id", header: "Contract number" },
    { accessorKey: "name", header: "Contract name" },
    {
      id: "customer",
      header: "Customer",
      accessorFn: (c) => store.customers.get(c.customerId)?.name,
    },
    {
      accessorKey: "value",
      header: "Value",
      cell: (c) => money(c.getValue() as number),
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
    },
    { accessorKey: "owner", header: "Owner" },
    { accessorKey: "updated", header: "Last updated" },
  ];
  return (
    <>
      <PageHeader
        title="Contracts"
        subtitle="Keep every opportunity moving forward."
        eyebrow="YOUR BUSINESS, CONNECTED"
      >
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          New Contract
        </Button>
      </PageHeader>
      <div className="module-summary">
        <div>
          <strong>
            {
              store.contracts
                .list()
                .filter((c) => !["Signed", "Lost"].includes(c.stage)).length
            }
          </strong>
          <span>open opportunities</span>
        </div>
        <div>
          <strong>
            {money(
              store.contracts
                .list()
                .filter((c) => !["Signed", "Lost"].includes(c.stage))
                .reduce((a, c) => a + c.value, 0),
            )}
          </strong>
          <span>in your pipeline</span>
        </div>
        <div>
          <strong>
            {store.contracts.list().filter((c) => c.stage === "Signed").length}
          </strong>
          <span>contracts won this month</span>
        </div>
      </div>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search contracts…"
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
          Events from{" "}
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
            Pipeline
          </Button>
          <Button
            variant={view === "table" ? "default" : "ghost"}
            onClick={() => change("view", "table")}
          >
            <List size={15} />
            Table
          </Button>
        </div>
      </FilterBar>
      {view === "table" ? (
        <DataTable
          data={rows}
          columns={columns}
          onRow={(c) => setSelected(c.id)}
          label="contracts"
        />
      ) : (
        <>
          <p className="board-hint">
            Drag cards to move stages, or open a card to update its status with
            the keyboard.
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
                        <ContractCard
                          key={c.id}
                          contract={c}
                          onOpen={() => setSelected(c.id)}
                        />
                      ))}
                    {!rows.some((c) => c.stage === s) && (
                      <EmptyState
                        title="No contracts"
                        description="This stage is ready for its next opportunity."
                      />
                    )}
                  </KanbanColumn>
                ))}
            </div>
          </DndContext>
        </>
      )}
      {create && (
        <RecordForm kind="contract" onClose={() => setCreate(false)} />
      )}{" "}
      {selected && (
        <ContractDrawer id={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
