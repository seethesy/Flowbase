import { useResource } from "../../app/useResource";
import { clockLabel, dayOfLogCsvHeaders } from "../../../shared/day-of";
import { utcToBusinessTime } from "../../../shared/time";
import { Button, LoadingSkeleton, Section } from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { dayOfApi } from "../../services/day-of";
import { csvFileName, downloadCsv, toCsv } from "../../services/csv";
import { T } from "../../app/copy";

// The Day-of board page and tab were removed (FLOW-294); /day-of redirects to
// Events › Overview. The event's own day-of log stays on the event page.
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
