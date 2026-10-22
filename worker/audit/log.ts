import { and, desc, eq } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { AuditEntity, HistoryEntry } from "../../shared/audit";
import type { DbLike } from "../db/client";
import { auditLog, type AuditChanges, type auditActions } from "../db/schema";

// Audit log (FLOW-41). Record modules take a snapshot of the record before and after
// a write, inside the write's transaction, and writeAudit stores the fields that
// changed. Snapshots are the record's API shape, so history uses the same field
// names as the screens. The API exposes no way to update or delete audit rows.
type Snapshot = Record<string, unknown>;
type AuditAction = (typeof auditActions)[number];

// Snapshots record every field whoever writes; history hides fields per caller.
export const fullView: Actor = {
  userId: "00000000-0000-4000-8000-000000000000",
  role: "admin",
  employmentType: "full_time",
};

// Change on every write, or identify the row rather than describe it.
const ignored = new Set(["id", "createdAt", "updatedAt"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffSnapshots(
  before: Snapshot | null,
  after: Snapshot,
): AuditChanges {
  const changes: AuditChanges = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    const from = before?.[key] ?? null;
    const to = after[key] ?? null;
    if (!same(from, to)) changes[key] = { before: from, after: to };
  }
  return changes;
}

// Writes one audit row through the caller's transaction. An update that changed
// nothing writes no row.
export async function writeAudit(
  tx: DbLike,
  actor: Actor,
  entry: {
    entityType: AuditEntity;
    entityId: string;
    action: AuditAction;
    before: Snapshot | null;
    after: Snapshot;
  },
) {
  const changes = diffSnapshots(entry.before, entry.after);
  if (entry.action === "update" && !Object.keys(changes).length) return;
  await tx.insert(auditLog).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    changes,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
}

// Removes what the caller may not see from stored changes.
export type RedactHistory = (changes: AuditChanges) => AuditChanges;

export const hideFields =
  (...keys: string[]): RedactHistory =>
  (changes) =>
    Object.fromEntries(
      Object.entries(changes).filter(([key]) => !keys.includes(key)),
    );

// Masks parts of one field's values; drops the field when nothing visible changed.
export const maskField =
  (key: string, mask: (value: unknown) => unknown): RedactHistory =>
  (changes) => {
    const change = changes[key];
    if (!change) return changes;
    const masked = { before: mask(change.before), after: mask(change.after) };
    if (same(masked.before, masked.after)) return hideFields(key)(changes);
    return { ...changes, [key]: masked };
  };

export const redactAll =
  (...steps: RedactHistory[]): RedactHistory =>
  (changes) =>
    steps.reduce((result, step) => step(result), changes);

// A record's history, newest first. Updates left empty after redaction are hidden
// so the caller can't tell that a hidden field changed.
export async function listHistory(
  db: DbLike,
  entityType: AuditEntity,
  entityId: string,
  redact: RedactHistory,
): Promise<HistoryEntry[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
  return rows.flatMap((row) => {
    const changes = redact(row.changes);
    if (row.action === "update" && !Object.keys(changes).length) return [];
    return [
      {
        id: row.id,
        action: row.action,
        actorId: row.createdBy,
        at: row.createdAt.toISOString(),
        changes,
      },
    ];
  });
}
