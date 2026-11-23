import { Dropdown } from "../components/ui/Dropdown";
import { Block, PageGrid } from "../app/page-grid";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  clockLabel,
  dayOfLogCsvHeaders,
  dayOfStaffStatuses,
  dayOfStaffStatusLabels,
  dayOfTruckStatusLabels,
  type DayOfCheckpoint,
  type DayOfEvent,
  type DayOfStaff,
  type DayOfTruck,
} from "../../shared/day-of";
import { truckStatuses } from "../../shared/trucks";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { useResource } from "../app/useResource";
import { Button, EditableCell, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { StatusPill } from "../components/ui/status-pill";
import { dayOfApi } from "../services/day-of";
import { csvFileName, downloadCsv, toCsv } from "../services/csv";
import { T, LabelT, useCopy } from "../app/copy";
import { EventsHeading } from "./events-heading";
import "./day-of.css";

// "4:00 PM", as the board's checkpoints read (FLOW-265).
const time12 = (instant: string) => {
  const [hours, minutes] = utcToBusinessTime(new Date(instant)).time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};
const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

const staffTone: Record<DayOfStaff["status"], string> = {
  scheduled: "badge neutral",
  en_route: "badge day-of-en-route",
  on_site: "badge info",
  working: "badge success",
  on_break: "badge warning",
  done: "badge neutral",
};
const truckTone: Record<DayOfTruck["status"], string> = {
  available: "badge success",
  loading: "badge warning",
  en_route: "badge day-of-en-route",
  at_event: "badge info",
  returning: "badge info",
  maintenance: "badge error",
};

// The Events screen's Day-of tab (FLOW-265; the live board, FLOW-155). Phone
// first: one card per event with its four checkpoints (planned and actual, and
// "Record now"), staff and trucks with status pill dropdowns, Mark urgent, and
// the event's day-of log with an add-note box. Everyone who can open an event
// sees it; managers also get the controls. Mark urgent is per card (A2): while
// on, that card's updates text the people affected. Other people's updates
// arrive through the shared freshness service, so nothing here polls.
export function DayOfPage() {
  const [params, setParams] = useSearchParams();
  const today = utcToBusinessTime(new Date()).date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const board = useResource(["day-of", date], () => dayOfApi.board(date));
  const [exportError, setExportError] = useState("");
  const go = (next: string) => setParams(next === today ? {} : { date: next });
  // Every event's log entries made on this date, oldest first.
  const exportCsv = async () => {
    setExportError("");
    try {
      const logs = await Promise.all((board.data?.events ?? []).map((event) => dayOfApi.log(event.id)));
      const rows = logs
        .flatMap((log) => log.entries.map((entry) => ({ entry, title: board.data!.events.find((event) => event.id === log.eventId)?.title ?? "" })))
        .filter(({ entry }) => utcToBusinessTime(new Date(entry.at)).date === date)
        .sort((a, b) => a.entry.at.localeCompare(b.entry.at))
        .map(({ entry, title }) => {
          const { date: day, time } = utcToBusinessTime(new Date(entry.at));
          return [title, day, time, entry.kind, entry.truckName ?? "", entry.subjectName, entry.summary, entry.urgent, entry.actorName ?? ""];
        });
      downloadCsv(csvFileName(`day-of ${date}`), toCsv(["Event", ...dayOfLogCsvHeaders], rows));
    } catch (cause) {
      setExportError((cause as Error).message);
    }
  };

  return (
    <>
      <EventsHeading tab="day-of">
        <Button variant="outline" onClick={() => void exportCsv()} disabled={!board.data?.events.length}>
          <T id="day-of.day-of-page.export-csv">Export CSV</T>
        </Button>
      </EventsHeading>
      <div className="day-of-stepper">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => go(addLocalDays(date, -1))}>‹</Button>
        <Button variant="outline" onClick={() => go(today)}><T id="day-of.day-of-page.today-button">Today</T></Button>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => go(addLocalDays(date, 1))}>›</Button>
        <h2>
          {longDate(date)}
          {date === today && <T id="day-of.day-of-page.today-suffix">{" · Today"}</T>}
        </h2>
      </div>
      <PageGrid pageKey="day-of.board">
      <Block id="events" name="Events" h={30}>
      {exportError && <p role="alert" className="error-message">{exportError}</p>}
      {board.error && <LoadError message={board.error} />}
      {!board.data && !board.error && <LoadingSkeleton />}
      {board.data && !board.data.events.length && <p><T id="day-of.day-of-page.no-events-on-this-date">No events on this date.</T></p>}
      {board.data?.events.map((event) => (
        <DayOfCard key={event.id} event={event} canUpdate={board.data!.canUpdate} onChanged={board.reload} />
      ))}
      </Block>
      </PageGrid>
    </>
  );
}

function DayOfCard({ event, canUpdate, onChanged }: { event: DayOfEvent; canUpdate: boolean; onChanged: () => void }) {
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const log = useResource(["day-of-log", event.id], () => dayOfApi.log(event.id));
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
      log.reload();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const service = time12(event.startsAt);
  return (
    <section className="day-of-card" aria-label={event.title}>
      <header className="day-of-card-head">
        <h2>{event.title}</h2>
        <StatusPill status={event.status} />
        <span className="day-of-card-meta">
          {event.venueName && <>{event.venueName} · </>}
          {event.guestCount != null && <T id="day-of.card.guests" values={{ count: event.guestCount }}>{"{count} guests · "}</T>}
          <T id="day-of.card.service" values={{ time: service }}>{"Service {time}"}</T>
        </span>
        {canUpdate && (
          <Button variant={urgent ? "default" : "outline"} aria-pressed={urgent} onClick={() => setUrgent(!urgent)}
            title="While on, updates on this card text the people affected">
            {urgent ? <T id="day-of.card.urgent-on">Urgent on</T> : <T id="day-of.card.mark-urgent">Mark urgent</T>}
          </Button>
        )}
      </header>
      {error && <p role="alert" className="error-message">{error}</p>}
      {event.checkpoints.length > 0 && (
        <ul aria-label={`${event.title} timeline`} className="day-of-checkpoints">
          {event.checkpoints.map((checkpoint) => (
            <CheckpointCell
              key={checkpoint.key}
              checkpoint={checkpoint}
              canUpdate={canUpdate}
              busy={busy}
              onToggle={() =>
                void run(() => dayOfApi.setCheckpoint(event.id, checkpoint.key, { reached: !checkpoint.reachedAt, urgent }))
              }
            />
          ))}
        </ul>
      )}
      <div className="day-of-columns">
        <div>
          <h3><T id="day-of.card.staff-count" values={{ count: event.staff.length }}>{"Staff ({count})"}</T></h3>
          {!event.staff.length && <p className="muted"><T id="day-of.day-of-page.no-staff-scheduled">No staff scheduled.</T></p>}
          <ul aria-label={`${event.title} staff`} className="day-of-rows">
            {event.staff.map((member) => (
              <li key={member.slotId}>
                <strong>{member.name}</strong>
                <span className="muted">{member.position}</span>
                <StatusChoice
                  label={`${member.name} status`}
                  value={member.status}
                  options={dayOfStaffStatuses.map((value) => ({ value, label: <LabelT id="labels.day-of-staff-status" value={value}>{dayOfStaffStatusLabels[value]}</LabelT>, text: dayOfStaffStatusLabels[value] }))}
                  tone={(value) => staffTone[value as DayOfStaff["status"]]}
                  disabled={!canUpdate || busy}
                  onChange={(value) => void run(() => dayOfApi.updateStaff(member.slotId, { status: value as DayOfStaff["status"], urgent }))}
                />
                {canUpdate ? (
                  <EditableCell label={`${member.name} location`} row={member} edit="text" value={member.location}
                    save={(_row, location) => run(() => dayOfApi.updateStaff(member.slotId, { location, urgent })).then((ok) => { if (!ok) throw new Error("Not saved."); })} />
                ) : member.location ? <small>{member.location}</small> : null}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3><T id="day-of.day-of-page.trucks">Trucks</T></h3>
          {!event.trucks.length && <p className="muted"><T id="day-of.day-of-page.no-trucks-assigned">No trucks assigned.</T></p>}
          <ul aria-label={`${event.title} trucks`} className="day-of-rows">
            {event.trucks.map((truck) => (
              <li key={truck.assignmentId}>
                <strong>{truck.name}</strong>
                <span className="muted">{truck.driverName ?? <T id="day-of.truck-row.unassigned">Unassigned</T>}</span>
                <StatusChoice
                  label={`${truck.name} status`}
                  value={truck.status}
                  options={truckStatuses.map((value) => ({ value, label: <LabelT id="labels.day-of-truck-status" value={value}>{dayOfTruckStatusLabels[value]}</LabelT>, text: dayOfTruckStatusLabels[value] }))}
                  tone={(value) => truckTone[value as DayOfTruck["status"]]}
                  disabled={!canUpdate || busy}
                  onChange={(value) => void run(() => dayOfApi.updateTruck(truck.assignmentId, { status: value as DayOfTruck["status"], urgent }))}
                />
                {canUpdate ? (
                  <EditableCell label={`${truck.name} location`} row={truck} edit="text" value={truck.location}
                    save={(_row, location) => run(() => dayOfApi.updateTruck(truck.assignmentId, { location, urgent })).then((ok) => { if (!ok) throw new Error("Not saved."); })} />
                ) : truck.location ? <small>{truck.location}</small> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="day-of-log">
        <h3><T id="day-of.event-day-of-section.day-of-log">Day-of log</T></h3>
        {log.error && <LoadError message={log.error} />}
        <ul aria-label={`${event.title} day-of log`}>
          {(log.data?.entries ?? []).map((entry) => (
            <li key={entry.id}>
              <small>{time12(entry.at)}</small>
              <span>
                {entry.urgent && <span className="badge error"><T id="day-of.event-day-of-section.urgent">Urgent</T></span>}{" "}
                <strong>{entry.actorName ?? <T id="day-of.event-day-of-section.system">System</T>}</strong> · {entry.summary}
              </span>
            </li>
          ))}
        </ul>
        {canUpdate && (
          <form
            className="day-of-note"
            onSubmit={(submit) => {
              submit.preventDefault();
              const text = note.trim();
              if (text) void run(() => dayOfApi.addNote(event.id, { text, urgent })).then((ok) => ok && setNote(""));
            }}
          >
            <NoteInput value={note} onChange={setNote} label={`Note for ${event.title}`} />
            <Button type="submit" disabled={busy || !note.trim()}><T id="day-of.card.add">Add</T></Button>
          </form>
        )}
      </div>
    </section>
  );
}

function NoteInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const placeholder = useCopy("day-of.card.add-a-note.placeholder", "Add a note (e.g. guest count changed to 64)");
  return <input aria-label={label} value={value} maxLength={1000} placeholder={placeholder} data-copy-id="day-of.card.add-a-note.placeholder" onChange={(e) => onChange(e.target.value)} />;
}

// A staff or truck status as a pill dropdown (FLOW-259), or a plain pill for
// anyone who only watches.
function StatusChoice({ label, value, options, tone, disabled, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: ReactNode; text: string }[];
  tone: (value: string) => string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Dropdown variant="pill" aria-label={label} value={value} pill={tone} disabled={disabled}
      options={options} onValueChange={(next) => next !== value && onChange(next)} />
  );
}

function CheckpointCell({
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
    <li className={checkpoint.reachedAt ? "reached" : undefined}>
      <small>{checkpoint.label}</small>
      <span>
        {checkpoint.plannedAt
          ? <T id="day-of.checkpoint.planned" values={{ time: time12(checkpoint.plannedAt) }}>{"Planned {time}"}</T>
          : <T id="day-of.checkpoint.no-plan">No planned time</T>}
      </span>
      {checkpoint.reachedAt ? (
        <span className="day-of-actual">
          <T id="day-of.checkpoint.actual" values={{ time: time12(checkpoint.reachedAt) }}>{"Actual {time}"}</T>
          {checkpoint.reachedByName && <small> · {checkpoint.reachedByName}</small>}
          {canUpdate && (
            <button type="button" className="day-of-clear" disabled={busy} aria-label={`Clear ${checkpoint.label}`} onClick={onToggle}>
              <T id="day-of.checkpoint-row.clear">Clear</T>
            </button>
          )}
        </span>
      ) : canUpdate ? (
        <Button variant="outline" disabled={busy} aria-label={`Record ${checkpoint.label} now`} onClick={onToggle}>
          <T id="day-of.checkpoint.record-now">Record now</T>
        </Button>
      ) : (
        <span className="muted"><T id="day-of.checkpoint.not-yet">Not yet</T></span>
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
