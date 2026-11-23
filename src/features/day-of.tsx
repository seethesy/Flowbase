import { Dropdown } from "../components/ui/Dropdown";
import { Block, PageGrid } from "../app/page-grid";
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
import { RoundCheck } from "../components/ui/round-check";
import { T, LabelT } from "../app/copy";

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
          <h1><T id="day-of.day-of-page.day-of-board">Day-of board</T></h1>
          <p>{date === today ? <T id="day-of.day-of-page.today">Today</T> : date}</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => go(addLocalDays(date, -1))}><T id="day-of.day-of-page.previous-day">Previous day</T></Button>
          <input type="date" aria-label="Board date" value={date} onChange={(e) => e.target.value && go(e.target.value)} />
          <Button variant="ghost" onClick={() => go(addLocalDays(date, 1))}><T id="day-of.day-of-page.next-day">Next day</T></Button>
        </div>
      </div>
      {board.error && <LoadError message={board.error} />}
      {!board.data && !board.error && <LoadingSkeleton />}
      {error && <p role="alert" className="error-message">{error}</p>}
      <PageGrid pageKey="day-of.board">
      <Block id="urgent" name="Urgent texts" h={2}>
      {board.data?.canUpdate && (
        <label>
          <RoundCheck checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /><T id="day-of.day-of-page.urgent-text-the-people-affected">{" Urgent: text the people affected"}</T>
        </label>
      )}
      </Block>
      <Block id="events" name="Events" h={30}>
      {board.data && !board.data.events.length && <p><T id="day-of.day-of-page.no-events-on-this-date">No events on this date.</T></p>}
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
          <h3><T id="day-of.day-of-page.trucks">Trucks</T></h3>
          {!event.trucks.length && <p><T id="day-of.day-of-page.no-trucks-assigned">No trucks assigned.</T></p>}
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
          <h3><T id="day-of.day-of-page.staff">Staff</T></h3>
          {!event.staff.length && <p><T id="day-of.day-of-page.no-staff-scheduled">No staff scheduled.</T></p>}
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
      </Block>
      </PageGrid>
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
          ? checkpoint.reachedByName
            ? <T id="day-of.checkpoint-row.reached-by" values={{ clock: clock(checkpoint.reachedAt), name: checkpoint.reachedByName }}>{"Reached {clock} by {name}"}</T>
            : <T id="day-of.checkpoint-row.reached" values={{ clock: clock(checkpoint.reachedAt) }}>{"Reached {clock}"}</T>
          : checkpoint.plannedAt
            ? <T id="day-of.checkpoint-row.planned" values={{ clock: clock(checkpoint.plannedAt) }}>{"Planned {clock}"}</T>
            : <T id="day-of.checkpoint-row.not-marked">Not marked</T>}
      </span>
      {canUpdate && (
        <Button
          variant="ghost"
          disabled={busy}
          aria-label={`${checkpoint.reachedAt ? "Clear" : "Mark"} ${checkpoint.label}`}
          onClick={onToggle}
        >
          {checkpoint.reachedAt ? <T id="day-of.checkpoint-row.clear">Clear</T> : <T id="day-of.checkpoint-row.mark-now">Mark now</T>}
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
      <span><T id="day-of.truck-row.driver">{"Driver: "}</T>{truck.driverName ?? <T id="day-of.truck-row.unassigned">Unassigned</T>}</span>
      {canUpdate ? (
        <>
          <Dropdown
            aria-label={`${truck.name} status`}
            value={truck.status}
            disabled={busy}
            onChange={(e) => onSave({ status: e.target.value as DayOfTruck["status"] })}
          >
            {truckStatuses.map((status) => (
              <option key={status} value={status}>{dayOfTruckStatusLabels[status]}</option>
            ))}
          </Dropdown>
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
            <T id="day-of.truck-row.save">Save</T>
          </Button>
        </>
      ) : (
        <span><LabelT id="labels.day-of-truck-status" value={truck.status}>{dayOfTruckStatusLabels[truck.status]}</LabelT>{truck.location ? ` · ${truck.location}` : ""}</span>
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
          <Dropdown
            aria-label={`${member.name} status`}
            value={member.status}
            disabled={busy}
            onChange={(e) => onSave({ status: e.target.value as DayOfStaff["status"] })}
          >
            {dayOfStaffStatuses.map((status) => (
              <option key={status} value={status}>{dayOfStaffStatusLabels[status]}</option>
            ))}
          </Dropdown>
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
            <T id="day-of.staff-row.save">Save</T>
          </Button>
        </>
      ) : (
        <span><LabelT id="labels.day-of-staff-status" value={member.status}>{dayOfStaffStatusLabels[member.status]}</LabelT>{member.location ? ` · ${member.location}` : ""}</span>
      )}
    </li>
  );
}

// The event's day-of log on the event hub (FLOW-156): who changed what and when,
// newest first, exportable. Visible to everyone who can open the event, including
// after it is completed.
export function EventDayOfSection({ event }: { event: { id: string; title: string } }) {
  const log = useResource(["day-of-log", event.id], () => dayOfApi.log(event.id));
  if (log.error) return <Section title={<T id="day-of.event-day-of-section.day-of-log">Day-of log</T>}><LoadError message={log.error} /></Section>;
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
      title={<T id="day-of.event-day-of-section.day-of-log">Day-of log</T>}
      action={entries.length ? <Button variant="ghost" onClick={exportCsv}><T id="day-of.event-day-of-section.export-csv">Export CSV</T></Button> : undefined}
    >
      {!entries.length && <p><T id="day-of.event-day-of-section.no-day-of-updates-yet">No day-of updates yet.</T></p>}
      {truncated && <p><T id="day-of.event-day-of-section.showing-the-latest-updates" values={{ entriesCount: entries.length }}>{"Showing the latest {entriesCount} updates."}</T></p>}
      <ul aria-label="Day-of log" className="planning-list">
        {entries.map((entry) => {
          const { date, time } = utcToBusinessTime(new Date(entry.at));
          return (
            <li key={entry.id} className="planning-row">
              <small>{date} {clockLabel(time)}</small>
              <span>{entry.urgent && <span className="badge error"><T id="day-of.event-day-of-section.urgent">Urgent</T></span>} {entry.summary}</span>
              <small>{entry.actorName ?? <T id="day-of.event-day-of-section.system">System</T>}</small>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
