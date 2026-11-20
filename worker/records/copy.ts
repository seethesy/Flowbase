import { eq, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { CopyEdit, CopyOverrides } from "../../shared/copy";
import type { Db, DbLike } from "../db/client";
import { uiCopy } from "../db/schema";

// Admin live text editing (FLOW-240): overrides of the app's built-in wording.

export async function listCopy(db: DbLike): Promise<CopyOverrides> {
  const rows = await db.select({ key: uiCopy.key, text: uiCopy.text }).from(uiCopy);
  return Object.fromEntries(rows.map((row) => [row.key, row.text]));
}

// One transaction: every edit in the batch is saved, or none is.
export async function saveCopy(db: Db, actor: Actor, edits: CopyEdit[]): Promise<CopyOverrides> {
  await db.transaction(async (tx) => {
    for (const edit of edits)
      await tx
        .insert(uiCopy)
        .values({ key: edit.key, text: edit.text, createdBy: actor.userId, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: uiCopy.key,
          set: { text: edit.text, updatedBy: actor.userId, updatedAt: sql`now()` },
        });
  });
  return listCopy(db);
}

// Reset to the default in code. Resetting a key with no override is a no-op.
export async function resetCopy(db: DbLike, key: string): Promise<void> {
  await db.delete(uiCopy).where(eq(uiCopy.key, key));
}
