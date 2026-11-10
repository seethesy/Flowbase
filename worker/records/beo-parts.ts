import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { BeoArea, BeoContent } from "../../shared/beo";
import { businessDefaultsSchema, defaultBusinessDefaults } from "../../shared/settings";
import type { DbLike } from "../db/client";
import { beoAreas, beoChecklistItems, beoRunOfShow, settings, users } from "../db/schema";

// The pieces of a BEO that have rows of their own: the run of show (FLOW-145),
// setup and layout areas (FLOW-146, 147) and the cleanup checklist (FLOW-146).
// Reading only; the edits live in beo-edit.ts.

type AreaRow = typeof beoAreas.$inferSelect;

export async function businessDefaults(tx: DbLike) {
  const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : defaultBusinessDefaults;
}

export async function loadParts(tx: DbLike, beoId: string | null) {
  if (!beoId) return { run: [], areas: [] as AreaRow[], items: [], names: new Map<string, string>() };
  const [run, areas, items] = await Promise.all([
    tx
      .select()
      .from(beoRunOfShow)
      .where(and(eq(beoRunOfShow.beoId, beoId), isNull(beoRunOfShow.archivedAt)))
      .orderBy(asc(beoRunOfShow.sortOrder), asc(beoRunOfShow.createdAt)),
    tx
      .select()
      .from(beoAreas)
      .where(and(eq(beoAreas.beoId, beoId), isNull(beoAreas.archivedAt)))
      .orderBy(asc(beoAreas.sortOrder), asc(beoAreas.createdAt)),
    tx
      .select()
      .from(beoChecklistItems)
      .where(and(eq(beoChecklistItems.beoId, beoId), isNull(beoChecklistItems.archivedAt)))
      .orderBy(asc(beoChecklistItems.sortOrder), asc(beoChecklistItems.createdAt)),
  ]);
  const wanted = [...new Set(items.flatMap((item) => (item.checkedBy ? [item.checkedBy] : [])))];
  const people = wanted.length
    ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, wanted))
    : [];
  return { run, areas, items, names: new Map(people.map((p) => [p.id, p.name || p.email])) };
}
export type BeoParts = Awaited<ReturnType<typeof loadParts>>;

const toArea = (row: AreaRow): BeoArea => ({
  id: row.id,
  name: row.name,
  notes: row.notes,
  hasScene: row.scene !== null,
});

// The content sections these rows fill in.
export function partsContent(parts: BeoParts, mode: BeoContent["runOfShow"]["mode"], guestCount: number | null, threshold: number) {
  const sections: BeoContent["setupCleanup"]["cleanup"] = [];
  for (const item of parts.items) {
    let section = sections.find((s) => s.section === item.section);
    if (!section) sections.push((section = { section: item.section, items: [] }));
    section.items.push({
      id: item.id,
      label: item.label,
      checkedAt: item.checkedAt?.toISOString() ?? null,
      checkedBy: item.checkedBy ? (parts.names.get(item.checkedBy) ?? "") : null,
    });
  }
  return {
    runOfShow: {
      mode,
      enabled: mode === "on" || (mode === "auto" && guestCount !== null && guestCount >= threshold),
      threshold,
      rows: parts.run.map((row) => ({ time: row.time, cue: row.cue, owner: row.owner, notes: row.notes })),
    },
    layoutAreas: parts.areas.filter((a) => a.kind === "layout").map(toArea),
    setupAreas: parts.areas.filter((a) => a.kind === "setup").map(toArea),
    cleanup: sections,
  };
}

// A new BEO starts with the event's areas as setup and layout areas, and the
// settings' cleanup template as its checklist (FLOW-146 AC1, FLOW-147).
export async function seedParts(
  tx: DbLike,
  actor: { userId: string },
  beo: { id: string; eventId: string },
  areaNames: string[],
) {
  const by = { createdBy: actor.userId, updatedBy: actor.userId };
  const defaults = await businessDefaults(tx);
  if (areaNames.length)
    await tx.insert(beoAreas).values(
      (["setup", "layout"] as const).flatMap((kind) =>
        areaNames.map((name, index) => ({
          beoId: beo.id,
          eventId: beo.eventId,
          kind,
          name,
          sortOrder: index,
          ...by,
        })),
      ),
    );
  const items = defaults.cleanupTemplate.flatMap((section) =>
    section.items.map((label) => ({ section: section.section, label })),
  );
  if (items.length)
    await tx.insert(beoChecklistItems).values(
      items.map((item, index) => ({
        beoId: beo.id,
        eventId: beo.eventId,
        ...item,
        sortOrder: index,
        ...by,
      })),
    );
}
