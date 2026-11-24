import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Dropdown } from "../../components/ui/Dropdown";
import { useState } from "react";
import type { FlowEvent } from "../../../shared/core-records";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { truckStatuses, type TruckAssignmentInput } from "../../../shared/trucks";
import { useResource } from "../../app/useResource";
import { Button, FormField, LoadingSkeleton, Section, ErrorText } from "../../components/shared";
import { preparationApi } from "../../services/preparation";
import { staffApi } from "../../services/staff";
import { ApiRequestError } from "../../services/core";
import { T } from "../../app/copy";

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
  if (log.error) return <Section title={<T id="event-trucks.event-truck-section.truck-log">Truck log</T>}><ErrorText message={log.error} /></Section>;
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
  return <Section title={<T id="event-trucks.event-truck-section.truck-log">Truck log</T>}>
    <ErrorText message={error} />
    {data.missingDriverWarning && <p role="alert" className="warning-message">{data.missingDriverWarning}</p>}
    <PageGrid pageKey="events.trucks">
    <Block id="assignments" name="Truck assignments" h={12}>
    <ul className="planning-list">
      {data.trucks.map((truck) => <li key={truck.id} className="planning-row">
        <strong>{truck.name}</strong>
        {data.canEdit ? <Dropdown aria-label={`${truck.name} status`} value={truck.status}
          onChange={(e) => void update(() => preparationApi.setTruckStatus(event.id, truck.id, e.target.value as typeof truck.status))}>
          {truckStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
        </Dropdown> : <span>{truck.status.replaceAll("_", " ")}</span>}
      </li>)}
    </ul>
    {data.assignments.map((assignment) => <div key={assignment.id} className="planning-row">
      <strong>{assignment.truckName}</strong>
      <span>{localInput(assignment.departsAt).replace("T", " ")} – {localInput(assignment.returnsAt).replace("T", " ")}</span>
      <span><T id="event-trucks.event-truck-section.driver">{"Driver: "}</T>{assignment.driverName ?? <T id="event-trucks.event-truck-section.unassigned">Unassigned</T>}</span>
      {assignment.conflictMessage && <small><T id="event-trucks.event-truck-section.conflict-acknowledged" values={{ conflictMessage: assignment.conflictMessage }}>{"Conflict acknowledged: {conflictMessage}"}</T></small>}
      {data.canEdit && <Button variant="ghost" disabled={busy}
        onClick={() => void update(() => preparationApi.removeTruckAssignment(event.id, assignment.id))}><T id="event-trucks.event-truck-section.remove">Remove</T></Button>}
    </div>)}
    </Block>
    {data.canEdit && <Block id="add-truck" name="Add truck" h={12}>
      <div className="form-grid">
        <FormField label={<T id="event-trucks.event-truck-section.truck">Truck</T>}><Dropdown value={truckId} onChange={(e) => { setTruckId(e.target.value); setConflict(""); }}>
          <option value="">Choose a truck</option>
          {data.trucks.filter((truck) => !assigned.has(truck.id)).map((truck) => <option key={truck.id} value={truck.id}>{truck.name}</option>)}
        </Dropdown></FormField>
        <FormField label={<T id="event-trucks.event-truck-section.departure">Departure</T>}><input type="datetime-local" value={departsAt} onChange={(e) => { setDepartsAt(e.target.value); setConflict(""); }} /></FormField>
        <FormField label={<T id="event-trucks.event-truck-section.back-at-warehouse">Back at warehouse</T>}><input type="datetime-local" value={returnsAt} onChange={(e) => { setReturnsAt(e.target.value); setConflict(""); }} /></FormField>
        <FormField label={<T id="event-trucks.event-truck-section.driver-2">Driver</T>}><Dropdown value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Unassigned</option>
          {(staff.data ?? []).filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </Dropdown></FormField>
        <FormField label={<T id="event-trucks.event-truck-section.loaders">Loaders</T>}><Dropdown multiple value={loaderIds} onChange={(e) => setLoaderIds([...e.target.selectedOptions].map((option) => option.value))}>
          {(staff.data ?? []).filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </Dropdown></FormField>
      </div>
      <Button disabled={busy || !truckId} onClick={() => void assign(false)}><T id="event-trucks.event-truck-section.assign-truck">Assign truck</T></Button>
      {conflict && <div role="alert" className="warning-message"><p>{conflict}</p>
        <Button disabled={busy} onClick={() => void assign(true)}><T id="event-trucks.event-truck-section.acknowledge-and-assign">Acknowledge and assign</T></Button>
        <Button variant="outline" onClick={() => setConflict("")}><T id="event-trucks.event-truck-section.cancel">Cancel</T></Button>
      </div>}
      <div className="form-grid"><FormField label={<T id="event-trucks.event-truck-section.add-truck">Add truck</T>}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></FormField>
        <Button disabled={busy || !name.trim()} onClick={() => void update(async () => {
          const next = await preparationApi.addTruck(event.id, name.trim()); setName(""); return next;
        })}><T id="event-trucks.event-truck-section.add-truck">Add truck</T></Button></div>
    </Block>}
    <Block id="pull-lines" name="Pull-list lines by truck" h={12}>
    <ErrorText message={pull.error} />
    {pull.loading && !pull.data && <LoadingSkeleton />}
    {pull.data && pull.data.groups.flatMap((group) => group.lines).length > 0 && <div>
      <h3><T id="event-trucks.event-truck-section.pull-list-lines-by-truck">Pull-list lines by truck</T></h3>
      {pull.data.groups.flatMap((group) => group.lines).map((line) => <div key={line.id} className="planning-row">
        <span>{line.name}</span>
        <Dropdown aria-label={`Truck for ${line.name}`} disabled={!data.canEdit || busy}
          value={line.truckId ?? ""}
          onChange={(e) => void update(() => preparationApi.movePullLineToTruck(event.id, line.id, e.target.value || null))}>
          <option value="">Unassigned</option>
          {data.assignments.map((assignment) => <option key={assignment.id} value={assignment.truckId}>{assignment.truckName}</option>)}
        </Dropdown>
      </div>)}
    </div>}
    </Block>
    </PageGrid>
  </Section>;
}
