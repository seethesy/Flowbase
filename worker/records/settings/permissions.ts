import { isNull, sql } from "drizzle-orm";
import { roles, type Actor, type Role } from "../../../shared/access";
import {
  areas,
  completeMatrix,
  defaultMatrix,
  type AreaKey,
  type Level,
  type Matrix,
} from "../../../shared/role-permissions";
import { writeAudit } from "../../audit/log";
import type { Db, DbLike } from "../../db/client";
import { rolePermissions } from "../../db/schema";

// Roles and permissions (FLOW-269). The matrix lives in role_permissions, one row
// per role and area, seeded from the built-in rules (shared/policy.ts) so
// day-one behavior is unchanged. The Worker keeps it in memory: a save in this
// isolate drops the copy at once, and every other isolate re-reads it after
// POLICY_TTL_MS, so a change is live on the next request.

export const POLICY_TTL_MS = 5_000;
let cached: { matrix: Matrix; at: number } | null = null;
export const invalidatePolicy = () => {
  cached = null;
};

// Every audit row for a save belongs to this one entity.
export const PERMISSIONS_AUDIT_ID = "00000000-0000-4000-8000-000000000269";

type Stored = Partial<Record<Role, Partial<Record<AreaKey, Level>>>>;
async function readStored(db: DbLike): Promise<{ stored: Stored; count: number }> {
  const rows = await db
    .select({ role: rolePermissions.role, area: rolePermissions.area, level: rolePermissions.level })
    .from(rolePermissions)
    .where(isNull(rolePermissions.archivedAt));
  const stored: Stored = {};
  for (const row of rows) (stored[row.role] ??= {})[row.area as AreaKey] = row.level;
  return { stored, count: rows.length };
}

// Inserts any role and area with no row at its seeded level. Safe to repeat and
// to run from two requests at once.
async function seedMissing(db: DbLike, stored: Stored) {
  const missing = roles.flatMap((role) =>
    areas
      .filter((area) => !stored[role]?.[area.key])
      .map((area) => ({ role, area: area.key, level: defaultMatrix[role][area.key] })),
  );
  if (missing.length)
    await db.insert(rolePermissions).values(missing).onConflictDoNothing();
}

export async function loadMatrix(db: DbLike, now = Date.now()): Promise<Matrix> {
  if (cached && now - cached.at < POLICY_TTL_MS) return cached.matrix;
  const { stored, count } = await readStored(db);
  if (count < roles.length * areas.length) await seedMissing(db, stored);
  const matrix = completeMatrix(stored);
  cached = { matrix, at: now };
  return matrix;
}

// The last matrix this isolate loaded, if any (used when a reload fails).
export const lastMatrix = () => cached?.matrix ?? null;

const flat = (matrix: Matrix) =>
  Object.fromEntries(
    roles.flatMap((role) => areas.map((area) => [`${role}.${area.key}`, matrix[role][area.key]])),
  );

// Saves the whole matrix, audit-logged with before and after for every cell that
// changed. Admin's cells are already checked to stay at write.
export async function saveMatrix(db: Db, actor: Actor, next: Matrix): Promise<Matrix> {
  const saved = await db.transaction(async (tx) => {
    const { stored } = await readStored(tx);
    await seedMissing(tx, stored);
    const before = completeMatrix((await readStored(tx)).stored);
    const changed = roles.flatMap((role) =>
      areas.filter((area) => before[role][area.key] !== next[role][area.key]).map((area) => ({ role, area })),
    );
    for (const { role, area } of changed)
      await tx
        .insert(rolePermissions)
        .values({
          role,
          area: area.key,
          level: next[role][area.key],
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [rolePermissions.role, rolePermissions.area],
          set: { level: next[role][area.key], updatedBy: actor.userId, updatedAt: sql`now()` },
        });
    await writeAudit(tx, actor, {
      entityType: "role_permissions",
      entityId: PERMISSIONS_AUDIT_ID,
      action: "update",
      before: flat(before),
      after: flat(next),
    });
    return next;
  });
  invalidatePolicy();
  cached = { matrix: saved, at: Date.now() };
  return saved;
}
