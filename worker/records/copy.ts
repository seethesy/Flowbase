import { and, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { CopyEdit, CopyOverrides } from "../../shared/copy";
import type { DbLike } from "../db/client";
import { uiCopy } from "../db/schema";

// Live text editing (FLOW-240): overrides of the app's built-in wording. A key
// with no live row shows the default in the code.

export async function getCopyOverrides(db: DbLike): Promise<CopyOverrides> {
  const rows = await db
    .select({ key: uiCopy.key, text: uiCopy.text })
    .from(uiCopy)
    .where(isNull(uiCopy.archivedAt));
  return Object.fromEntries(rows.map((row) => [row.key, row.text]));
}

// Saves every edit or none. Saving a reset key brings its row back.
export async function saveCopyOverrides(db: DbLike, actor: Actor, edits: CopyEdit[]) {
  await db.transaction(async (tx) => {
    for (const edit of edits)
      await tx
        .insert(uiCopy)
        .values({
          key: edit.key,
          text: edit.text,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: uiCopy.key,
          set: {
            text: edit.text,
            updatedBy: actor.userId,
            updatedAt: sql`now()`,
            archivedAt: null,
          },
        });
  });
  return getCopyOverrides(db);
}

// Back to the default in the code. Resetting a key with no override is a no-op.
export async function resetCopyOverride(db: DbLike, actor: Actor, key: string) {
  await db
    .update(uiCopy)
    .set({ archivedAt: sql`now()`, updatedBy: actor.userId })
    .where(and(eq(uiCopy.key, key), isNull(uiCopy.archivedAt)));
  return getCopyOverrides(db);
}
