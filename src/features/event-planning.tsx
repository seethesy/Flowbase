import { useEffect, useRef, useState } from "react";
import { Copy, Plus, Printer, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  requirementBasisLabels,
  type BarPlan,
  type BarTierPlan,
  type Requirement,
} from "../../shared/allocation";
import { barCategories, barSubcategories, barTierLabels, barTierSchema, type BarTier } from "../../shared/inventory";
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
import { preparationApi } from "../services/preparation";
import { rentalRequestStatuses, rentalRequestText, type RentalRequest } from "../../shared/rental-requests";
import { date } from "./event-format";
import { T, useCopy } from "../app/copy";
import "./event-planning.css";

// What the event needs from the warehouse and the pantry (FLOW-76/77/85): the
// equipment it holds, the conflicts those holds are in, and the consumables it
// requires with what is short and when to order, and its bar plan (FLOW-170).

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });

// The section sits low on the page, so it loads when it scrolls into view rather
// than adding five requests to every event page that is opened.
export function EventPlanningSection(props: { event: FlowEvent; canEdit: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = anchor.current;
    if (near || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  if (!near)
    return (
      <div ref={anchor}>
        <Section title={<T id="event-planning.event-planning-section.equipment-stock">{"Equipment & stock"}</T>}>
          <LoadingSkeleton />
        </Section>
      </div>
    );
  return <PlanningSections {...props} />;
}

function PlanningSections({
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
  const bar = useResource(["event-bar-plan", event.id], () => planningApi.barPlan(event.id));
  const rentals = useResource(["event-rental-requests", event.id], () => preparationApi.rentalRequests(event.id));
  const [error, setError] = useState("");
  const failed = holds.error ?? conflicts.error ?? needs.error ?? bar.error ?? rentals.error;
  if (failed)
    return (
      <Section title={<T id="event-planning.planning-sections.equipment-stock">{"Equipment & stock"}</T>}>
        <LoadError message={failed} />
      </Section>
    );
  if (!holds.data || !conflicts.data || !needs.data || !bar.data || !rentals.data) return <LoadingSkeleton />;
  const rentalItems = (items.data ?? []).filter((item) => item.kind === "rental");
  const consumables = (items.data ?? []).filter((item) => item.kind === "consumable");
  const barItems = consumables.filter((item) => item.subtype === "bar");
  // Bar lines are shown and edited in the bar plan.
  const otherNeeds = needs.data.filter((need) => need.source !== "bar");
  const reloadAll = () => {
    holds.reload();
    conflicts.reload();
    rentals.reload();
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
      <Section title={<T id="event-planning.planning-sections.equipment-holds">Equipment holds</T>}>
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
            rentals={rentalItems}
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
          {!holds.data.length && <li className="muted"><T id="event-planning.planning-sections.no-equipment-held-yet">No equipment held yet.</T></li>}
        </ul>
        {canEdit && (
          <AddLine
            label="Hold equipment"
            options={rentalItems}
            onAdd={(itemId, quantity) =>
              act(() => planningApi.placeHold(event.id, { itemId, quantity }))
            }
          />
        )}
      </Section>
      <RentalRequestsSection
        requests={rentals.data}
        canEdit={canEdit}
        onSave={async (request, input) => {
          rentals.replace(await preparationApi.updateRentalRequest(event.id, request.vendorId, input));
        }}
      />
      <Section title={<T id="event-planning.planning-sections.consumable-needs">Consumable needs</T>}>
        <ul className="planning-list">
          {otherNeeds.map((need) => (
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
          {!otherNeeds.length && <li className="muted"><T id="event-planning.planning-sections.no-consumables-required-yet">No consumables required yet.</T></li>}
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
      <BarPlanSection
        plan={bar.data}
        canEdit={canEdit}
        barItems={barItems}
        onSave={(input) =>
          act(async () => {
            bar.replace(await planningApi.setBarPlan(event.id, input));
            needs.reload();
          })
        }
      />
    </>
  );
}

function RentalRequestsSection({ requests, canEdit, onSave }: {
  requests: RentalRequest[];
  canEdit: boolean;
  onSave: (request: RentalRequest, input: { status: RentalRequest["status"];
    method: RentalRequest["method"]; details: string }) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState<string | null>(null);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("printing-rental-request");
    const clear = () => { document.body.classList.remove("printing-rental-request"); setPrinting(null); };
    window.addEventListener("afterprint", clear, { once: true });
    const frame = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(frame); window.removeEventListener("afterprint", clear); document.body.classList.remove("printing-rental-request"); };
  }, [printing]);
  const save = async (request: RentalRequest, patch: Partial<Pick<RentalRequest, "status" | "method" | "details">>) => {
    setError("");
    try {
      await onSave(request, { status: patch.status ?? request.status,
        method: patch.method ?? request.method, details: patch.details ?? request.details });
    } catch (cause) { setError((cause as Error).message); }
  };
  return (
    <Section title={<T id="event-planning.rental-requests-section.vendor-rental-requests">Vendor rental requests</T>}>
      {error && <p role="alert" className="error-message">{error}</p>}
      {!requests.length && <p className="muted"><T id="event-planning.rental-requests-section.no-vendor-rentals-are-held">No vendor rentals are held for this event.</T></p>}
      {requests.map((request) => (
        <article key={request.vendorId} className="rental-request-document" data-print={printing === request.vendorId}>
          <h3><T id="event-planning.rental-requests-section.rental-request" values={{ vendorName: request.vendorName }}>{"Rental request: {vendorName}"}</T></h3>
          <p><strong><T id="event-planning.rental-requests-section.event">Event:</T></strong> {request.eventTitle} · {date(request.eventDate)}</p>
          {canEdit ? (
            <div className="rental-request-controls">
              <label><T id="event-planning.rental-requests-section.status">{"Status "}</T><select aria-label={`${request.vendorName} request status`} value={request.status}
                onChange={(event) => void save(request, { status: event.target.value as RentalRequest["status"] })}>
                {rentalRequestStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select></label>
              <label><T id="event-planning.rental-requests-section.fulfillment">{"Fulfillment "}</T><select aria-label={`${request.vendorName} fulfillment`} value={request.method}
                onChange={(event) => void save(request, { method: event.target.value as RentalRequest["method"] })}>
                <option value="delivery">Delivery</option><option value="pickup">Pickup</option>
              </select></label>
              <label><T id="event-planning.rental-requests-section.delivery-or-pickup-details">{"Delivery or pickup details "}</T><input aria-label={`${request.vendorName} delivery details`}
                defaultValue={request.details} onBlur={(event) => {
                  if (event.target.value !== request.details) void save(request, { details: event.target.value });
                }} /></label>
            </div>
          ) : <p>{request.status} · {request.method}: {request.details || <T id="event-planning.rental-requests-section.details-to-confirm">Details to confirm</T>}</p>}
          <p className="rental-request-print-details"><strong>{request.method === "delivery" ? <T id="event-planning.rental-requests-section.delivery">Delivery:</T> : <T id="event-planning.rental-requests-section.pickup">Pickup:</T>}</strong> {request.details || <T id="event-planning.rental-requests-section.details-to-confirm">Details to confirm</T>}</p>
          <table><thead><tr><th><T id="event-planning.rental-requests-section.item">Item</T></th><th><T id="event-planning.rental-requests-section.quantity">Quantity</T></th><th><T id="event-planning.rental-requests-section.rental-dates">Rental dates</T></th></tr></thead>
            <tbody>{request.lines.map((line) => <tr key={line.itemId}><td>{line.name}</td><td>{number(line.quantity)}</td>
              <td>{date(line.from)}–{date(line.through)}</td></tr>)}</tbody></table>
          <div className="rental-request-actions">
            <Button variant="outline" onClick={() => setPrinting(request.vendorId)}><Printer size={14} /><T id="event-planning.rental-requests-section.print-request">{" Print request"}</T></Button>
            <Button variant="outline" onClick={() => void navigator.clipboard.writeText(rentalRequestText(request))}>
              <Copy size={14} /><T id="event-planning.rental-requests-section.copy-text">{" Copy text"}</T></Button>
          </div>
        </article>
      ))}
    </Section>
  );
}

type BarPlanSave = Parameters<typeof planningApi.setBarPlan>[1];

// Bar quantities the event needs (FLOW-170), by item or by tier ("rail vodka").
// A tier draws on every active bar item of that category, tier and subcategory;
// what it can't get is ordered as the tier's house pick.
function BarPlanSection({
  plan,
  canEdit,
  barItems,
  onSave,
}: {
  plan: BarPlan;
  canEdit: boolean;
  barItems: { id: string; name: string }[];
  onSave: (input: BarPlanSave) => void;
}) {
  const itemLines = plan.items.map(({ itemId, basis, quantity }) => ({ itemId, basis, quantity }));
  const tierLines = plan.tiers.map(({ category, subcategory, tier, basis, quantity }) => ({
    category,
    subcategory,
    tier,
    basis,
    quantity,
  }));
  return (
    <Section title={<T id="event-planning.bar-plan-section.bar-plan">Bar plan</T>}>
      <ul className="planning-list">
        {plan.items.map((need) => (
          <NeedRow
            key={need.itemId}
            need={need}
            canEdit={canEdit}
            onRemove={() =>
              onSave({ items: itemLines.filter((line) => line.itemId !== need.itemId), tiers: tierLines })
            }
          />
        ))}
        {plan.tiers.map((line) => (
          <TierRow
            key={line.id}
            line={line}
            canEdit={canEdit}
            onRemove={() =>
              onSave({ items: itemLines, tiers: tierLines.filter((_, index) => plan.tiers[index].id !== line.id) })
            }
          />
        ))}
        {!plan.items.length && !plan.tiers.length && <li className="muted"><T id="event-planning.bar-plan-section.no-bar-planned-yet">No bar planned yet.</T></li>}
      </ul>
      {canEdit && (
        <>
          <AddLine
            label="Add bar item"
            options={barItems}
            allowPerGuest
            onAdd={(itemId, quantity, basis) =>
              onSave({
                items: [
                  ...itemLines.filter((line) => line.itemId !== itemId),
                  { itemId, basis: basis ?? "fixed", quantity },
                ],
                tiers: tierLines,
              })
            }
          />
          <AddTierLine
            onAdd={(tier) =>
              onSave({
                items: itemLines,
                tiers: [
                  ...tierLines.filter(
                    (line) =>
                      !(line.category === tier.category && line.subcategory === tier.subcategory && line.tier === tier.tier),
                  ),
                  tier,
                ],
              })
            }
          />
        </>
      )}
    </Section>
  );
}

const tierName = (line: Pick<BarTierPlan, "category" | "subcategory" | "tier">) =>
  `${barTierLabels[line.tier]} ${line.subcategory || line.category}`.toLowerCase().replace(/^./, (c) => c.toUpperCase());

function TierRow({ line, canEdit, onRemove }: { line: BarTierPlan; canEdit: boolean; onRemove: () => void }) {
  const name = tierName(line);
  return (
    <li className="planning-row">
      <strong>{name}</strong>
      <span className="muted">
        {line.basis === "per_guest" ? <T id="event-planning.tier-row.per-guest-needs" values={{ number: number(line.quantity), number2: number(line.required) }}>{"{number} per guest → needs {number2} · "}</T> : <T id="event-planning.tier-row.needs" values={{ number: number(line.quantity), number2: number(line.required) }}>{"{number} → needs {number2} · "}</T>}
        {line.items.length ? <T id="event-planning.tier-row.from" values={{ join: line.items.join(", ") }}>{"from {join}"}</T> : <T id="event-planning.tier-row.no-matching-bar-items">no matching bar items</T>}
      </span>
      {line.shortage !== null && line.shortage > 0 && (
        <span className="planning-badge conflict">
          <T id="event-planning.tier-row.short" values={{ number: number(line.shortage) }}>{"Short {number}"}</T>
          {line.reorderItemName ? <T id="event-planning.tier-row.order" values={{ reorderItemName: line.reorderItemName }}>{" · order {reorderItemName}"}</T> : ""}
          {line.orderBy ? <T id="event-planning.tier-row.by" values={{ orderBy: date(line.orderBy) }}>{" by {orderBy}"}</T> : ""}
        </span>
      )}
      {line.shortage === 0 && <span className="planning-badge ok"><T id="event-planning.tier-row.covered">Covered</T></span>}
      {line.shortage === null && <span className="muted"><T id="event-planning.tier-row.allocated-once-the-event-is">Allocated once the event is Closed</T></span>}
      {canEdit && (
        <Button variant="outline" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Trash2 size={14} />
        </Button>
      )}
    </li>
  );
}

function AddTierLine({
  onAdd,
}: {
  onAdd: (line: { category: string; subcategory: string; tier: BarTier; basis: "fixed" | "per_guest"; quantity: number }) => void;
}) {
  const [category, setCategory] = useState("Liquor");
  const [subcategory, setSubcategory] = useState("");
  const [tier, setTier] = useState<BarTier>("rail");
  const [quantity, setQuantity] = useState("1");
  const [basis, setBasis] = useState<"fixed" | "per_guest">("fixed");
  const subcategories = barSubcategories[category] ?? [];
  return (
    <form
      className="planning-add"
      aria-label="Add bar tier"
      onSubmit={(e) => {
        e.preventDefault();
        const amount = Number(quantity);
        if (!(amount > 0)) return;
        onAdd({ category, subcategory, tier, basis, quantity: amount });
        setQuantity("1");
      }}
    >
      <select aria-label="Tier" value={tier} onChange={(e) => setTier(barTierSchema.parse(e.target.value))}>
        {barTierSchema.options.map((value) => (
          <option key={value} value={value}>
            {barTierLabels[value]}
          </option>
        ))}
      </select>
      <select
        aria-label="Bar category"
        value={category}
        onChange={(e) => {
          setCategory(e.target.value);
          setSubcategory("");
        }}
      >
        {barCategories.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      {subcategories.length > 0 && (
        <select aria-label="Subcategory" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
          <option value="">Any</option>
          {subcategories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      )}
      <input
        aria-label="Tier quantity"
        type="number"
        min={0}
        step="any"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <select
        aria-label="Tier basis"
        value={basis}
        onChange={(e) => setBasis(e.target.value === "per_guest" ? "per_guest" : "fixed")}
      >
        {(["fixed", "per_guest"] as const).map((value) => (
          <option key={value} value={value}>
            {requirementBasisLabels[value]}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline">
        <Plus size={14} />
        <T id="event-planning.add-tier-line.add-bar-tier">Add bar tier</T>
      </Button>
    </form>
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
          {hold.issue === "conflict" ? <T id="event-planning.hold-row.conflict-short" values={{ number: number(hold.shortfall) }}>{"Conflict: {number} short"}</T> : <T id="event-planning.hold-row.warning-short" values={{ number: number(hold.shortfall) }}>{"Warning: {number} short"}</T>}
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
      {need.source !== "manual" && <small className="muted">{need.source}</small>}
      <span className="muted">
        {need.basis === "per_guest" ? <T id="event-planning.need-row.per-guest-needs" values={{ number: number(need.quantity), unit: need.unit, number2: number(need.required) }}>{"{number} {unit} per guest → needs {number2} {unit}"}</T> : <T id="event-planning.need-row.needs" values={{ number: number(need.quantity), unit: need.unit, number2: number(need.required) }}>{"{number} {unit} → needs {number2} {unit}"}</T>}
      </span>
      {need.shortage !== null && need.shortage > 0 && (
        <span className="planning-badge conflict">
          <T id="event-planning.need-row.short" values={{ number: number(need.shortage), unit: need.unit }}>{"Short {number} {unit}"}</T>
          {need.orderBy ? <T id="event-planning.need-row.order-by" values={{ orderBy: date(need.orderBy) }}>{" · order by {orderBy}"}</T> : ""}
        </span>
      )}
      {need.shortage === 0 && <span className="planning-badge ok"><T id="event-planning.need-row.covered">Covered</T></span>}
      {need.shortage === null && <span className="muted"><T id="event-planning.need-row.allocated-once-the-event-is">Allocated once the event is Closed</T></span>}
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
  const notePlaceholder = useCopy("event-planning.conflict-card.note.placeholder", "Note");
  // A kit's part follows the kit's hold: the risk can be accepted here, and the
  // quantity is changed on the kit (FLOW-212).
  const methods: readonly ResolveInput["method"][] = conflict.kitName
    ? ["accept_risk"]
    : ["substitute", "sub_rent", "adjust", "accept_risk"];
  const [method, setMethod] = useState<ResolveInput["method"]>(methods[0]);
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
        <strong>{conflict.kind === "conflict" ? <T id="event-planning.conflict-card.conflict">Conflict:</T> : <T id="event-planning.conflict-card.warning">Warning:</T>}</strong> {conflict.itemName}
        {conflict.kitName ? <T id="event-planning.conflict-card.in" values={{ kitName: conflict.kitName }}>{" (in {kitName})"}</T> : ""}{conflict.state === "accepted" ? <T id="event-planning.conflict-card.is-short-of-risk-accepted" values={{ number: number(conflict.shortfall), number2: number(conflict.allocated), number3: number(conflict.quantity) }}>{" is {number} short ({number2} of {number3}, risk accepted)."}</T> : <T id="event-planning.conflict-card.is-short-of" values={{ number: number(conflict.shortfall), number2: number(conflict.allocated), number3: number(conflict.quantity) }}>{" is {number} short ({number2} of {number3})."}</T>}
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
            {methods.map((value) => (
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
          <input aria-label="Note" placeholder={notePlaceholder} data-copy-id="event-planning.conflict-card.note.placeholder" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="outline">
            <T id="event-planning.conflict-card.resolve">Resolve</T>
          </Button>
        </form>
      )}
    </div>
  );
}
