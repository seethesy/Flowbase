import { isNull, sql } from "drizzle-orm";
import { roles, type Actor } from "../../../shared/access";
import { normalizeNavHidden, type NavHidden } from "../../../shared/nav-visibility";
import { writeAudit } from "../../audit/log";
import type { Db, DbLike } from "../../db/client";
import { roleNavHidden } from "../../db/schema";

// Which roles see each sidebar heading and tab (FLOW-284), one row per role in
// role_nav_hidden. A role with no row hides nothing.

// Every audit row for a save belongs to this one entity.
export const NAV_VISIBILITY_AUDIT_ID = "00000000-0000-4000-8000-000000000284";

export async function loadNavHidden(db: DbLike): Promise<NavHidden> {
  const rows = await db
    .select({ role: roleNavHidden.role, hidden: roleNavHidden.hidden })
    .from(roleNavHidden)
    .where(isNull(roleNavHidden.archivedAt));
  return normalizeNavHidden(Object.fromEntries(rows.map((row) => [row.role, row.hidden])));
}

// Saves every role's list, audit-logged with the lists before and after.
// Admin's list is already checked to be empty.
export async function saveNavHidden(db: Db, actor: Actor, next: NavHidden): Promise<NavHidden> {
  const saved = normalizeNavHidden(next);
  return db.transaction(async (tx) => {
    const before = await loadNavHidden(tx);
    const changed = roles.filter((role) => JSON.stringify(before[role]) !== JSON.stringify(saved[role]));
    if (!changed.length) return before;
    for (const role of changed)
      await tx
        .insert(roleNavHidden)
        .values({ role, hidden: saved[role], createdBy: actor.userId, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: roleNavHidden.role,
          set: { hidden: saved[role], archivedAt: null, updatedBy: actor.userId, updatedAt: sql`now()` },
        });
    await writeAudit(tx, actor, {
      entityType: "role_nav_hidden",
      entityId: NAV_VISIBILITY_AUDIT_ID,
      action: "update",
      before: Object.fromEntries(changed.map((role) => [role, before[role]])),
      after: Object.fromEntries(changed.map((role) => [role, saved[role]])),
    });
    return saved;
  });
}
