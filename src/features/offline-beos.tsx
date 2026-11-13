import { Link, useParams } from "react-router-dom";
import { useResource } from "../app/useResource";
import { LoadingSkeleton } from "../components/shared";
import { cachedBeo, cachedBeos } from "../offline/db";
import { EventBeoSection } from "./event-beo";

// What Flowbase shows with no signal (FLOW-150, ADR-18): the approved BEOs saved on
// this device, read-only. These screens sit outside the app shell, which needs the
// network. They open straight from the saved copy.

const when = (iso: string) => new Date(iso).toLocaleString();

export function OfflineBeoList() {
  const saved = useResource(["offline-beos"], cachedBeos);
  return (
    <main className="offline-page">
      <h1>BEOs available offline</h1>
      <p className="muted">You're working offline. These BEOs are read-only copies saved on this device.</p>
      {!saved.data ? (
        <LoadingSkeleton />
      ) : saved.data.length === 0 ? (
        <p>
          No BEOs are saved on this device. Open Flowbase with a connection before your event to save your BEOs.
        </p>
      ) : (
        <ul className="beo-list">
          {saved.data.map((row) => (
            <li key={row.eventId}>
              <Link to={`/offline/events/${row.eventId}`}>{row.event.title}</Link>
              <small>
                {row.event.date} · last synced {when(row.syncedAt)}
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
        ← BEOs available offline
      </Link>
      {saved.data ? (
        <>
          <div className="record-heading">
            <h1>{saved.data.event.title}</h1>
          </div>
          <EventBeoSection event={saved.data.event} standalone />
        </>
      ) : (
        <p role="alert">This BEO isn't saved on this device.</p>
      )}
    </main>
  );
}
