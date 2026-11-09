import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { itemRequirements, type RequirementItem } from "../../shared/inventory-requirements";
import { can } from "../../shared/policy";
import {
  describeRegeneration,
  planRegeneration,
  type RegenRow,
  type RegeneratePreview,
} from "../../shared/planning";
import {
  pullGroupLabels,
  pullGroupOf,
  pullGroups,
  pullSuggestions,
  samePullValue,
  pullValueLabel,
  pullValueSummary,
  type PullGroup,
  type PullLine,
  type PullLineInput,
  type PullLineUpdate,
  type PullLineValue,
  type PullList,
  type PullScheduleInput,
  type PullStatus,
} from "../../shared/pull-list";
import type { ProposalLine } from "../../shared/proposal-mapping";
import { businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import { writeAudit, writeAuditMany } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  events,
  inventoryItems,
  inventoryRentalDetails,
  inventorySections,
  inventoryServiceDetails,
  proposalMappings,
  proposals,
  pullListLines,
  pullLists,
  reservationConflicts,
  users,
} from "../db/schema";
import { ApiError, notFound } from "../hono";
import { findVisibleEvent } from "./events";
import { replaceRequirements, requestEventRecompute } from "./allocations";

// The inventory pull list (FLOW-134). Generated from the event's mapped proposal
// when planning starts, editable by hand, and rebuilt on request with a preview of
// what would change (shared/planning.ts planRegeneration).

type LineRow = typeof pullListLines.$inferSelect;

async function syncSupplyRequirements(tx: DbLike, actor: Actor | null, eventId: string) {
  const rows = await tx.select({ itemId: pullListLines.itemId, quantity: pullListLines.quantity })
    .from(pullListLines)
    .innerJoin(pullLists, eq(pullLists.id, pullListLines.pullListId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, pullListLines.itemId))
    .where(and(eq(pullLists.eventId, eventId), eq(pullListLines.group, "supplies"),
      eq(inventoryItems.subtype, "supply"), isNull(pullListLines.archivedAt)));
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.itemId === null || row.quantity === null) continue;
    totals.set(row.itemId, Math.round(((totals.get(row.itemId) ?? 0) + row.quantity) * 10_000) / 10_000);
  }
  await replaceRequirements(tx, actor, eventId, "supply", [...totals].map(([itemId, quantity]) => ({ itemId, quantity, basis: "fixed" })));
  await requestEventRecompute(tx, eventId);
}

// The proposal whose mapping feeds the event: the newest one that isn't lost and
// whose mapping matches its current version. null when the event has none.
export async function eventProposalLines(
  db: DbLike,
  eventId: string,
): Promise<ProposalLine[] | null> {
  const rows = await db
    .select({
      data: proposalMappings.data,
      mappedVersionId: proposalMappings.versionId,
      currentVersionId: proposals.currentVersionId,
    })
    .from(proposals)
    .innerJoin(proposalMappings, eq(proposalMappings.proposalId, proposals.id))
    .where(
      and(
        eq(proposals.eventId, eventId),
        isNull(proposals.archivedAt),
        ne(proposals.stage, "lost"),
      ),
    )
    .orderBy(sql`${proposals.createdAt} desc`);
  const match = rows.find((row) => row.mappedVersionId === row.currentVersionId);
  return match ? match.data.lines : null;
}

type CatalogItem = RequirementItem & { kind: string; subtype: string | null;
  ratioQuantity: number | null; ratioBasis: string | null };

// Loads the items a set of ids needs, following kit components and service
// inclusions until nothing new turns up.
async function loadCatalog(db: DbLike, ids: string[]) {
  const catalog = new Map<string, CatalogItem>();
  let pending = [...new Set(ids)];
  while (pending.length) {
    const rows = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        kind: inventoryItems.kind,
        subtype: inventoryItems.subtype,
        ratioQuantity: inventoryItems.ratioQuantity,
        ratioBasis: inventoryItems.ratioBasis,
        active: inventoryItems.active,
        archivedAt: inventoryItems.archivedAt,
        includes: inventoryServiceDetails.includes,
        components: inventoryRentalDetails.components,
      })
      .from(inventoryItems)
      .leftJoin(inventoryServiceDetails, eq(inventoryServiceDetails.itemId, inventoryItems.id))
      .leftJoin(inventoryRentalDetails, eq(inventoryRentalDetails.itemId, inventoryItems.id))
      .where(inArray(inventoryItems.id, pending));
    const next = new Set<string>();
    for (const row of rows) {
      catalog.set(row.id, {
        id: row.id,
        name: row.name,
        kind: row.kind,
        subtype: row.subtype,
        ratioQuantity: row.ratioQuantity,
        ratioBasis: row.ratioBasis,
        active: row.active,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        service: row.kind === "service" ? { includes: row.includes ?? [] } : null,
        rental: row.kind === "rental" ? { components: row.components ?? [] } : null,
      });
      for (const line of row.includes ?? []) next.add(line.itemId);
      for (const line of row.components ?? []) next.add(line.itemId);
    }
    pending = [...next].filter((id) => !catalog.has(id));
  }
  return catalog;
}

const untrackedGroup = (kind: ProposalLine["kind"]): PullGroup =>
  kind === "decor" ? "decor" : kind === "supply" ? "supplies" : "kitchen_equipment";

// What the proposal says to pull, one entry per proposal line (or per item a kit or
// service expands to). A line with no quantity is TBD, and its items are listed
// once with no count so someone fills it in.
export async function generatedPullLines(
  db: DbLike,
  eventId: string,
  guests: number,
): Promise<{ sourceKey: string; value: PullLineValue }[]> {
  const lines = (await eventProposalLines(db, eventId)) ?? [];
  const pulled = lines.filter((line) => line.kind !== "menu");
  const tracked = pulled.filter((line) => line.catalogId && !line.notTracked);
  const catalog = await loadCatalog(
    db,
    tracked.map((line) => line.catalogId!),
  );
  const items = [...catalog.values()];
  const out: { sourceKey: string; value: PullLineValue }[] = [];
  const base = (line: ProposalLine) => ({
    sectionId: null,
    notes: line.notes,
    setupDay: false,
  });
  for (const line of pulled) {
    const key = `line:${line.id}`;
    if (!line.catalogId || line.notTracked) {
      // Services without a catalog match have nothing to pull.
      if (line.kind === "service") continue;
      out.push({
        sourceKey: key,
        value: {
          group: untrackedGroup(line.kind),
          itemId: null,
          name: line.name,
          quantity: line.quantity,
          ...base(line),
        },
      });
      continue;
    }
    const item = catalog.get(line.catalogId);
    if (!item) continue;
    const plannedQuantity = item.subtype === "supply" && item.ratioBasis === "per_guest" &&
      item.ratioQuantity !== null
      ? Math.round((line.quantity ?? 1) * item.ratioQuantity * guests * 10_000) / 10_000
      : line.quantity;
    if (plannedQuantity === null) {
      out.push({
        sourceKey: key,
        value: {
          group: pullGroupOf(item),
          itemId: item.id,
          name: item.name,
          quantity: null,
          ...base(line),
        },
      });
      continue;
    }
    let needs: { itemId: string; quantity: number }[];
    try {
      needs = itemRequirements(item.id, plannedQuantity, items, guests);
    } catch {
      // A retired item or a kit loop: keep the line as the proposal wrote it so
      // someone sorts it out by hand.
      out.push({
        sourceKey: key,
        value: {
          group: pullGroupOf(item),
          itemId: item.id,
          name: item.name,
          quantity: plannedQuantity,
          ...base(line),
        },
      });
      continue;
    }
    for (const need of needs) {
      const needed = catalog.get(need.itemId);
      if (!needed) continue;
      const direct = need.itemId === item.id;
      out.push({
        sourceKey: direct ? key : `${key}:${need.itemId}`,
        value: {
          group: pullGroupOf(needed),
          itemId: needed.id,
          name: needed.name,
          quantity: need.quantity,
          ...base(line),
        },
      });
    }
  }
  return out;
}

const toValue = (row: LineRow): PullLineValue => ({
  group: row.group,
  itemId: row.itemId,
  name: row.name,
  sectionId: row.sectionId,
  quantity: row.quantity,
  notes: row.notes,
  setupDay: row.setupDay,
});

async function eventGuests(db: DbLike, eventId: string) {
  const [event] = await db
    .select({ guests: events.guestCount, servings: events.servingsCount })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) throw notFound("Event");
  return event.servings ?? event.guests ?? 0;
}

// Generated lines (they have a source key) with their state, for the planner.
async function generatedRows(db: DbLike, listId: string) {
  const rows = await db
    .select()
    .from(pullListLines)
    .where(and(eq(pullListLines.pullListId, listId), isNotNull(pullListLines.sourceKey)));
  return rows.map(
    (row): RegenRow<PullLineValue> => ({
      id: row.id,
      sourceKey: row.sourceKey!,
      edited: row.edited,
      removed: row.archivedAt !== null,
      value: toValue(row),
    }),
  );
}

async function planFor(db: DbLike, eventId: string, discardEdits: boolean) {
  const guests = await eventGuests(db, eventId);
  const generated = await generatedPullLines(db, eventId, guests);
  const [list] = await db.select().from(pullLists).where(eq(pullLists.eventId, eventId));
  const existing = list ? await generatedRows(db, list.id) : [];
  return planRegeneration(existing, generated, samePullValue, discardEdits);
}

// What regenerating would do, in words (FLOW-133 AC3).
export async function previewPullRegeneration(
  db: Db,
  actor: Actor,
  eventId: string,
  discardEdits: boolean,
): Promise<RegeneratePreview> {
  await findVisibleEvent(db, actor, eventId);
  return describeRegeneration(
    await planFor(db, eventId, discardEdits),
    pullValueLabel,
    pullValueSummary,
  );
}

async function ensureList(tx: DbLike, actor: Actor | null, eventId: string) {
  const by = actor?.userId ?? null;
  await tx
    .insert(pullLists)
    .values({ eventId, createdBy: by, updatedBy: by })
    .onConflictDoNothing({ target: pullLists.eventId });
  const [list] = await tx.select().from(pullLists).where(eq(pullLists.eventId, eventId));
  return list;
}

const snapshot = (row: LineRow) => ({
  name: row.name,
  group: row.group,
  itemId: row.itemId,
  quantity: row.quantity,
  notes: row.notes,
  setupDay: row.setupDay,
  status: row.status,
  removed: row.archivedAt !== null,
});

export type GenerationSummary = { added: number; changed: number; removed: number; kept: number };

// Builds or rebuilds the list from the proposal inside the caller's transaction.
// Safe to repeat: lines match on their source key, so a second run changes nothing.
// Edited or removed lines stay as they are unless discardEdits is set.
export async function generatePullList(
  tx: DbLike,
  actor: Actor | null,
  eventId: string,
  discardEdits = false,
): Promise<GenerationSummary> {
  const list = await ensureList(tx, actor, eventId);
  const guests = await eventGuests(tx, eventId);
  const generated = await generatedPullLines(tx, eventId, guests);
  const plan = planRegeneration(
    await generatedRows(tx, list.id),
    generated,
    samePullValue,
    discardEdits,
  );
  const by = actor?.userId ?? null;
  const now = new Date();
  const audits: Parameters<typeof writeAuditMany>[2] = [];

  for (const line of plan.add) {
    const [row] = await tx
      .insert(pullListLines)
      .values({
        pullListId: list.id,
        ...line.value,
        sourceKey: line.sourceKey,
        createdBy: by,
        updatedBy: by,
      })
      .returning();
    audits.push({
      entityType: "pull_list_line",
      entityId: row.id,
      action: "create",
      before: null,
      after: snapshot(row),
    });
  }
  for (const line of plan.update) {
    const [before] = await tx.select().from(pullListLines).where(eq(pullListLines.id, line.id));
    const [row] = await tx
      .update(pullListLines)
      .set({ ...line.value, archivedAt: null, edited: false, updatedBy: by })
      .where(eq(pullListLines.id, line.id))
      .returning();
    audits.push({
      entityType: "pull_list_line",
      entityId: row.id,
      action: "update",
      before: snapshot(before),
      after: snapshot(row),
    });
  }
  for (const line of plan.remove) {
    const [before] = await tx.select().from(pullListLines).where(eq(pullListLines.id, line.id));
    // The key is freed so a later regeneration can add the line again.
    const [row] = await tx
      .update(pullListLines)
      .set({ archivedAt: now, sourceKey: null, updatedBy: by })
      .where(eq(pullListLines.id, line.id))
      .returning();
    audits.push({
      entityType: "pull_list_line",
      entityId: row.id,
      action: "archive",
      before: snapshot(before),
      after: snapshot(row),
    });
  }
  await writeAuditMany(tx, actor, audits);
  await tx.update(pullLists).set({ generatedAt: now, updatedBy: by }).where(eq(pullLists.id, list.id));
  await syncSupplyRequirements(tx, actor, eventId);
  return {
    added: plan.add.length,
    changed: plan.update.length,
    removed: plan.remove.length,
    kept: plan.kept.length,
  };
}

export async function regeneratePullList(
  db: Db,
  actor: Actor,
  eventId: string,
  discardEdits: boolean,
) {
  if (!can(actor, "events.write")) throw new ApiError(403, "FORBIDDEN", "You don't have access to this.");
  await findVisibleEvent(db, actor, eventId);
  await db.transaction((tx) => generatePullList(tx, actor, eventId, discardEdits));
  return getPullList(db, actor, eventId);
}

// --- Reading --------------------------------------------------------------------

export async function getPullList(db: Db, actor: Actor, eventId: string): Promise<PullList> {
  await findVisibleEvent(db, actor, eventId);
  const canEdit = can(actor, "events.write");
  const [list] = await db.select().from(pullLists).where(eq(pullLists.eventId, eventId));
  const empty: PullList = {
    eventId,
    exists: false,
    scheduledAt: null,
    scheduledDate: null,
    scheduledTime: null,
    pullerId: null,
    pullerName: null,
    missingSchedule: true,
    tbdCount: 0,
    generatedAt: null,
    groups: pullGroups.map((group) => ({ group, label: pullGroupLabels[group], lines: [] })),
    canEdit,
  };
  if (!list) return empty;

  const rows = await db
    .select({ line: pullListLines, section: inventorySections.name, by: users.name })
    .from(pullListLines)
    .leftJoin(inventorySections, eq(inventorySections.id, pullListLines.sectionId))
    .leftJoin(users, eq(users.id, pullListLines.statusBy))
    .where(and(eq(pullListLines.pullListId, list.id), isNull(pullListLines.archivedAt)))
    .orderBy(asc(pullListLines.name), asc(pullListLines.createdAt));
  const itemIds = rows.flatMap(({ line }) => (line.itemId ? [line.itemId] : []));
  const short = new Map<string, number>();
  if (itemIds.length) {
    const conflicts = await db
      .select({ itemId: reservationConflicts.itemId, shortfall: reservationConflicts.shortfall })
      .from(reservationConflicts)
      .where(
        and(
          eq(reservationConflicts.eventId, eventId),
          inArray(reservationConflicts.itemId, itemIds),
          ne(reservationConflicts.state, "resolved"),
          isNull(reservationConflicts.archivedAt),
        ),
      );
    for (const row of conflicts)
      short.set(row.itemId, (short.get(row.itemId) ?? 0) + row.shortfall);
  }
  const lines = rows.map(({ line, section, by }): PullLine => {
    const shortfall = line.itemId ? (short.get(line.itemId) ?? 0) : 0;
    return {
      id: line.id,
      group: line.group,
      itemId: line.itemId,
      name: line.name,
      sectionId: line.sectionId,
      sectionName: section,
      quantity: line.quantity,
      tbd: line.quantity === null,
      notes: line.notes,
      status: line.status,
      setupDay: line.setupDay,
      generated: line.sourceKey !== null,
      edited: line.edited,
      statusBy: by,
      statusAt: line.statusAt?.toISOString() ?? null,
      shortfall: shortfall > 0 ? shortfall : null,
      suggestions: shortfall > 0 ? [...pullSuggestions] : [],
    };
  });
  let pullerName: string | null = null;
  if (list.pullerId) {
    const [puller] = await db.select({ name: users.name }).from(users).where(eq(users.id, list.pullerId));
    pullerName = puller?.name ?? null;
  }
  const scheduled = list.scheduledAt ? utcToBusinessTime(list.scheduledAt) : null;
  return {
    eventId,
    exists: true,
    scheduledAt: list.scheduledAt?.toISOString() ?? null,
    scheduledDate: scheduled?.date ?? null,
    scheduledTime: scheduled?.time ?? null,
    pullerId: list.pullerId,
    pullerName,
    missingSchedule: list.scheduledAt === null || list.pullerId === null,
    tbdCount: lines.filter((line) => line.tbd).length,
    generatedAt: list.generatedAt?.toISOString() ?? null,
    groups: pullGroups.map((group) => ({
      group,
      label: pullGroupLabels[group],
      lines: lines.filter((line) => line.group === group),
    })),
    canEdit,
  };
}

// --- Editing --------------------------------------------------------------------

function requireEdit(actor: Actor) {
  if (!can(actor, "events.write")) throw new ApiError(403, "FORBIDDEN", "You don't have access to this.");
}

async function findLine(tx: DbLike, eventId: string, lineId: string) {
  const [row] = await tx
    .select({ line: pullListLines })
    .from(pullListLines)
    .innerJoin(pullLists, eq(pullLists.id, pullListLines.pullListId))
    .where(
      and(
        eq(pullListLines.id, lineId),
        eq(pullLists.eventId, eventId),
        isNull(pullListLines.archivedAt),
      ),
    )
    .for("update", { of: pullListLines });
  if (!row) throw notFound("Pull list line");
  return row.line;
}

async function assertSection(tx: DbLike, sectionId: string | null) {
  if (!sectionId) return;
  const [row] = await tx
    .select({ id: inventorySections.id })
    .from(inventorySections)
    .where(and(eq(inventorySections.id, sectionId), isNull(inventorySections.archivedAt)));
  if (!row) throw new ApiError(400, "INVALID_REQUEST", "Choose a section that exists.");
}

export async function addPullLine(
  db: Db,
  actor: Actor,
  eventId: string,
  input: PullLineInput & { group: PullGroup },
) {
  requireEdit(actor);
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    let name = (input.name ?? "").trim();
    if (input.itemId) {
      const [item] = await tx
        .select({ name: inventoryItems.name })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.id, input.itemId), isNull(inventoryItems.archivedAt)));
      if (!item) throw new ApiError(400, "INVALID_REQUEST", "Choose an item that exists.");
      name = item.name;
    }
    await assertSection(tx, input.sectionId ?? null);
    const list = await ensureList(tx, actor, eventId);
    const [row] = await tx
      .insert(pullListLines)
      .values({
        pullListId: list.id,
        group: input.group,
        itemId: input.itemId ?? null,
        name,
        sectionId: input.sectionId ?? null,
        quantity: input.quantity ?? null,
        notes: input.notes ?? "",
        setupDay: input.setupDay ?? false,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "pull_list_line",
      entityId: row.id,
      action: "create",
      before: null,
      after: snapshot(row),
    });
    await syncSupplyRequirements(tx, actor, eventId);
  });
  return getPullList(db, actor, eventId);
}

export async function updatePullLine(
  db: Db,
  actor: Actor,
  eventId: string,
  lineId: string,
  input: PullLineUpdate,
) {
  requireEdit(actor);
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const before = await findLine(tx, eventId, lineId);
    if (input.sectionId !== undefined) await assertSection(tx, input.sectionId);
    const [row] = await tx
      .update(pullListLines)
      .set({ ...input, edited: before.sourceKey !== null ? true : before.edited, updatedBy: actor.userId })
      .where(eq(pullListLines.id, lineId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "pull_list_line",
      entityId: lineId,
      action: "update",
      before: snapshot(before),
      after: snapshot(row),
    });
    await syncSupplyRequirements(tx, actor, eventId);
  });
  return getPullList(db, actor, eventId);
}

// Removing keeps the row (archived) so regenerating doesn't bring a generated line
// back; the audit log records who removed it.
export async function removePullLine(db: Db, actor: Actor, eventId: string, lineId: string) {
  requireEdit(actor);
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const before = await findLine(tx, eventId, lineId);
    const [row] = await tx
      .update(pullListLines)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(pullListLines.id, lineId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "pull_list_line",
      entityId: lineId,
      action: "archive",
      before: snapshot(before),
      after: snapshot(row),
    });
    await syncSupplyRequirements(tx, actor, eventId);
  });
  return getPullList(db, actor, eventId);
}

// Anyone on the event moves a line along (FLOW-134 AC2); it records who and when.
export async function setPullLineStatus(
  db: Db,
  actor: Actor,
  eventId: string,
  lineId: string,
  status: PullStatus,
) {
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const before = await findLine(tx, eventId, lineId);
    if (before.status === status) return;
    const [row] = await tx
      .update(pullListLines)
      .set({ status, statusBy: actor.userId, statusAt: new Date(), updatedBy: actor.userId })
      .where(eq(pullListLines.id, lineId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "pull_list_line",
      entityId: lineId,
      action: "update",
      before: snapshot(before),
      after: snapshot(row),
    });
  });
  return getPullList(db, actor, eventId);
}

// The date and time pulling starts (New York time) and who pulls (AC3). Clearing
// either one leaves the list flagged until it is set again.
export async function setPullSchedule(
  db: Db,
  actor: Actor,
  eventId: string,
  input: PullScheduleInput,
) {
  requireEdit(actor);
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    if (input.pullerId) {
      const [puller] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.pullerId), eq(users.status, "active"), isNull(users.archivedAt)));
      if (!puller) throw new ApiError(400, "INVALID_REQUEST", "Choose an active team member.");
    }
    let scheduledAt: Date | null = null;
    if (input.date !== null && input.time !== null) {
      try {
        scheduledAt = businessTimeToUtc(input.date, input.time);
      } catch {
        throw new ApiError(400, "INVALID_REQUEST", "That time doesn't exist on that date.");
      }
    }
    const list = await ensureList(tx, actor, eventId);
    const [row] = await tx
      .update(pullLists)
      .set({ scheduledAt, pullerId: input.pullerId, updatedBy: actor.userId })
      .where(eq(pullLists.id, list.id))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "pull_list",
      entityId: list.id,
      action: "update",
      before: { scheduledAt: list.scheduledAt?.toISOString() ?? null, pullerId: list.pullerId },
      after: { scheduledAt: row.scheduledAt?.toISOString() ?? null, pullerId: row.pullerId },
    });
  });
  return getPullList(db, actor, eventId);
}
