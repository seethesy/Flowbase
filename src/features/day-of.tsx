import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  clockLabel,
  dayOfLogCsvHeaders,
  dayOfStaffStatuses,
  dayOfStaffStatusLabels,
  dayOfTruckStatusLabels,
  type DayOfCheckpoint,
  type DayOfStaff,
  type DayOfTruck,
} from "../../shared/day-of";
import { truckStatuses } from "../../shared/trucks";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { useResource } from "../app/useResource";
import { Button, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { dayOfApi } from "../services/day-of";
import { csvFileName, downloadCsv, toCsv } from "../services/csv";

const clock = (instant: string) => clockLabel(utcToBusinessTime(new Date(instant)).time);

// The live board for one date (FLOW-155). Phone first: one card per event, a
// row per person, truck and checkpoint. Everyone who can open an event sees it;
// managers also get the controls. Other people's updates arrive through the
// shared freshness service, so nothing here polls.
export function DayOfPage() {
  const [params, setParams] = useSearchParams();
  const today = utcToBusinessTime(new Date()).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const board = useResource(["day-of", date], () => dayOfApi.board(date));
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (next: string) => setParams({ date: next });
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      board.reload();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="record-heading">
        <div>
          <h1>Day-of board</h1>
          <p>{date === today ? "Today" : date}</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => go(addLocalDays(date, -1))}>Previous day</Button>
          <input type="date" aria-label="Board date" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
          <Button variant="ghost" onClick={() => go(addLocalDays(date, 1))}>Next day</Button>
        </div>
      </div>
      {board.error && <LoadError message={board.error} />}
      {!board.data && !board.error && <LoadingSkeleton />}
      {error && <p role="alert" className="error-message">{error}</p>}
      {board.data?.canUpdate && (
        <label>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent: text the people affected
        </label>
      )}
      {board.data && !board.data.events.length && <p>No events on this date.</p>}
      {board.data?.events.map((event) => (
        <Section key={event.id} title={event.title}>
          <p>
            <span className="badge neutral">{event.status}</span> {clock(event.startsAt)}
            {event.endsAt ? ` – ${clock(event.endsAt)}` : ""}
            {event.venueName ? ` · ${event.venueName}` : ""}
          </p>
          {event.checkpoints.length > 0 && (
            <ul aria-label={`${event.title} timeline`} className="planning-list">
              {event.checkpoints.map((checkpoint) => (
                <CheckpointRow
                  key={checkpoint.key}
                  checkpoint={checkpoint}
                  canUpdate={board.data!.canUpdate}
                  busy={busy}
                  onToggle={() =>
                    run(() =>
                      dayOfApi.setCheckpoint(event.id, checkpoint.key, {
                        reached: !checkpoint.reachedAt,
                        urgent,
                      }),
                    )
                  }
                />
              ))}
            </ul>
          )}
          <h3>Trucks</h3>
          {!event.trucks.length && <p>No trucks assigned.</p>}
          <ul aria-label={`${event.title} trucks`} className="planning-list">
            {event.trucks.map((truck) => (
              <TruckRow
                key={truck.assignmentId}
                truck={truck}
                canUpdate={board.data!.canUpdate}
                busy={busy}
                onSave={(input) => run(() => dayOfApi.updateTruck(truck.assignmentId, { ...input, urgent }))}
              />
            ))}
          </ul>
          <h3>Staff</h3>
          {!event.staff.length && <p>No staff scheduled.</p>}
          <ul aria-label={`${event.title} staff`} className="planning-list">
            {event.staff.map((member) => (
              <StaffRow
                key={member.slotId}
                member={member}
                canUpdate={board.data!.canUpdate}
                busy={busy}
                onSave={(input) => run(() => dayOfApi.updateStaff(member.slotId, { ...input, urgent }))}
              />
            ))}
          </ul>
        </Section>
      ))}
    </>
  );
}

function CheckpointRow({
  checkpoint,
  canUpdate,
  busy,
  onToggle,
}: {
  checkpoint: DayOfCheckpoint;
  canUpdate: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="planning-row">
      <strong>{checkpoint.label}</strong>
      <span>
        {checkpoint.reachedAt
          ? `Reached ${clock(checkpoint.reachedAt)}${checkpoint.reachedByName ? ` by ${checkpoint.reachedByName}` : ""}`
          : checkpoint.plannedAt
            ? `Planned ${clock(checkpoint.plannedAt)}`
            : "Not marked"}
      </span>
      {canUpdate && (
        <Button
          variant="ghost"
          disabled={busy}
          aria-label={`${checkpoint.reachedAt ? "Clear" : "Mark"} ${checkpoint.label}`}
          onClick={onToggle}
        >
          {checkpoint.reachedAt ? "Clear" : "Mark now"}
        </Button>
      )}
    </li>
  );
}

function TruckRow({
  truck,
  canUpdate,
  busy,
  onSave,
}: {
  truck: DayOfTruck;
  canUpdate: boolean;
  busy: boolean;
  onSave: (input: { status?: DayOfTruck["status"]; location?: string }) => void;
}) {
  const [location, setLocation] = useState(truck.location);
  return (
    <li className="planning-row">
      <strong>{truck.name}</strong>
      <span>Driver: {truck.driverName ?? "Unassigned"}</span>
      {canUpdate ? (
        <>
          <select
            aria-label={`${truck.name} status`}
            value={truck.status}
            disabled={busy}
            onChange={(e) => onSave({ status: e.target.value as DayOfTruck["status"] })}
          >
            {truckStatuses.map((status) => (
              <option key={status} value={status}>{dayOfTruckStatusLabels[status]}</option>
            ))}
          </select>
          <input
            aria-label={`${truck.name} location`}
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Button
            variant="ghost"
            disabled={busy || location === truck.location}
            aria-label={`Save ${truck.name} location`}
            onClick={() => onSave({ location })}
          >
            Save
          </Button>
        </>
      ) : (
        <span>{dayOfTruckStatusLabels[truck.status]}{truck.location ? ` · ${truck.location}` : ""}</span>
      )}
    </li>
  );
}

function StaffRow({
  member,
  canUpdate,
  busy,
  onSave,
}: {
  member: DayOfStaff;
  canUpdate: boolean;
  busy: boolean;
  onSave: (input: { status?: DayOfStaff["status"]; location?: string }) => void;
}) {
  const [location, setLocation] = useState(member.location);
  return (
    <li className="planning-row">
      <strong>{member.name}</strong>
      <span>{member.position}</span>
      {canUpdate ? (
        <>
          <select
            aria-label={`${member.name} status`}
            value={member.status}
            disabled={busy}
            onChange={(e) => onSave({ status: e.target.value as DayOfStaff["status"] })}
          >
            {dayOfStaffStatuses.map((status) => (
              <option key={status} value={status}>{dayOfStaffStatusLabels[status]}</option>
            ))}
          </select>
          <input
            aria-label={`${member.name} location`}
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Button
            variant="ghost"
            disabled={busy || location === member.location}
            aria-label={`Save ${member.name} location`}
            onClick={() => onSave({ location })}
          >
            Save
          </Button>
        </>
      ) : (
        <span>{dayOfStaffStatusLabels[member.status]}{member.location ? ` · ${member.location}` : ""}</span>
      )}
    </li>
  );
}

// The event's day-of log on the event hub (FLOW-156): who changed what and when,
// newest first, exportable. Visible to everyone who can open the event, including
// after it is completed.
export function EventDayOfSection({ event }: { event: { id: string; title: string } }) {
  const log = useResource(["day-of-log", event.id], () => dayOfApi.log(event.id));
  if (log.error) return <Section title="Day-of log"><LoadError message={log.error} /></Section>;
  if (!log.data) return <LoadingSkeleton />;
  const { entries, truncated } = log.data;
  const exportCsv = () => {
    const rows = [...entries].reverse().map((entry) => {
      const { date, time } = utcToBusinessTime(new Date(entry.at));
      return [date, time, entry.kind, entry.truckName ?? "", entry.subjectName, entry.summary, entry.urgent, entry.actorName ?? ""];
    });
    downloadCsv(csvFileName(`${event.title} day-of log`), toCsv(dayOfLogCsvHeaders, rows));
  };
  return (
    <Section
      title="Day-of log"
      action={entries.length ? <Button variant="ghost" onClick={exportCsv}>Export CSV</Button> : undefined}
    >
      {!entries.length && <p>No day-of updates yet.</p>}
      {truncated && <p>Showing the latest {entries.length} updates.</p>}
      <ul aria-label="Day-of log" className="planning-list">
        {entries.map((entry) => {
          const { date, time } = utcToBusinessTime(new Date(entry.at));
          return (
            <li key={entry.id} className="planning-row">
              <small>{date} {clockLabel(time)}</small>
              <span>{entry.urgent && <span className="badge error">Urgent</span>} {entry.summary}</span>
              <small>{entry.actorName ?? "System"}</small>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
