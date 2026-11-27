import { eq, sql } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import type { AreaNote, AreaNoteInput, AreaNoteKey } from "../../../shared/area-notes";
import type { DbLike } from "../../db/client";
import { areaNotes, users } from "../../db/schema";

// Shared area notes (FLOW-341 A2): read and saved by anyone who sees the tab.

export async function getAreaNote(db: DbLike, key: AreaNoteKey): Promise<AreaNote> {
  const [row] = await db
    .select({ body: areaNotes.body, updatedAt: areaNotes.updatedAt, updatedByName: users.name })
    .from(areaNotes)
    .leftJoin(users, eq(users.id, areaNotes.updatedBy))
    .where(eq(areaNotes.key, key));
  return {
    key,
    body: row?.body ?? "",
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedByName: row?.updatedByName ?? null,
  };
}

export async function saveAreaNote(db: DbLike, actor: Actor, key: AreaNoteKey, input: AreaNoteInput): Promise<AreaNote> {
  await db
    .insert(areaNotes)
    .values({ key, body: input.body, createdBy: actor.userId, updatedBy: actor.userId })
    .onConflictDoUpdate({
      target: areaNotes.key,
      set: { body: input.body, updatedBy: actor.userId, updatedAt: sql`now()` },
    });
  return getAreaNote(db, key);
}
