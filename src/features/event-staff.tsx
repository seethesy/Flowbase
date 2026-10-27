import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  defaultDepartment,
  departmentLabels,
  departmentSchema,
  shiftKindLabels,
  shiftKindSchema,
  slotLabel,
  type Department,
  type EventRoster,
  type EventShift,
  type ShiftConflict,
  type ShiftInput,
  type ShiftKind,
  type StaffSlot,
} from "../../shared/event-staff";
import type { StaffMember } from "../../shared/staff";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { useResource } from "../app/useResource";
import {
  Button,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
  Section,
} from "../components/shared";
import { eventStaffApi } from "../services/event-staff";
import { staffApi } from "../services/staff";
import { LoadError } from "./clients";
import { date, time } from "./event-format";
import { ListSelect } from "./list-fields";
import "./event-staff.css";

// The event's staff roster and Production Leads (FLOW-140), shown on the event hub
// like the BEO's Staff Roster section: one block per shift with its slots, open
// slots called out, the headcount by department, and double-booking warnings.

const range = (startsAt: string, endsAt: string) => {
  const start = utcToBusinessTime(new Date(startsAt));
  const end = utcToBusinessTime(new Date(endsAt));
  return `${date(start.date)} ${time(start.time)}–${time(end.time)}`;
};
export const conflictText = (conflict: ShiftConflict) =>
  `${conflict.eventTitle ?? "another event"} (${shiftKindLabels[conflict.shiftKind]}, ${range(conflict.startsAt, conflict.endsAt)})`;

export function EventStaffSection({ event }: { event: FlowEvent }) {
  const roster = useResource(["event-staff", event.id], () => eventStaffApi.roster(event.id));
  const staff = useResource(["staff"], () => staffApi.list());
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [shiftForm, setShiftForm] = useState<EventShift | "new" | null>(null);
  const [leadsForm, setLeadsForm] = useState(false);
  if (roster.error)
    return (
      <Section title="Staff">
        <LoadError message={roster.error} />
      </Section>
    );
  if (!roster.data) return <LoadingSkeleton />;
  const data = roster.data;
  const active = (staff.data ?? []).filter((member) => member.active);
  // Applies a roster change and reports what went wrong, if anything.
  const change = async (
    run: () => Promise<EventRoster>,
    after?: (next: EventRoster) => void,
  ) => {
    setError("");
    setWarning("");
    try {
      const next = await run();
      roster.replace(next);
      after?.(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const assign = (slot: StaffSlot, assigneeId: string | null) =>
    change(
      () => eventStaffApi.updateSlot(event.id, slot.id, { assigneeId }),
      (next) => {
        const saved = next.shifts
          .flatMap((shift) => shift.slots)
          .find((item) => item.id === slot.id);
        if (saved?.assignee && saved.conflicts.length)
          setWarning(
            `${saved.assignee.name} is double-booked: also working ${saved.conflicts.map(conflictText).join("; ")}.`,
          );
      },
    );
  return (
    <Section
      title="Staff"
      action={
        data.canEdit && (
          <Button variant="outline" onClick={() => setShiftForm("new")}>
            <Plus size={14} />
            Add shift
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {warning && (
        <p role="alert" className="staff-warning warning">
          {warning}
        </p>
      )}
      <div className="staff-leads">
        <div>
          <small>Production Lead</small>
          <strong>{data.productionLead?.name ?? "Not named"}</strong>
        </div>
        <div>
          <small>Assistants</small>
          <strong>
            {data.assistantLeads.map((lead) => lead.name).join(", ") || "—"}
          </strong>
        </div>
        {data.canNameLeads && (
          <Button variant="outline" onClick={() => setLeadsForm(true)}>
            <Pencil size={14} />
            Production Leads
          </Button>
        )}
      </div>
      <p className="staff-breakdown" aria-label="Staffing breakdown">
        {data.breakdown.length
          ? data.breakdown
              .map(
                (row) =>
                  `${departmentLabels[row.department]}: ${row.total} (${row.filled} filled)`,
              )
              .join(" · ") + ` · ${data.openSlots} open`
          : "No staffing slots yet."}
      </p>
      {data.shifts.map((shift) => (
        <ShiftBlock
          key={shift.id}
          shift={shift}
          canEdit={data.canEdit}
          staff={active}
          staffError={staff.error}
          onAssign={assign}
          onEdit={() => setShiftForm(shift)}
          onRemove={() =>
            change(() => eventStaffApi.archiveShift(event.id, shift.id))
          }
          onRemoveSlot={(slot) =>
            change(() => eventStaffApi.archiveSlot(event.id, slot.id))
          }
          onChangeSlot={(slot, input) =>
            change(() => eventStaffApi.updateSlot(event.id, slot.id, input))
          }
          onAddSlots={(position, department, count) =>
            change(() =>
              eventStaffApi.addSlots(event.id, {
                shiftId: shift.id,
                position,
                department,
                count,
              }),
            )
          }
        />
      ))}
      {shiftForm && (
        <ShiftForm
          event={event}
          shift={shiftForm === "new" ? undefined : shiftForm}
          onClose={() => setShiftForm(null)}
          onSave={async (input) => {
            const next =
              shiftForm === "new"
                ? await eventStaffApi.addShift(event.id, input)
                : await eventStaffApi.updateShift(event.id, shiftForm.id, input);
            roster.replace(next);
            setShiftForm(null);
          }}
        />
      )}
      {leadsForm && (
        <LeadsForm
          roster={data}
          staff={active}
          onClose={() => setLeadsForm(false)}
          onSave={async (input) => {
            await eventStaffApi.setProductionLeads(event.id, input);
            roster.reload();
            setLeadsForm(false);
          }}
        />
      )}
    </Section>
  );
}

function ShiftBlock({
  shift,
  canEdit,
  staff,
  staffError,
  onAssign,
  onEdit,
  onRemove,
  onRemoveSlot,
  onChangeSlot,
  onAddSlots,
}: {
  shift: EventShift;
  canEdit: boolean;
  staff: StaffMember[];
  staffError?: string;
  onAssign: (slot: StaffSlot, assigneeId: string | null) => void;
  onEdit: () => void;
  onRemove: () => void;
  onRemoveSlot: (slot: StaffSlot) => void;
  onChangeSlot: (slot: StaffSlot, input: { department: Department }) => void;
  onAddSlots: (position: string, department: Department, count: number) => void;
}) {
  const title = `${shiftKindLabels[shift.kind]} · ${date(shift.date)} · ${time(shift.startTime)}–${time(shift.endTime)}`;
  return (
    <section className="staff-shift" aria-label={title}>
      <div className="staff-shift-head">
        <h3>{title}</h3>
        {canEdit && (
          <div className="staff-shift-actions">
            <Button variant="ghost" onClick={onEdit}>
              Edit shift
            </Button>
            <Button variant="ghost" onClick={onRemove}>
              Remove shift
            </Button>
          </div>
        )}
      </div>
      {shift.activities && <p className="muted">{shift.activities}</p>}
      {staffError && <LoadError message={staffError} />}
      <ul className="staff-slots">
        {shift.slots.map((slot) => {
          const label = slotLabel(slot);
          const qualified = staff.filter((member) =>
            member.positions.includes(slot.position),
          );
          const others = staff.filter(
            (member) => !member.positions.includes(slot.position),
          );
          // An assignee who is no longer active stays selectable as is.
          const listed = staff.some((member) => member.id === slot.assignee?.id);
          return (
            <li key={slot.id} className={slot.assignee ? "" : "open"}>
              <span className="staff-slot-label">
                <strong>{label}</strong> – {slot.assignee?.name ?? "open"}
              </span>
              <span className="badge neutral">
                {departmentLabels[slot.department]}
              </span>
              {canEdit && (
                <span className="staff-slot-edit">
                  <select
                    aria-label={`Assign ${label}`}
                    value={slot.assignee?.id ?? ""}
                    onChange={(e) => onAssign(slot, e.target.value || null)}
                  >
                    <option value="">Open</option>
                    {slot.assignee && !listed && (
                      <option value={slot.assignee.id}>
                        {slot.assignee.name}
                      </option>
                    )}
                    {qualified.length > 0 && (
                      <optgroup label={`Qualified: ${slot.position}`}>
                        {qualified.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Other staff">
                      {others.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <select
                    aria-label={`Department for ${label}`}
                    value={slot.department}
                    onChange={(e) =>
                      onChangeSlot(slot, {
                        department: departmentSchema.parse(e.target.value),
                      })
                    }
                  >
                    {departmentSchema.options.map((department) => (
                      <option key={department} value={department}>
                        {departmentLabels[department]}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${label}`}
                    onClick={() => onRemoveSlot(slot)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </span>
              )}
              {slot.conflicts.length > 0 && (
                <p className="staff-conflict warning">
                  Double-booked: also working{" "}
                  {slot.conflicts.map(conflictText).join("; ")}
                </p>
              )}
            </li>
          );
        })}
        {!shift.slots.length && <li className="muted">No slots yet.</li>}
      </ul>
      {canEdit && <AddSlots shiftTitle={title} onAdd={onAddSlots} />}
    </section>
  );
}

function AddSlots({
  shiftTitle,
  onAdd,
}: {
  shiftTitle: string;
  onAdd: (position: string, department: Department, count: number) => void;
}) {
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState<Department>("other");
  const [count, setCount] = useState("1");
  return (
    <form
      className="staff-add-slots"
      aria-label={`Add slots to ${shiftTitle}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!position) return;
        onAdd(position, department, Math.max(1, Math.round(Number(count) || 1)));
        setCount("1");
      }}
    >
      <ListSelect
        list="staff_position"
        label="Position"
        empty="Choose a position"
        value={position}
        onChange={(value) => {
          setPosition(value);
          setDepartment(defaultDepartment(value));
        }}
      />
      <select
        aria-label="Department"
        value={department}
        onChange={(e) => setDepartment(departmentSchema.parse(e.target.value))}
      >
        {departmentSchema.options.map((option) => (
          <option key={option} value={option}>
            {departmentLabels[option]}
          </option>
        ))}
      </select>
      <input
        aria-label="How many"
        type="number"
        min={1}
        max={30}
        value={count}
        onChange={(e) => setCount(e.target.value)}
      />
      <Button type="submit" variant="outline" disabled={!position}>
        <Plus size={14} />
        Add slots
      </Button>
    </form>
  );
}

// The pull/load and setup days default to the day before the event.
const defaultShiftDate = (event: FlowEvent, kind: ShiftKind) =>
  kind === "event_day" ? event.date : addLocalDays(event.date, -1);

function ShiftForm({
  event,
  shift,
  onClose,
  onSave,
}: {
  event: FlowEvent;
  shift?: EventShift;
  onClose: () => void;
  onSave: (input: ShiftInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ShiftInput>(() =>
    shift
      ? {
          kind: shift.kind,
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          activities: shift.activities,
        }
      : {
          kind: "event_day",
          date: event.date,
          startTime: "",
          endTime: "",
          activities: "",
        },
  );
  const [error, setError] = useState("");
  const set = <K extends keyof ShiftInput>(key: K, value: ShiftInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={shift ? "Edit shift" : "Add shift"}
      description="Times are New York time. An end time before the start runs past midnight."
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.date || !draft.startTime || !draft.endTime)
            return setError("Day, date, start and end time are required.");
          try {
            setError("");
            await onSave(draft);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="form-grid">
          <FormField label="Day">
            <select
              value={draft.kind}
              onChange={(e) => {
                const kind = shiftKindSchema.parse(e.target.value);
                set("kind", kind);
                if (!shift) set("date", defaultShiftDate(event, kind));
              }}
            >
              {shiftKindSchema.options.map((kind) => (
                <option key={kind} value={kind}>
                  {shiftKindLabels[kind]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Date">
            <input
              type="date"
              value={draft.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </FormField>
          <FormField label="Start time">
            <input
              type="time"
              value={draft.startTime}
              onChange={(e) => set("startTime", e.target.value)}
            />
          </FormField>
          <FormField label="End time">
            <input
              type="time"
              value={draft.endTime}
              onChange={(e) => set("endTime", e.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Activities">
          <textarea
            rows={3}
            value={draft.activities ?? ""}
            onChange={(e) => set("activities", e.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save shift</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function LeadsForm({
  roster,
  staff,
  onClose,
  onSave,
}: {
  roster: EventRoster;
  staff: StaffMember[];
  onClose: () => void;
  onSave: (input: {
    productionLeadId: string | null;
    assistantLeadIds: string[];
  }) => Promise<void>;
}) {
  const [primary, setPrimary] = useState(roster.productionLead?.id ?? "");
  const [assistants, setAssistants] = useState(
    roster.assistantLeads.map((lead) => lead.id),
  );
  const [error, setError] = useState("");
  // AC4: only full-time staff can be the primary Production Lead.
  const fullTime = staff.filter(
    (member) => member.employmentType === "full_time",
  );
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Production Leads"
      description="The primary receives the event's production alerts; assistants are copied."
    >
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          // AC3: assistants need a primary.
          if (!primary && assistants.length)
            return setError(
              "Name a primary Production Lead before adding assistants.",
            );
          try {
            setError("");
            await onSave({
              productionLeadId: primary || null,
              assistantLeadIds: assistants.filter((id) => id !== primary),
            });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField
          label="Primary Production Lead"
          hint="Full-time staff only."
        >
          <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">None</option>
            {fullTime.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </FormField>
        <fieldset className="list-checkboxes">
          <legend>Assistant Production Leads</legend>
          {staff
            .filter((member) => member.id !== primary)
            .map((member) => (
              <label key={member.id}>
                <input
                  type="checkbox"
                  checked={assistants.includes(member.id)}
                  onChange={(e) =>
                    setAssistants((current) =>
                      e.target.checked
                        ? [...current, member.id]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                {member.name}
              </label>
            ))}
        </fieldset>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save leads</Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
