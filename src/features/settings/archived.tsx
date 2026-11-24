import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useState } from "react";
import { useResource } from "../../app/useResource";
import { usePermissions } from "../../app/permissions";
import { LabelT, T } from "../../app/copy";
import { Button, DateTimeCell, EmptyState, LoadingSkeleton, PageHeader, Section, ErrorText } from "../../components/shared";
import { deletableLabels } from "../../../shared/deletions";
import { utcToBusinessTime } from "../../../shared/time";
import { deletionsApi } from "../../services/deletions";

// FLOW-296: the day with the time beneath it.
const deletedOn = (iso: string) => {
  const at = utcToBusinessTime(new Date(iso));
  return <DateTimeCell date={at.date} time={at.time} />;
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
      <PageHeader pageKey="settings.archived"
        title={<T id="archived.archived-page.title">Archived</T>}
        subtitle={<T id="archived.archived-page.subtitle">Records deleted from a table. Restore puts one back where it was.</T>}
      />
      <ErrorText message={error} />
      <PageGrid pageKey="settings.archived">
      <Block id="records" name="Archived records" h={16}>
      {deleted.error ? (
        <ErrorText message={deleted.error} />
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
                <td><LabelT id="labels.deletable-entity" value={row.entityType}>{deletableLabels[row.entityType]}</LabelT></td>
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
      </Block>
      </PageGrid>
    </>
  );
}
