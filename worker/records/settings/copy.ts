import { eq, inArray, sql } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import type { CopyEdit, CopyOverrides } from "../../../shared/copy";
import { copyAliases, liveEditRenames, type LiveEditRenames } from "../../../shared/live-edit-renames";
import type { Db, DbLike } from "../../db/client";
import { uiCopy } from "../../db/schema";

// Admin live text editing (FLOW-240): overrides of the app's built-in wording.
// Rows are stored under the key they were saved with; GET /api/copy reads them
// through shared/live-edit-renames.ts (FLOW-277).

export async function listCopy(db: DbLike): Promise<CopyOverrides> {
  const rows = await db.select({ key: uiCopy.key, text: uiCopy.text }).from(uiCopy);
  return Object.fromEntries(rows.map((row) => [row.key, row.text]));
}

// One transaction: every edit in the batch is saved, or none is. Saving a key
// drops rows under its old (renamed) keys, so the alias can later be removed.
export async function saveCopy(
  db: Db,
  actor: Actor,
  edits: CopyEdit[],
  renames: LiveEditRenames = liveEditRenames,
): Promise<CopyOverrides> {
  await db.transaction(async (tx) => {
    for (const edit of edits) {
      await tx
        .insert(uiCopy)
        .values({ key: edit.key, text: edit.text, createdBy: actor.userId, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: uiCopy.key,
          set: { text: edit.text, updatedBy: actor.userId, updatedAt: sql`now()` },
        });
      const aliases = copyAliases(edit.key, renames);
      if (aliases.length) await tx.delete(uiCopy).where(inArray(uiCopy.key, aliases));
    }
  });
  return listCopy(db);
}

// Reset to the default in code, old (renamed) keys included, or the alias
// would bring the override back. Resetting a key with no override is a no-op:
// false (FLOW-304 sends no ping for it).
export async function resetCopy(db: DbLike, key: string, renames: LiveEditRenames = liveEditRenames): Promise<boolean> {
  const removed = await db
    .delete(uiCopy)
    .where(inArray(uiCopy.key, [key, ...copyAliases(key, renames)]))
    .returning({ key: uiCopy.key });
  return removed.length > 0;
}

// An orphaned row (FLOW-277): delete it as it is.
export async function deleteCopyRow(db: DbLike, key: string): Promise<void> {
  await db.delete(uiCopy).where(eq(uiCopy.key, key));
}

// An orphaned row moved to a key a screen renders: replaces that key's text.
export async function moveCopy(db: Db, actor: Actor, from: string, to: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ text: uiCopy.text }).from(uiCopy).where(eq(uiCopy.key, from));
    if (!row) return false;
    await tx
      .insert(uiCopy)
      .values({ key: to, text: row.text, createdBy: actor.userId, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: uiCopy.key, set: { text: row.text, updatedBy: actor.userId, updatedAt: sql`now()` } });
    await tx.delete(uiCopy).where(eq(uiCopy.key, from));
    return true;
  });
}
