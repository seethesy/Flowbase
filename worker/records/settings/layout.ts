import { layoutLifecycleChanges } from "../../../shared/layout-deletion";
import { emptyLayout } from "../../../shared/layout";
import { asV2 } from "../../../shared/page-grid";
import { eq, sql } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import type { LayoutDoc, SavedLayout, StoredLayoutDoc } from "../../../shared/layout";
import { writeAudit } from "../../audit/log";
import type { Db, DbLike } from "../../db/client";
import { uiLayout } from "../../db/schema";

// Saved page layouts (FLOW-253): one row per page, shared by everyone. No row
// means the page's code default. Save and reset are audit-logged. A row saved
// as version 1 reads as version 2 (FLOW-321); its next Save stores version 2.

type Row = typeof uiLayout.$inferSelect;
const saved = (row: Row): NonNullable<SavedLayout> => ({
  pageKey: row.pageKey,
  layout: asV2(row.layout),
  updatedAt: row.updatedAt.toISOString(),
  updatedBy: row.updatedBy,
});

export async function getLayout(db: DbLike, pageKey: string): Promise<SavedLayout> {
  const [row] = await db.select().from(uiLayout).where(eq(uiLayout.pageKey, pageKey));
  return row ? saved(row) : null;
}

// Every saved page layout (FLOW-277 orphan report).
export async function listLayouts(db: DbLike): Promise<{ pageKey: string; layout: StoredLayoutDoc }[]> {
  return db.select({ pageKey: uiLayout.pageKey, layout: uiLayout.layout }).from(uiLayout);
}

export async function saveLayout(db: Db, actor: Actor, pageKey: string, layout: LayoutDoc): Promise<SavedLayout> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(uiLayout).where(eq(uiLayout.pageKey, pageKey));
    const [row] = await tx
      .insert(uiLayout)
      .values({ pageKey, layout, createdBy: actor.userId, updatedBy: actor.userId })
      .onConflictDoUpdate({
        target: uiLayout.pageKey,
        set: { layout, updatedBy: actor.userId, updatedAt: sql`now()` },
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "ui_layout",
      entityId: row.id,
      action: before ? "update" : "create",
      before: before ? { pageKey, layout: before.layout } : null,
      after: { pageKey, layout, lifecycle: layoutLifecycleChanges(before?.layout ?? emptyLayout(), layout) },
    });
    return saved(row);
  });
}

// Back to the code default, colors included. Resetting a page with no saved
// layout is a no-op: false (FLOW-304 sends no ping for it).
export async function resetLayout(db: Db, actor: Actor, pageKey: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(uiLayout).where(eq(uiLayout.pageKey, pageKey)).returning();
    if (!row) return false;
    await writeAudit(tx, actor, {
      entityType: "ui_layout",
      entityId: row.id,
      action: "archive",
      before: { pageKey, layout: row.layout },
      after: { pageKey, layout: null },
    });
    return true;
  });
}
