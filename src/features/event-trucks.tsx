import { useState } from "react";
import type { FlowEvent } from "../../shared/core-records";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import { truckStatuses, type TruckAssignmentInput } from "../../shared/trucks";
import { useResource } from "../app/useResource";
import { Button, FormField, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { preparationApi } from "../services/preparation";
import { staffApi } from "../services/staff";
import { ApiRequestError } from "../services/core";

const localInput = (instant: string) => {
  const { date, time } = utcToBusinessTime(new Date(instant));
  return `${date}T${time}`;
};
const toInstant = (value: string) => {
  const [date, time] = value.split("T");
  return businessTimeToUtc(date, time).toISOString();
};

export function EventTruckSection({ event }: { event: FlowEvent }) {
  const log = useResource(["event-trucks", event.id], () => preparationApi.truckLog(event.id));
  const pull = useResource(["event-pull-list", event.id], () => preparationApi.pullList(event.id));
  const staff = useResource(["staff"], () => staffApi.list());
  const [truckId, setTruckId] = useState("");
  const [departsAt, setDepartsAt] = useState(`${event.date}T${event.startTime}`);
  const [returnsAt, setReturnsAt] = useState(`${addLocalDays(event.date, !event.endTime || event.endTime <= event.startTime ? 1 : 0)}T${event.endTime ?? event.startTime}`);
  const [driverId, setDriverId] = useState("");
  const [loaderIds, setLoaderIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  const [busy, setBusy] = useState(false);
  if (log.error) return <Section title="Truck log"><LoadError message={log.error} /></Section>;
  if (!log.data) return <LoadingSkeleton />;
  const data = log.data;
  const assigned = new Set(data.assignments.map((assignment) => assignment.truckId));
  const update = async (action: () => Promise<typeof data>) => {
    setBusy(true); setError("");
    try { log.replace(await action()); pull.reload(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const assign = async (acknowledgeConflict: boolean) => {
    if (!truckId || !departsAt || !returnsAt) return;
    const input: TruckAssignmentInput = {
      truckId, departsAt: toInstant(departsAt), returnsAt: toInstant(returnsAt),
      driverId: driverId || null, loaderIds, acknowledgeConflict,
    };
    setBusy(true); setError("");
    try { log.replace(await preparationApi.assignTruck(event.id, input)); setConflict(""); }
    catch (cause) {
      const message = (cause as Error).message;
      if (cause instanceof ApiRequestError && cause.code === "TRUCK_CONFLICT") setConflict(message.replace(/ Reference: .*$/, ""));
      else setError(message);
    } finally { setBusy(false); }
  };
  return <Section title="Truck log">
    {error && <p role="alert" className="error-message">{error}</p>}
    {data.missingDriverWarning && <p role="alert" className="warning-message">{data.missingDriverWarning}</p>}
    <ul className="planning-list">
      {data.trucks.map((truck) => <li key={truck.id} className="planning-row">
        <strong>{truck.name}</strong>
        {data.canEdit ? <select aria-label={`${truck.name} status`} value={truck.status}
          onChange={(e) => void update(() => preparationApi.setTruckStatus(event.id, truck.id, e.target.value as typeof truck.status))}>
          {truckStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
        </select> : <span>{truck.status.replaceAll("_", " ")}</span>}
      </li>)}
    </ul>
    {data.assignments.map((assignment) => <div key={assignment.id} className="planning-row">
      <strong>{assignment.truckName}</strong>
      <span>{localInput(assignment.departsAt).replace("T", " ")} – {localInput(assignment.returnsAt).replace("T", " ")}</span>
      <span>Driver: {assignment.driverName ?? "Unassigned"}</span>
      {assignment.conflictMessage && <small>Conflict acknowledged: {assignment.conflictMessage}</small>}
      {data.canEdit && <Button variant="ghost" disabled={busy}
        onClick={() => void update(() => preparationApi.removeTruckAssignment(event.id, assignment.id))}>Remove</Button>}
    </div>)}
    {data.canEdit && <>
      <div className="form-grid">
        <FormField label="Truck"><select value={truckId} onChange={(e) => { setTruckId(e.target.value); setConflict(""); }}>
          <option value="">Choose a truck</option>
          {data.trucks.filter((truck) => !assigned.has(truck.id)).map((truck) => <option key={truck.id} value={truck.id}>{truck.name}</option>)}
        </select></FormField>
        <FormField label="Departure"><input type="datetime-local" value={departsAt} onChange={(e) => { setDepartsAt(e.target.value); setConflict(""); }} /></FormField>
        <FormField label="Back at warehouse"><input type="datetime-local" value={returnsAt} onChange={(e) => { setReturnsAt(e.target.value); setConflict(""); }} /></FormField>
        <FormField label="Driver"><select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Unassigned</option>
          {(staff.data ?? []).filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></FormField>
        <FormField label="Loaders"><select multiple value={loaderIds} onChange={(e) => setLoaderIds([...e.target.selectedOptions].map((option) => option.value))}>
          {(staff.data ?? []).filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></FormField>
      </div>
      <Button disabled={busy || !truckId} onClick={() => void assign(false)}>Assign truck</Button>
      {conflict && <div role="alert" className="warning-message"><p>{conflict}</p>
        <Button disabled={busy} onClick={() => void assign(true)}>Acknowledge and assign</Button>
        <Button variant="outline" onClick={() => setConflict("")}>Cancel</Button>
      </div>}
      <div className="form-grid"><FormField label="Add truck"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></FormField>
        <Button disabled={busy || !name.trim()} onClick={() => void update(async () => {
          const next = await preparationApi.addTruck(event.id, name.trim()); setName(""); return next;
        })}>Add truck</Button></div>
    </>}
    {pull.data && pull.data.groups.flatMap((group) => group.lines).length > 0 && <div>
      <h3>Pull-list lines by truck</h3>
      {pull.data.groups.flatMap((group) => group.lines).map((line) => <div key={line.id} className="planning-row">
        <span>{line.name}</span>
        <select aria-label={`Truck for ${line.name}`} disabled={!data.canEdit || busy}
          value={line.truckId ?? ""}
          onChange={(e) => void update(() => preparationApi.movePullLineToTruck(event.id, line.id, e.target.value || null))}>
          <option value="">Unassigned</option>
          {data.assignments.map((assignment) => <option key={assignment.id} value={assignment.truckId}>{assignment.truckName}</option>)}
        </select>
      </div>)}
    </div>}
  </Section>;
}
