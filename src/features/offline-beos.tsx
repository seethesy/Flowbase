import { Link, useParams } from "react-router-dom";
import { useResource } from "../app/useResource";
import { LoadingSkeleton } from "../components/shared";
import { cachedBeo, cachedBeos } from "../offline/db";
import { EventBeoSection } from "./event-beo";
import { T } from "../app/live-copy";

// What Flowbase shows with no signal (FLOW-150, ADR-18): the approved BEOs saved on
// this device, read-only. These screens sit outside the app shell, which needs the
// network. They open straight from the saved copy.

const when = (iso: string) => new Date(iso).toLocaleString();

export function OfflineBeoList() {
  const saved = useResource(["offline-beos"], cachedBeos);
  return (
    <main className="offline-page">
      <h1><T id="offline-beos.offline-beo-list.beos-available-offline">BEOs available offline</T></h1>
      <p className="muted"><T id="offline-beos.offline-beo-list.you-re-working-offline-these-beos">{"You're working offline. These BEOs are read-only copies saved on this device."}</T></p>
      {!saved.data ? (
        <LoadingSkeleton />
      ) : saved.data.length === 0 ? (
        <p>
          <T id="offline-beos.offline-beo-list.no-beos-are-saved-on-this">No BEOs are saved on this device. Open Flowbase with a connection before your event to save your BEOs.</T>
        </p>
      ) : (
        <ul className="beo-list">
          {saved.data.map((row) => (
            <li key={row.eventId}>
              <Link to={`/offline/events/${row.eventId}`}>{row.event.title}</Link>
              <small>
                <T id="offline-beos.offline-beo-list.last-synced" values={{ date: row.event.date, syncedAt: when(row.syncedAt) }}>{"{date} · last synced {syncedAt}"}</T>
              </small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function OfflineBeoPage() {
  const { id = "" } = useParams();
  const saved = useResource(["offline-beo", id], () => cachedBeo(id));
  if (!saved.data && saved.loading) return <LoadingSkeleton />;
  return (
    <main className="offline-page">
      <Link to="/offline" className="back-link">
        <T id="offline-beos.offline-beo-page.beos-available-offline">← BEOs available offline</T>
      </Link>
      {saved.data ? (
        <>
          <div className="record-heading">
            <h1>{saved.data.event.title}</h1>
          </div>
          <EventBeoSection event={saved.data.event} standalone />
        </>
      ) : (
        <p role="alert"><T id="offline-beos.offline-beo-page.this-beo-isn-t-saved-on">{"This BEO isn't saved on this device."}</T></p>
      )}
    </main>
  );
}
