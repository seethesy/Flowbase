import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Sop, SopInput, SopSummary, SopUpdate, SopVersion } from "../../shared/sops";
import type { Db, DbLike } from "../db/client";
import { sops, sopVersions, users } from "../db/schema";
import { ApiError, notFound } from "../hono";
import { writeAudit } from "../audit/log";

export async function findSop(db: DbLike, id: string) {
  const [row] = await db.select().from(sops)
    .where(and(eq(sops.id, id), isNull(sops.archivedAt)));
  if (!row) throw notFound("SOP");
  return row;
}

// Owner (FLOW-270 SOPs tab): who created the SOP.
const summary = (row: typeof sops.$inferSelect, owner: string | null = null): SopSummary => ({
  id: row.id, title: row.title, category: row.category,
  version: row.version, updatedAt: row.updatedAt.toISOString(), owner,
});
const ownerName = sql<string | null>`nullif(coalesce(nullif(${users.name}, ''), ${users.email}), '')`;

export async function listSops(db: DbLike, filter: { q?: string; category?: string } = {}) {
  const q = filter.q?.trim().slice(0, 100);
  const rows = await db.select({ sop: sops, owner: ownerName }).from(sops)
    .leftJoin(users, eq(users.id, sops.createdBy))
    .where(and(isNull(sops.archivedAt),
    filter.category ? eq(sops.category, filter.category) : undefined,
    q ? or(ilike(sops.title, `%${q}%`), ilike(sops.category, `%${q}%`),
      sql`${sops.content}::text ilike ${`%${q}%`}`) : undefined))
    .orderBy(sops.category, sops.title).limit(200);
  return rows.map((row) => summary(row.sop, row.owner));
}

export async function getSop(db: DbLike, id: string): Promise<Sop> {
  const row = await findSop(db, id);
  const versions = await db.select({ revision: sopVersions, editorName: users.name,
    editorEmail: users.email }).from(sopVersions)
    .leftJoin(users, eq(users.id, sopVersions.createdBy))
    .where(eq(sopVersions.sopId, id)).orderBy(desc(sopVersions.version));
  const history: SopVersion[] = versions.map(({ revision, editorName, editorEmail }) => ({
    id: revision.id, version: revision.version, title: revision.title,
    category: revision.category, content: revision.content,
    editedBy: revision.createdBy, editorName: editorName || editorEmail || null,
    editedAt: revision.createdAt.toISOString(),
  }));
  const [owner] = row.createdBy
    ? await db.select({ name: ownerName }).from(users).where(eq(users.id, row.createdBy))
    : [];
  return { ...summary(row, owner?.name ?? null), content: row.content, history };
}

export async function createSop(db: Db, actor: Actor, input: SopInput): Promise<Sop> {
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(sops).values({ ...input, version: 1,
      createdBy: actor.userId, updatedBy: actor.userId }).returning({ id: sops.id });
    await tx.insert(sopVersions).values({ sopId: row.id, version: 1, ...input,
      createdBy: actor.userId, updatedBy: actor.userId });
    return row.id;
  });
  return getSop(db, id);
}

export async function updateSop(db: Db, actor: Actor, id: string, input: SopUpdate): Promise<Sop> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(sops)
      .where(and(eq(sops.id, id), isNull(sops.archivedAt))).for("update");
    if (!row) throw notFound("SOP");
    if (row.version !== input.version)
      throw new ApiError(409, "STALE", "This SOP changed since you opened it. Reload and try again.");
    const version = row.version + 1;
    await tx.update(sops).set({ title: input.title, category: input.category,
      content: input.content, version, updatedBy: actor.userId }).where(eq(sops.id, id));
    await tx.insert(sopVersions).values({ sopId: id, version, title: input.title,
      category: input.category, content: input.content, createdBy: actor.userId,
      updatedBy: actor.userId });
  });
  return getSop(db, id);
}

// Delete and Undo from the SOPs tab (FLOW-260 rules, FLOW-270).
export async function setSopArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(sops).where(eq(sops.id, id)).for("update");
    if (!row || (archived && row.archivedAt)) throw notFound("SOP");
    const [updated] = await tx.update(sops)
      .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId })
      .where(eq(sops.id, id)).returning();
    await writeAudit(tx, actor, { entityType: "sop", entityId: id,
      action: archived ? "archive" : "restore", before: summary(row), after: summary(updated) });
    return summary(updated);
  });
}
