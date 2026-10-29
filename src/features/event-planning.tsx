import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import { requirementBasisLabels, type Requirement } from "../../shared/allocation";
import {
  holdStatusLabels,
  resolutionMethodLabels,
  type Conflict,
  type Reservation,
  type ResolveInput,
} from "../../shared/reservations";
import { useResource } from "../app/useResource";
import { LoadError } from "../components/record-display";
import { Button, LoadingSkeleton, Section } from "../components/shared";
import { allPages, inventoryApi } from "../services/core";
import { planningApi } from "../services/planning";
import { date } from "./event-format";
import "./event-planning.css";

// What the event needs from the warehouse and the pantry (FLOW-76/77/85): the
// equipment it holds, the conflicts those holds are in, and the consumables it
// requires with what is short and when to order.

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });

export function EventPlanningSection({
  event,
  canEdit,
}: {
  event: FlowEvent;
  canEdit: boolean;
}) {
  const holds = useResource(["event-holds", event.id], () => planningApi.holds(event.id));
  const conflicts = useResource(["event-conflicts", event.id], () =>
    planningApi.eventConflicts(event.id),
  );
  const needs = useResource(["event-requirements", event.id], () =>
    planningApi.requirements(event.id),
  );
  const items = useResource(
    ["inventory-items", "all"],
    () => allPages((cursor) => inventoryApi.list({}, cursor)),
    { reference: true },
  );
  const [error, setError] = useState("");
  const failed = holds.error ?? conflicts.error ?? needs.error;
  if (failed)
    return (
      <Section title="Equipment & stock">
        <LoadError message={failed} />
      </Section>
    );
  if (!holds.data || !conflicts.data || !needs.data) return <LoadingSkeleton />;
  const rentals = (items.data ?? []).filter((item) => item.kind === "rental");
  const consumables = (items.data ?? []).filter((item) => item.kind === "consumable");
  const reloadAll = () => {
    holds.reload();
    conflicts.reload();
  };
  // Runs a change, then shows the fresh holds and conflicts.
  const act = async (run: () => Promise<unknown>) => {
    setError("");
    try {
      await run();
      reloadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const open = conflicts.data.filter((conflict) => conflict.state !== "resolved");
  return (
    <>
      <Section title="Equipment holds">
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {open.map((conflict) => (
          <ConflictCard
            key={conflict.id}
            conflict={conflict}
            canEdit={canEdit}
            rentals={rentals}
            onResolve={(input) =>
              act(() => planningApi.resolve(conflict.id, input))
            }
          />
        ))}
        <ul className="planning-list">
          {holds.data.map((hold) => (
            <HoldRow
              key={hold.id}
              hold={hold}
              canEdit={canEdit}
              onChange={(quantity) => act(() => planningApi.updateHold(hold.id, quantity))}
              onRemove={() => act(() => planningApi.removeHold(hold.id))}
            />
          ))}
          {!holds.data.length && <li className="muted">No equipment held yet.</li>}
        </ul>
        {canEdit && (
          <AddLine
            label="Hold equipment"
            options={rentals}
            onAdd={(itemId, quantity) =>
              act(() => planningApi.placeHold(event.id, { itemId, quantity }))
            }
          />
        )}
      </Section>
      <Section title="Consumable needs">
        <ul className="planning-list">
          {needs.data.map((need) => (
            <NeedRow
              key={`${need.itemId}:${need.source}`}
              need={need}
              canEdit={canEdit && need.source === "manual"}
              onRemove={() =>
                act(async () => {
                  await planningApi.setRequirements(event.id, {
                    lines: (needs.data ?? [])
                      .filter((line) => line.source === "manual" && line.itemId !== need.itemId)
                      .map(({ itemId, basis, quantity }) => ({ itemId, basis, quantity })),
                  });
                  needs.reload();
                })
              }
            />
          ))}
          {!needs.data.length && <li className="muted">No consumables required yet.</li>}
        </ul>
        {canEdit && (
          <AddLine
            label="Add need"
            options={consumables}
            allowPerGuest
            onAdd={(itemId, quantity, basis) =>
              act(async () => {
                const manual = (needs.data ?? [])
                  .filter((line) => line.source === "manual" && line.itemId !== itemId)
                  .map(({ itemId: id, basis: b, quantity: q }) => ({ itemId: id, basis: b, quantity: q }));
                await planningApi.setRequirements(event.id, {
                  lines: [...manual, { itemId, basis: basis ?? "fixed", quantity }],
                });
                needs.reload();
              })
            }
          />
        )}
      </Section>
    </>
  );
}

function HoldRow({
  hold,
  canEdit,
  onChange,
  onRemove,
}: {
  hold: Reservation;
  canEdit: boolean;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  const [quantity, setQuantity] = useState(String(hold.quantity));
  return (
    <li className="planning-row">
      <strong>{hold.itemName}</strong>
      <span className="muted">
        {holdStatusLabels[hold.status]} · {date(hold.windowStart)}–{date(hold.windowEnd)}
      </span>
      {hold.issue && (
        <span className={`planning-badge ${hold.issue}`}>
          {hold.issue === "conflict" ? "Conflict" : "Warning"}: {number(hold.shortfall)} short
        </span>
      )}
      {canEdit ? (
        <span className="planning-actions">
          <input
            aria-label={`Quantity of ${hold.itemName}`}
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => {
              const next = Number(quantity);
              if (next > 0 && next !== hold.quantity) onChange(next);
              else setQuantity(String(hold.quantity));
            }}
          />
          <Button variant="outline" aria-label={`Release ${hold.itemName}`} onClick={onRemove}>
            <Trash2 size={14} />
          </Button>
        </span>
      ) : (
        <span>{number(hold.quantity)}</span>
      )}
    </li>
  );
}

function NeedRow({
  need,
  canEdit,
  onRemove,
}: {
  need: Requirement;
  canEdit: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="planning-row">
      <strong>{need.itemName}</strong>
      <span className="muted">
        {number(need.quantity)} {need.unit}
        {need.basis === "per_guest" ? " per guest" : ""} → needs {number(need.required)} {need.unit}
      </span>
      {need.shortage !== null && need.shortage > 0 && (
        <span className="planning-badge conflict">
          Short {number(need.shortage)} {need.unit}
          {need.orderBy ? ` · order by ${date(need.orderBy)}` : ""}
        </span>
      )}
      {need.shortage === 0 && <span className="planning-badge ok">Covered</span>}
      {need.shortage === null && <span className="muted">Allocated once the event is Closed</span>}
      {canEdit && (
        <Button variant="outline" aria-label={`Remove ${need.itemName}`} onClick={onRemove}>
          <Trash2 size={14} />
        </Button>
      )}
    </li>
  );
}

function AddLine({
  label,
  options,
  allowPerGuest = false,
  onAdd,
}: {
  label: string;
  options: { id: string; name: string }[];
  allowPerGuest?: boolean;
  onAdd: (itemId: string, quantity: number, basis?: "fixed" | "per_guest") => void;
}) {
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [basis, setBasis] = useState<"fixed" | "per_guest">("fixed");
  return (
    <form
      className="planning-add"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        const amount = Number(quantity);
        if (!itemId || !(amount > 0)) return;
        onAdd(itemId, amount, basis);
        setItemId("");
        setQuantity("1");
      }}
    >
      <select aria-label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
        <option value="">Choose an item</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <input
        aria-label="Quantity"
        type="number"
        min={0}
        step="any"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      {allowPerGuest && (
        <select
          aria-label="Basis"
          value={basis}
          onChange={(e) => setBasis(e.target.value === "per_guest" ? "per_guest" : "fixed")}
        >
          {(["fixed", "per_guest"] as const).map((value) => (
            <option key={value} value={value}>
              {requirementBasisLabels[value]}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" variant="outline" disabled={!itemId}>
        <Plus size={14} />
        {label}
      </Button>
    </form>
  );
}

function ConflictCard({
  conflict,
  canEdit,
  rentals,
  onResolve,
}: {
  conflict: Conflict;
  canEdit: boolean;
  rentals: { id: string; name: string }[];
  onResolve: (input: ResolveInput) => void;
}) {
  const [method, setMethod] = useState<ResolveInput["method"]>("substitute");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const needsItem = method === "substitute" || method === "sub_rent";
  const submit = () => {
    if (method === "adjust") onResolve({ method, quantity: Number(quantity), note });
    else if (method === "accept_risk") onResolve({ method, note });
    else onResolve({ method, itemId, note });
  };
  return (
    <div className={`planning-conflict ${conflict.kind}`} role="group" aria-label={`${conflict.itemName} conflict`}>
      <p>
        <strong>{conflict.kind === "conflict" ? "Conflict" : "Warning"}:</strong> {conflict.itemName} is{" "}
        {number(conflict.shortfall)} short ({number(conflict.allocated)} of {number(conflict.quantity)}
        {conflict.state === "accepted" ? ", risk accepted" : ""}).
      </p>
      {canEdit && conflict.state === "open" && (
        <form
          className="planning-add"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <select
            aria-label="Resolution"
            value={method}
            onChange={(e) => setMethod(e.target.value as ResolveInput["method"])}
          >
            {(["substitute", "sub_rent", "adjust", "accept_risk"] as const).map((value) => (
              <option key={value} value={value}>
                {resolutionMethodLabels[value]}
              </option>
            ))}
          </select>
          {needsItem && (
            <select aria-label="Replacement item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choose an item</option>
              {rentals
                .filter((rental) => rental.id !== conflict.itemId)
                .map((rental) => (
                  <option key={rental.id} value={rental.id}>
                    {rental.name}
                  </option>
                ))}
            </select>
          )}
          {method === "adjust" && (
            <input
              aria-label="New quantity"
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          )}
          <input aria-label="Note" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="outline">
            Resolve
          </Button>
        </form>
      )}
    </div>
  );
}
