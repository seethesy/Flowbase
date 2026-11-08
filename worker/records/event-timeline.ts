import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import {
  groupTimeline,
  parseTimelineLine,
  type EventTimeline,
  type TimelineEntry,
  type TimelineSuggestion,
  type TimelineWho,
  type TimelineWhoInput,
  type timelineEntryInputSchema,
} from "../../shared/event-timeline";
import type { ProposalMapping } from "../../shared/proposal-mapping";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  eventAreas,
  eventShifts,
  eventStaffSlots,
  eventTimelineEntries,
  events,
  proposalMappings,
  proposals,
  users,
  vendors,
} from "../db/schema";
import { ApiError, notFound } from "../hono";
import { can } from "../policy";
import { findVisibleEvent, instants } from "./events";
import { assertListLabels } from "./settings";

// The event timeline and production schedule (FLOW-126). Anyone who can open the
// event reads it; events.write adds, edits and removes entries. Every call answers
// with the whole timeline, days in date order with their entries in start order
// (AC1). Entries name who as a staff member, a role from the staff position list
// or an outside event partner from the vendor directory, who needs no Flowbase
// account (AC2).

type EntryRow = typeof eventTimelineEntries.$inferSelect;
type EntryInput = z.output<typeof timelineEntryInputSchema>;

const clean = (row: EntryRow) => !row.archivedAt;

// The lines of a mapped proposal's timeline (F-11-04), keyed so an entry added from
// one is remembered. The key is the source block's id, or the line's place when the
// mapping had no block for it.
export function timelineLines(mapping: ProposalMapping) {
  return mapping.timeline.map((line, index) => ({
    sourceKey: line.sourceBlockId ?? `line-${index}`,
    text: line.value.trim(),
  }));
}

async function proposalMappingsOf(db: DbLike, eventId: string) {
  const rows = await db
    .select({
      proposalId: proposals.id,
      title: proposals.title,
      data: proposalMappings.data,
    })
    .from(proposals)
    .innerJoin(
      proposalMappings,
      and(
        eq(proposalMappings.proposalId, proposals.id),
        eq(proposalMappings.versionId, proposals.currentVersionId),
        isNull(proposalMappings.archivedAt),
      ),
    )
    .where(
      and(
        eq(proposals.eventId, eventId),
        isNull(proposals.archivedAt),
        ne(proposals.stage, "lost"),
      ),
    )
    .orderBy(asc(proposals.createdAt));
  return rows;
}

async function timelineOf(
  db: DbLike,
  actor: Actor,
  eventId: string,
): Promise<EventTimeline> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const eventDate = utcToBusinessTime(event.startsAt).date;
  const rows = await db
    .select()
    .from(eventTimelineEntries)
    .where(
      and(
        eq(eventTimelineEntries.eventId, eventId),
        isNull(eventTimelineEntries.archivedAt),
      ),
    )
    .orderBy(asc(eventTimelineEntries.startsAt), asc(eventTimelineEntries.createdAt));

  const userIds = [...new Set(rows.flatMap((r) => (r.whoUserId ? [r.whoUserId] : [])))];
  const vendorIds = [
    ...new Set(rows.flatMap((r) => (r.whoVendorId ? [r.whoVendorId] : []))),
  ];
  const [people, partners, shifts, areas, mappings] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    vendorIds.length
      ? db
          .select({ id: vendors.id, name: vendors.name })
          .from(vendors)
          .where(inArray(vendors.id, vendorIds))
      : Promise.resolve([]),
    db
      .select({
        id: eventShifts.id,
        kind: eventShifts.kind,
        startsAt: eventShifts.startsAt,
        endsAt: eventShifts.endsAt,
        activities: eventShifts.activities,
        slots: sql<number>`count(${eventStaffSlots.id})::int`,
        filled: sql<number>`count(${eventStaffSlots.assigneeId})::int`,
      })
      .from(eventShifts)
      .leftJoin(
        eventStaffSlots,
        and(
          eq(eventStaffSlots.shiftId, eventShifts.id),
          isNull(eventStaffSlots.archivedAt),
        ),
      )
      .where(and(eq(eventShifts.eventId, eventId), isNull(eventShifts.archivedAt)))
      .groupBy(eventShifts.id),
    db
      .select({ name: eventAreas.name })
      .from(eventAreas)
      .where(and(eq(eventAreas.eventId, eventId), isNull(eventAreas.archivedAt)))
      .orderBy(asc(eventAreas.sortOrder)),
    // The mapped proposal's lines are proposal data: only those who read proposals.
    can(actor, "proposals.read") ? proposalMappingsOf(db, eventId) : Promise.resolve([]),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name || p.email]));
  const partnerNames = new Map(partners.map((p) => [p.id, p.name]));

  const who = (row: EntryRow): TimelineWho | null => {
    if (row.whoType === "staff" && row.whoUserId)
      return { type: "staff", id: row.whoUserId, name: names.get(row.whoUserId) ?? row.whoUserId };
    if (row.whoType === "role" && row.whoRole)
      return { type: "role", label: row.whoRole };
    if (row.whoType === "vendor" && row.whoVendorId)
      return {
        type: "vendor",
        id: row.whoVendorId,
        name: partnerNames.get(row.whoVendorId) ?? row.whoVendorId,
      };
    return null;
  };
  const entries: TimelineEntry[] = rows.filter(clean).map((row) => {
    const start = utcToBusinessTime(row.startsAt);
    return {
      id: row.id,
      kind: row.kind,
      date: start.date,
      startTime: start.time,
      endTime: utcToBusinessTime(row.endsAt).time,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      activity: row.activity,
      who: who(row),
      where: row.areaName,
      fromProposal: row.proposalId !== null,
    };
  });
  const shiftViews = shifts.map((shift) => {
    const start = utcToBusinessTime(shift.startsAt);
    return {
      id: shift.id,
      kind: shift.kind,
      date: start.date,
      startsAt: shift.startsAt.toISOString(),
      startTime: start.time,
      endTime: utcToBusinessTime(shift.endsAt).time,
      activities: shift.activities,
      slots: shift.slots,
      filled: shift.filled,
    };
  });

  const used = new Set(
    rows.filter((r) => r.proposalId && r.sourceKey).map((r) => `${r.proposalId}:${r.sourceKey}`),
  );
  const suggestions: TimelineSuggestion[] = mappings.flatMap((mapping) =>
    timelineLines(mapping.data)
      .filter((line) => line.text && !used.has(`${mapping.proposalId}:${line.sourceKey}`))
      .map((line) => ({
        proposalId: mapping.proposalId,
        proposalTitle: mapping.title,
        sourceKey: line.sourceKey,
        text: line.text,
        ...parseTimelineLine(line.text),
      })),
  );

  return {
    eventId,
    days: groupTimeline(entries, shiftViews, eventDate).map((day) => ({
      date: day.date,
      isEventDay: day.isEventDay,
      shifts: day.shifts.map(({ id, kind, startTime, endTime, activities, slots, filled }) => ({
        id, kind, startTime, endTime, activities, slots, filled,
      })),
      entries: day.entries,
    })),
    suggestions,
    areas: areas.map((area) => area.name),
    canEdit: can(actor, "events.write"),
  };
}

export async function getTimeline(db: Db, actor: Actor, eventId: string) {
  await findVisibleEvent(db, actor, eventId);
  return timelineOf(db, actor, eventId);
}

function timeValues(input: EntryInput) {
  if (input.endTime === input.startTime)
    throw new ApiError(400, "INVALID_REQUEST", "An entry must end after it starts.");
  const { startsAt, endsAt } = instants(input);
  return { startsAt, endsAt: endsAt! };
}

// Checks who the entry names and returns the columns that store it. A person,
// role or vendor the entry already names is kept even if it has since been
// deactivated or archived, so editing an old entry never drops it.
async function whoColumns(tx: DbLike, who: TimelineWhoInput | null, current?: EntryRow) {
  const none = { whoType: null, whoUserId: null, whoRole: null, whoVendorId: null };
  if (!who) return none;
  if (who.type === "staff") {
    if (!(current?.whoType === "staff" && current.whoUserId === who.userId)) {
      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, who.userId));
      if (user?.status !== "active")
        throw new ApiError(400, "INVALID_VALUE", "Choose an active staff member.");
    }
    return { ...none, whoType: "staff" as const, whoUserId: who.userId };
  }
  if (who.type === "role") {
    await assertListLabels(
      tx,
      "staff_position",
      [who.label],
      current?.whoType === "role" && current.whoRole ? [current.whoRole] : [],
    );
    return { ...none, whoType: "role" as const, whoRole: who.label };
  }
  if (!(current?.whoType === "vendor" && current.whoVendorId === who.vendorId)) {
    const [vendor] = await tx
      .select({ type: vendors.type, archivedAt: vendors.archivedAt })
      .from(vendors)
      .where(eq(vendors.id, who.vendorId));
    if (!vendor || vendor.archivedAt || vendor.type !== "event_partner")
      throw new ApiError(
        400,
        "INVALID_VALUE",
        "Choose an event partner from the vendor directory.",
      );
  }
  return { ...none, whoType: "vendor" as const, whoVendorId: who.vendorId };
}

// "Where" is one of the event's areas (or the value the entry already has).
async function checkArea(tx: DbLike, eventId: string, name: string, current?: EntryRow) {
  if (!name || name === current?.areaName) return;
  const [area] = await tx
    .select({ id: eventAreas.id })
    .from(eventAreas)
    .where(
      and(
        eq(eventAreas.eventId, eventId),
        eq(eventAreas.name, name),
        isNull(eventAreas.archivedAt),
      ),
    );
  if (!area)
    throw new ApiError(400, "INVALID_VALUE", `"${name}" isn't one of this event's areas.`);
}

// An entry added from a proposal line must name a line the proposal's current
// mapping has.
async function checkSource(tx: DbLike, eventId: string, source: EntryInput["source"]) {
  if (!source) return { proposalId: null, sourceKey: null };
  const mappings = await proposalMappingsOf(tx, eventId);
  const mapping = mappings.find((m) => m.proposalId === source.proposalId);
  if (!mapping || !timelineLines(mapping.data).some((l) => l.sourceKey === source.sourceKey))
    throw new ApiError(400, "INVALID_REQUEST", "That proposal line is no longer on the proposal.");
  return { proposalId: source.proposalId, sourceKey: source.sourceKey };
}

const snapshot = (row: EntryRow) => ({
  eventId: row.eventId,
  kind: row.kind,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  activity: row.activity,
  who: row.whoType,
  whoUserId: row.whoUserId,
  whoRole: row.whoRole,
  whoVendorId: row.whoVendorId,
  where: row.areaName,
  proposalId: row.proposalId,
  sourceKey: row.sourceKey,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

async function findEntry(tx: DbLike, eventId: string, entryId: string) {
  const [row] = await tx
    .select()
    .from(eventTimelineEntries)
    .where(
      and(
        eq(eventTimelineEntries.id, entryId),
        eq(eventTimelineEntries.eventId, eventId),
        isNull(eventTimelineEntries.archivedAt),
      ),
    )
    .for("update");
  if (!row) throw notFound("Timeline entry");
  return row;
}

export async function createTimelineEntry(
  db: Db,
  actor: Actor,
  eventId: string,
  input: EntryInput,
) {
  await findVisibleEvent(db, actor, eventId);
  const times = timeValues(input);
  await db.transaction(async (tx) => {
    await checkArea(tx, eventId, input.where);
    const who = await whoColumns(tx, input.who);
    const source = await checkSource(tx, eventId, input.source);
    const [row] = await tx
      .insert(eventTimelineEntries)
      .values({
        eventId,
        kind: input.kind,
        ...times,
        activity: input.activity,
        ...who,
        areaName: input.where,
        ...source,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_timeline_entry",
      entityId: row.id,
      action: "create",
      before: null,
      after: snapshot(row),
    });
  });
  return timelineOf(db, actor, eventId);
}

export async function updateTimelineEntry(
  db: Db,
  actor: Actor,
  eventId: string,
  entryId: string,
  input: EntryInput,
) {
  await findVisibleEvent(db, actor, eventId);
  const times = timeValues(input);
  await db.transaction(async (tx) => {
    const before = await findEntry(tx, eventId, entryId);
    await checkArea(tx, eventId, input.where, before);
    const who = await whoColumns(tx, input.who, before);
    const [after] = await tx
      .update(eventTimelineEntries)
      .set({
        kind: input.kind,
        ...times,
        activity: input.activity,
        ...who,
        areaName: input.where,
        updatedBy: actor.userId,
      })
      .where(eq(eventTimelineEntries.id, entryId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_timeline_entry",
      entityId: entryId,
      action: "update",
      before: snapshot(before),
      after: snapshot(after),
    });
  });
  return timelineOf(db, actor, eventId);
}

export async function archiveTimelineEntry(
  db: Db,
  actor: Actor,
  eventId: string,
  entryId: string,
) {
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const before = await findEntry(tx, eventId, entryId);
    const [after] = await tx
      .update(eventTimelineEntries)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(eventTimelineEntries.id, entryId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_timeline_entry",
      entityId: entryId,
      action: "archive",
      before: snapshot(before),
      after: snapshot(after),
    });
  });
  return timelineOf(db, actor, eventId);
}
