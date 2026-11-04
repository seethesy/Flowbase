import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Sop, SopInput, SopSummary, SopUpdate, SopVersion } from "../../shared/sops";
import type { Db, DbLike } from "../db/client";
import { sops, sopVersions, users } from "../db/schema";
import { ApiError, notFound } from "../hono";

export async function findSop(db: DbLike, id: string) {
  const [row] = await db.select().from(sops)
    .where(and(eq(sops.id, id), isNull(sops.archivedAt)));
  if (!row) throw notFound("SOP");
  return row;
}

const summary = (row: typeof sops.$inferSelect): SopSummary => ({
  id: row.id, title: row.title, category: row.category,
  version: row.version, updatedAt: row.updatedAt.toISOString(),
});

export async function listSops(db: DbLike, filter: { q?: string; category?: string } = {}) {
  const q = filter.q?.trim().slice(0, 100);
  const rows = await db.select().from(sops).where(and(isNull(sops.archivedAt),
    filter.category ? eq(sops.category, filter.category) : undefined,
    q ? or(ilike(sops.title, `%${q}%`), ilike(sops.category, `%${q}%`),
      sql`${sops.content}::text ilike ${`%${q}%`}`) : undefined))
    .orderBy(sops.category, sops.title).limit(200);
  return rows.map(summary);
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
  return { ...summary(row), content: row.content, history };
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
