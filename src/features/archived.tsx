import { useState } from "react";
import { useResource } from "../app/useResource";
import { usePermissions } from "../app/permissions";
import { T } from "../app/copy";
import { Button, EmptyState, LoadingSkeleton, PageHeader, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { deletableLabels } from "../../shared/deletions";
import { utcToBusinessTime } from "../../shared/time";
import { deletionsApi } from "../services/deletions";

const deletedOn = (iso: string) => {
  const at = utcToBusinessTime(new Date(iso));
  return `${at.date} ${at.time}`;
};

// Settings › Archived (FLOW-260): records deleted from a table, newest first. The
// Admin restores one here once its Undo toast has gone.
export function ArchivedPage() {
  const { can } = usePermissions();
  const deleted = useResource(["deletions"], deletionsApi.list);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  if (!can("settings.manage"))
    return <p role="alert"><T id="archived.archived-page.no-access">Only an Admin can restore deleted records.</T></p>;
  return (
    <>
      <PageHeader
        title={<T id="archived.archived-page.title">Archived</T>}
        subtitle={<T id="archived.archived-page.subtitle">Records deleted from a table. Restore puts one back where it was.</T>}
      />
      {error && <p role="alert" className="error-message">{error}</p>}
      {deleted.error ? (
        <LoadError message={deleted.error} />
      ) : !deleted.data ? (
        <LoadingSkeleton />
      ) : !deleted.data.length ? (
        <EmptyState title={<T id="archived.archived-page.empty">Nothing has been deleted.</T>} description={<T id="archived.archived-page.empty-hint">Deleted records show here until they are restored.</T>} />
      ) : (
        <Section title={<T id="archived.archived-page.deleted-records">Deleted records</T>}>
          <div className="table-card"><div className="table-scroll"><table>
            <thead><tr>
              <th><T id="archived.archived-page.column.name">Name</T></th>
              <th><T id="archived.archived-page.column.type">Type</T></th>
              <th><T id="archived.archived-page.column.deleted">Deleted</T></th>
              <th><T id="archived.archived-page.column.deleted-by">Deleted by</T></th>
              <th />
            </tr></thead>
            <tbody>{deleted.data.map((row) => (
              <tr key={row.id}>
                <td>{row.name || "—"}</td>
                <td>{deletableLabels[row.entityType]}</td>
                <td>{deletedOn(row.deletedAt)}</td>
                <td>{row.deletedBy?.name || "—"}</td>
                <td>
                  <Button variant="outline" disabled={busy === row.id} aria-label={`Restore ${row.name}`} onClick={async () => {
                    setBusy(row.id);
                    setError("");
                    try {
                      await deletionsApi.restore(row.entityType, [row.entityId]);
                      deleted.reload();
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}><T id="archived.archived-page.restore">Restore</T></Button>
                </td>
              </tr>
            ))}</tbody>
          </table></div></div>
        </Section>
      )}
    </>
  );
}
