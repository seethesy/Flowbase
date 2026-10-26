import type { Actor } from "../../shared/access";
import type { AuditEntity } from "../../shared/audit";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { emitDomainEvent } from "../jobs/queue";

// Archive and restore for every record that archives (FLOW-192). In one
// transaction: set archived_at, write the audit row when the record is audited,
// and emit <event>.archived or <event>.restored when the record has lifecycle
// events. Checks that must pass first (visibility, stock, unique names) stay with
// each record and run before this.
export async function setArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
  record: {
    // Applies the change to the record's own table.
    update: (
      tx: DbLike,
      values: { archivedAt: Date | null; updatedBy: string },
    ) => Promise<unknown>;
    audit?: {
      entityType: AuditEntity;
      snapshot: (tx: DbLike, id: string) => Promise<Record<string, unknown>>;
    };
    // Domain event prefix, e.g. "client" for client.archived / client.restored.
    event?: string;
  },
) {
  await db.transaction(async (tx) => {
    const before = record.audit ? await record.audit.snapshot(tx, id) : null;
    await record.update(tx, {
      archivedAt: archived ? new Date() : null,
      updatedBy: actor.userId,
    });
    if (record.audit && before)
      await writeAudit(tx, actor, {
        entityType: record.audit.entityType,
        entityId: id,
        action: archived ? "archive" : "restore",
        before,
        after: await record.audit.snapshot(tx, id),
      });
    if (record.event)
      await emitDomainEvent(tx, {
        name: `${record.event}.${archived ? "archived" : "restored"}`,
        entityId: id,
      });
  });
}
