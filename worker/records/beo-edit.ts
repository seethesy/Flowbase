import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type {
  BeoAreaInput,
  BeoAreaKind,
  BeoAreaUpdate,
  BeoSceneInput,
  BeoView,
  CleanupInput,
  LayoutCopyInput,
  RunOfShowInput,
} from "../../shared/beo";
import type { Db, DbLike } from "../db/client";
import { beoAreas, beoChecklistItems, beoRunOfShow, beos, eventAreas, events, venueAreas } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { can } from "../policy";
import { findBeo, getBeo, syncBeo } from "./beo";
import { findVisibleEvent, lockVisibleEvent } from "./events";

// Edits to the parts of a BEO that have rows of their own (FLOW-145, 146, 147):
// the run of show, setup and layout areas, and the cleanup checklist. Each edit
// runs in one transaction with the BEO change check (syncBeo), so a change made
// after approval is logged and can send the BEO back for approval (FLOW-144).
// Checking a cleanup item off during breakdown is not an edit of the BEO.

type BeoRow = typeof beos.$inferSelect;

async function edit(
  db: Db,
  actor: Actor,
  eventId: string,
  change: (tx: DbLike, beo: BeoRow) => Promise<void>,
): Promise<BeoView> {
  if (!can(actor, "events.write")) throw forbidden();
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const beo = await findBeo(tx, eventId, true);
    if (!beo) throw notFound("Banquet event order");
    await change(tx, beo);
    await syncBeo(tx, actor, eventId);
  });
  return getBeo(db, actor, eventId);
}

// --- Run of show (FLOW-145) -----------------------------------------------------

export const saveRunOfShow = (db: Db, actor: Actor, eventId: string, input: RunOfShowInput) =>
  edit(db, actor, eventId, async (tx, beo) => {
    await tx
      .update(beos)
      .set({ runOfShowMode: input.mode, updatedBy: actor.userId })
      .where(eq(beos.id, beo.id));
    await tx.delete(beoRunOfShow).where(eq(beoRunOfShow.beoId, beo.id));
    if (input.rows.length)
      await tx.insert(beoRunOfShow).values(
        input.rows.map((row, index) => ({
          beoId: beo.id,
          eventId,
          time: row.time,
          cue: row.cue,
          owner: row.owner ?? "",
          notes: row.notes ?? "",
          sortOrder: index,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      );
  });

// --- Areas (FLOW-146, 147) ------------------------------------------------------

// The area a request names, on this event. 404 for one on another event.
async function findArea(tx: DbLike, eventId: string, areaId: string, lock = false) {
  const query = tx
    .select()
    .from(beoAreas)
    .where(and(eq(beoAreas.id, areaId), eq(beoAreas.eventId, eventId), isNull(beoAreas.archivedAt)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("Area");
  return row;
}

// For attachments: whoever can open the area's event can see its photos.
export async function findBeoArea(db: DbLike, actor: Actor, areaId: string) {
  const [row] = await db
    .select()
    .from(beoAreas)
    .where(and(eq(beoAreas.id, areaId), isNull(beoAreas.archivedAt)));
  if (!row) throw notFound("Area");
  await findVisibleEvent(db, actor, row.eventId);
  return row;
}

async function assertNameFree(tx: DbLike, beoId: string, kind: BeoAreaKind, name: string, exceptId?: string) {
  const rows = await tx
    .select({ id: beoAreas.id, name: beoAreas.name })
    .from(beoAreas)
    .where(and(eq(beoAreas.beoId, beoId), eq(beoAreas.kind, kind), isNull(beoAreas.archivedAt)));
  if (rows.some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase()))
    throw new ApiError(409, "DUPLICATE_AREA", `There is already an area named "${name}".`);
}

const nextOrder = async (tx: DbLike, beoId: string, kind: BeoAreaKind) => {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${beoAreas.sortOrder}), -1) + 1`.mapWith(Number) })
    .from(beoAreas)
    .where(and(eq(beoAreas.beoId, beoId), eq(beoAreas.kind, kind)));
  return row.next;
};

export const createArea = (db: Db, actor: Actor, eventId: string, input: BeoAreaInput) =>
  edit(db, actor, eventId, async (tx, beo) => {
    await assertNameFree(tx, beo.id, input.kind, input.name);
    await tx.insert(beoAreas).values({
      beoId: beo.id,
      eventId,
      kind: input.kind,
      name: input.name,
      notes: input.notes ?? "",
      sortOrder: await nextOrder(tx, beo.id, input.kind),
      createdBy: actor.userId,
      updatedBy: actor.userId,
    });
  });

export const updateArea = (db: Db, actor: Actor, eventId: string, areaId: string, input: BeoAreaUpdate) =>
  edit(db, actor, eventId, async (tx, beo) => {
    const area = await findArea(tx, eventId, areaId, true);
    if (input.name !== undefined) await assertNameFree(tx, beo.id, area.kind, input.name, area.id);
    await tx
      .update(beoAreas)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedBy: actor.userId,
      })
      .where(eq(beoAreas.id, area.id));
  });

export const archiveArea = (db: Db, actor: Actor, eventId: string, areaId: string) =>
  edit(db, actor, eventId, async (tx) => {
    const area = await findArea(tx, eventId, areaId, true);
    await tx
      .update(beoAreas)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(beoAreas.id, area.id));
  });

// The Excalidraw scene of an annotated layout image (FLOW-147).
export const saveAreaScene = (db: Db, actor: Actor, eventId: string, areaId: string, input: BeoSceneInput) =>
  edit(db, actor, eventId, async (tx) => {
    const area = await findArea(tx, eventId, areaId, true);
    if (area.kind !== "layout") throw new ApiError(400, "INVALID_REQUEST", "Only layout areas can be annotated.");
    await tx.update(beoAreas).set({ scene: input.scene, updatedBy: actor.userId }).where(eq(beoAreas.id, area.id));
  });

// The saved annotation of a layout image, for the editor to reopen (FLOW-147).
export async function getAreaScene(db: Db, actor: Actor, eventId: string, areaId: string) {
  await findVisibleEvent(db, actor, eventId);
  const area = await findArea(db, eventId, areaId);
  return { scene: area.scene };
}

// Adds the layout areas of the venue, or of a past event at the same venue, that
// this BEO doesn't have yet (FLOW-147). Names, notes and annotations come across;
// uploaded images stay with the area they were added to.
export const copyLayout = (db: Db, actor: Actor, eventId: string, input: LayoutCopyInput) =>
  edit(db, actor, eventId, async (tx, beo) => {
    const [event] = await tx.select({ venueId: events.venueId }).from(events).where(eq(events.id, eventId));
    if (!event?.venueId) throw new ApiError(400, "INVALID_REQUEST", "This event has no venue to copy from.");
    let source: { name: string; notes: string; scene: Record<string, unknown> | null }[];
    if (input.from === "venue") {
      const rows = await tx
        .select({ name: venueAreas.name })
        .from(venueAreas)
        .where(and(eq(venueAreas.venueId, event.venueId), isNull(venueAreas.archivedAt)))
        .orderBy(asc(venueAreas.sortOrder), asc(venueAreas.createdAt));
      source = rows.map((row) => ({ name: row.name, notes: "", scene: null }));
    } else {
      const otherId = input.eventId!;
      if (otherId === eventId) throw new ApiError(400, "INVALID_REQUEST", "Choose a different event to copy from.");
      await findVisibleEvent(tx, actor, otherId);
      const [other] = await tx.select({ venueId: events.venueId }).from(events).where(eq(events.id, otherId));
      if (other?.venueId !== event.venueId)
        throw new ApiError(400, "INVALID_REQUEST", "That event is at a different venue.");
      const otherBeo = await findBeo(tx, otherId);
      const layout = otherBeo
        ? await tx
            .select()
            .from(beoAreas)
            .where(and(eq(beoAreas.beoId, otherBeo.id), eq(beoAreas.kind, "layout"), isNull(beoAreas.archivedAt)))
            .orderBy(asc(beoAreas.sortOrder), asc(beoAreas.createdAt))
        : [];
      source = layout.length
        ? layout.map((row) => ({ name: row.name, notes: row.notes, scene: row.scene }))
        : (
            await tx
              .select({ name: eventAreas.name })
              .from(eventAreas)
              .where(and(eq(eventAreas.eventId, otherId), isNull(eventAreas.archivedAt)))
              .orderBy(asc(eventAreas.sortOrder))
          ).map((row) => ({ name: row.name, notes: "", scene: null }));
    }
    const have = new Set(
      (
        await tx
          .select({ name: beoAreas.name })
          .from(beoAreas)
          .where(and(eq(beoAreas.beoId, beo.id), eq(beoAreas.kind, "layout"), isNull(beoAreas.archivedAt)))
      ).map((row) => row.name.toLowerCase()),
    );
    const added = source.filter((row) => !have.has(row.name.toLowerCase()));
    const start = await nextOrder(tx, beo.id, "layout");
    if (added.length)
      await tx.insert(beoAreas).values(
        added.map((row, index) => ({
          beoId: beo.id,
          eventId,
          kind: "layout" as const,
          name: row.name,
          notes: row.notes,
          scene: row.scene,
          sortOrder: start + index,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      );
  });

// --- Cleanup checklist (FLOW-146) -----------------------------------------------

// Replaces the checklist. An item that keeps its section and label keeps its
// check-off, so editing the list during breakdown doesn't untick finished work.
export const saveCleanup = (db: Db, actor: Actor, eventId: string, input: CleanupInput) =>
  edit(db, actor, eventId, async (tx, beo) => {
    const existing = await tx
      .select()
      .from(beoChecklistItems)
      .where(and(eq(beoChecklistItems.beoId, beo.id), isNull(beoChecklistItems.archivedAt)));
    const key = (section: string, label: string) => `${section}\u0000${label}`;
    const checked = new Map(
      existing.filter((item) => item.checkedAt).map((item) => [key(item.section, item.label), item]),
    );
    await tx.delete(beoChecklistItems).where(eq(beoChecklistItems.beoId, beo.id));
    const rows = input.sections.flatMap((section) =>
      section.items.map((label) => ({ section: section.section, label })),
    );
    if (rows.length)
      await tx.insert(beoChecklistItems).values(
        rows.map((row, index) => {
          const done = checked.get(key(row.section, row.label));
          return {
            beoId: beo.id,
            eventId,
            ...row,
            sortOrder: index,
            checkedAt: done?.checkedAt ?? null,
            checkedBy: done?.checkedBy ?? null,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          };
        }),
      );
  });

// Checks one item off, or undoes it, recording who and when. Anyone who can open
// the event may, so the crew can do it on a phone during breakdown (AC2).
export async function checkCleanupItem(
  db: Db,
  actor: Actor,
  eventId: string,
  itemId: string,
  checked: boolean,
): Promise<BeoView> {
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: beoChecklistItems.id })
      .from(beoChecklistItems)
      .where(
        and(
          eq(beoChecklistItems.id, itemId),
          eq(beoChecklistItems.eventId, eventId),
          isNull(beoChecklistItems.archivedAt),
        ),
      )
      .for("update");
    if (!item) throw notFound("Checklist item");
    await tx
      .update(beoChecklistItems)
      .set({
        checkedAt: checked ? new Date() : null,
        checkedBy: checked ? actor.userId : null,
        updatedBy: actor.userId,
      })
      .where(eq(beoChecklistItems.id, itemId));
  });
  return getBeo(db, actor, eventId);
}
