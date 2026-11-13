import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  beoFields,
  beoSectionSchema,
  diffBeoFields,
  snapshotOfFields,
  touchesKeyField,
  type BeoChange,
  type BeoContact,
  type BeoContent,
  type BeoNotesInput,
  type BeoView,
  type OfflineBeos,
  OFFLINE_BEO_DAYS,
} from "../../shared/beo";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import { shiftKindLabels, slotLabel } from "../../shared/event-staff";
import { timelineWhoLabel } from "../../shared/event-timeline";
import { pullGroupLabels } from "../../shared/pull-list";
import type { Db, DbLike } from "../db/client";
import {
  beoChanges,
  beos,
  clientContacts,
  eventShifts,
  events,
  eventStaffSlots,
  users,
  venueContacts,
  venues,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can, projectBeo } from "../policy";
import { decideApproval, registerApprovalSubject, requestApproval } from "./approvals";
import { businessDefaults, loadParts, partsContent, seedParts } from "./beo-parts";
import { getRoster } from "./event-staff";
import { getTimeline } from "./event-timeline";
import { findVisibleEvent, getEvent, lockVisibleEvent } from "./events";
import { getKitchenMenu } from "./kitchen-menu";
import { getPullList } from "./pull-list";

// The banquet event order (FLOW-143, 144, 148). The content is assembled live from
// the event's records; the beos row keeps the approval state and a snapshot of the
// field values, and syncBeo compares the two to log changes made after approval.

type BeoRow = typeof beos.$inferSelect;

// Assembly reads everything, whoever asks; what a reader sees is decided once, by
// projectBeo in the policy module.
const reader = (actor: Actor): Actor => ({ ...actor, role: "admin", employmentType: "full_time" });
const asDb = (tx: DbLike) => tx as unknown as Db;
const roleLabel = (role: string) => role.replaceAll("_", " ");

const toContact = (row: { name: string; role: string; email: string; phone: string }): BeoContact => ({
  name: row.name,
  role: roleLabel(row.role),
  phone: row.phone,
  email: row.email,
});

export async function findBeo(tx: DbLike, eventId: string, lock = false) {
  const query = tx
    .select()
    .from(beos)
    .where(and(eq(beos.eventId, eventId), isNull(beos.archivedAt)));
  const [row] = lock ? await query.for("update") : await query;
  return row as BeoRow | undefined;
}

// The ten sections with every contact filled in (FLOW-143 AC1). Never read this
// to a person: pass it through projectBeo first.
export async function assembleBeo(
  tx: DbLike,
  actor: Actor,
  eventId: string,
  stored?: Pick<BeoRow, "id" | "setupDetails" | "additionalNotes" | "runOfShowMode"> | null,
): Promise<BeoContent> {
  const all = reader(actor);
  const db = asDb(tx);
  const event = await getEvent(db, all, eventId);
  const [roster, timeline, menu, pull] = await Promise.all([
    getRoster(db, all, eventId),
    getTimeline(db, all, eventId),
    getKitchenMenu(db, all, eventId),
    getPullList(db, all, eventId),
  ]);
  const [clientRows, venueRows, venue, salesperson] = await Promise.all([
    tx
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, event.client.id), isNull(clientContacts.archivedAt)))
      .orderBy(asc(clientContacts.sortOrder), asc(clientContacts.createdAt)),
    event.venue
      ? tx
          .select()
          .from(venueContacts)
          .where(and(eq(venueContacts.venueId, event.venue.id), isNull(venueContacts.archivedAt)))
          .orderBy(asc(venueContacts.sortOrder), asc(venueContacts.createdAt))
      : Promise.resolve([]),
    event.venue
      ? tx.select().from(venues).where(eq(venues.id, event.venue.id)).then((rows) => rows[0])
      : Promise.resolve(undefined),
    event.assignedSalespersonId
      ? tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, event.assignedSalespersonId))
          .then((rows) => rows[0]?.name ?? null)
      : Promise.resolve(null),
  ]);
  const found = stored === undefined ? await findBeo(tx, eventId) : stored;
  const [parts, defaults] = await Promise.all([loadParts(tx, found?.id ?? null), businessDefaults(tx)]);
  const extra = partsContent(
    parts,
    found?.runOfShowMode ?? "auto",
    event.guestCount,
    defaults.runOfShowGuestThreshold,
  );
  const poc = clientRows.find((row) => row.id === event.pocContactId);
  const lines = menu.courses.flatMap((course) => course.lines);
  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const equipmentGroups = pull.groups
    .filter((group) => group.group !== "supplies")
    .map((group) => ({
      label: pullGroupLabels[group.group],
      lines: group.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        tbd: line.quantity === null,
        notes: line.notes,
      })),
    }))
    .filter((group) => group.lines.length > 0);
  return {
    header: { title: "Banquet event order", eventId, eventDate: event.date },
    event: {
      title: event.title,
      client: event.client.name,
      pointOfContact: poc ? toContact(poc) : null,
      venue: event.venue?.name ?? "",
      address: event.address,
      venueContacts: venueRows.map(toContact),
      clientContacts: clientRows.map(toContact),
      contactHidden: false,
    },
    summary: {
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      arrivalTime: event.arrivalTime,
      eventType: event.eventType,
      serviceType: event.serviceType,
      foodServiceStyle: event.foodServiceStyle,
      guestCount: event.guestCount,
      servings: event.servingsCount,
      dressCode: event.dressCode,
      salesperson,
    },
    foodSetup: {
      leavesKitchenTime: menu.leavesKitchenTime,
      courses: menu.courses.map((course) => ({
        course: course.course,
        lines: course.lines.map((line) => ({
          name: line.name,
          quantity: line.plannedQuantity,
          tbd: line.plannedQuantity === null,
          allergens: line.allergens,
          dietaryTags: line.dietaryTags,
          notes: line.notes,
        })),
      })),
      allergens: unique(lines.flatMap((line) => line.allergens)),
      dietaryTags: unique(lines.flatMap((line) => line.dietaryTags)),
      tbdCount: lines.filter((line) => line.plannedQuantity === null).length,
    },
    staff: {
      productionLead: roster.productionLead?.name ?? null,
      assistantLeads: roster.assistantLeads.map((person) => person.name),
      shifts: roster.shifts.map((shift) => ({
        kind: shift.kind,
        kindLabel: shiftKindLabels[shift.kind],
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        activities: shift.activities,
        slots: shift.slots.map((slot) => ({
          label: slotLabel(slot),
          department: slot.department,
          assignee: slot.assignee?.name ?? null,
          open: slot.assignee === null,
        })),
      })),
      openSlots: roster.openSlots,
    },
    timeline: timeline.days.map((day) => ({
      date: day.date,
      isEventDay: day.isEventDay,
      // The day-before setup block: team, working hours and activities (FLOW-145).
      shifts: roster.shifts
        .filter((shift) => shift.date === day.date && shift.kind !== "event_day")
        .map((shift) => ({
          kindLabel: shiftKindLabels[shift.kind],
          startTime: shift.startTime,
          endTime: shift.endTime,
          activities: shift.activities,
          team: shift.slots.map((slot) => slot.assignee?.name ?? `${slotLabel(slot)} (open)`),
        })),
      entries: day.entries.map((entry) => ({
        startTime: entry.startTime,
        endTime: entry.endTime,
        activity: entry.activity,
        who: timelineWhoLabel(entry.who),
        where: entry.where,
      })),
    })),
    runOfShow: extra.runOfShow,
    equipment: {
      groups: equipmentGroups,
      tbdCount: equipmentGroups.flatMap((group) => group.lines).filter((line) => line.tbd).length,
    },
    layout: {
      areas: extra.layoutAreas,
      loadInNotes: venue?.loadInNotes ?? "",
      parkingNotes: venue?.parkingNotes ?? "",
    },
    setupCleanup: {
      transportationNotes: event.transportationNotes,
      setupDetails: found?.setupDetails ?? "",
      areas: extra.setupAreas,
      cleanup: extra.cleanup,
    },
    notes: { additionalNotes: found?.additionalNotes ?? "" },
  };
}

// The key fields from business settings (FLOW-144 AC2).
async function keyFieldSetting(tx: DbLike) {
  return (await businessDefaults(tx)).beoKeyFields;
}

// Compares the BEO's fields with the snapshot from the last check and records what
// changed. Called inside the transaction of anything that edits the BEO's own
// text, and after any other write under /api/events/<id> (worker/beo-sync.ts), so
// a missed check is caught by the next one. Does nothing when the event has no BEO.
export async function syncBeo(tx: DbLike, actor: Actor, eventId: string) {
  const beo = await findBeo(tx, eventId, true);
  if (!beo) return null;
  const fields = beoFields(await assembleBeo(tx, actor, eventId, beo));
  const changes = diffBeoFields(beo.snapshot, fields);
  if (!changes.length) return beo;
  const wasApproved = beo.status === "approved";
  // Key fields send an approved BEO back to "working on" (FLOW-144 AC2).
  const returned = wasApproved && touchesKeyField(changes, await keyFieldSetting(tx));
  await tx
    .update(beos)
    .set({
      snapshot: snapshotOfFields(fields),
      status: returned ? "working_on" : beo.status,
      updatedBy: actor.userId,
    })
    .where(eq(beos.id, beo.id));
  // Once approved, every edit is logged (field, old, new, who, when) and stays
  // marked until the next approval.
  if (beo.approvedAt)
    await tx.insert(beoChanges).values(
      changes.map((change) => ({
        beoId: beo.id,
        eventId,
        fieldKey: change.key,
        fieldLabel: change.label,
        section: change.section,
        oldValue: change.from,
        newValue: change.to,
        changedBy: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    );
  if (wasApproved)
    await emitDomainEvent(tx, {
      name: "beo.changed_after_approval",
      entityId: eventId,
      data: {
        beoId: beo.id,
        actorId: actor.userId,
        fields: changes.map((change) => change.label),
        returnedToWorkingOn: returned,
      },
    });
  return { ...beo, status: returned ? ("working_on" as const) : beo.status };
}

async function personNames(tx: DbLike, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const rows = wanted.length
    ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, wanted))
    : [];
  return new Map(rows.map((row) => [row.id, row.name]));
}

// FLOW-148: the BEO as this reader may see it. 404 unless they can open the event.
export async function getBeo(db: DbLike, actor: Actor, eventId: string): Promise<BeoView> {
  await findVisibleEvent(db, actor, eventId);
  const beo = await findBeo(db, eventId);
  const content = projectBeo(actor, await assembleBeo(db, actor, eventId, beo ?? null));
  const rows = beo
    ? await db
        .select()
        .from(beoChanges)
        .where(and(eq(beoChanges.beoId, beo.id), isNull(beoChanges.archivedAt)))
        .orderBy(desc(beoChanges.createdAt), desc(beoChanges.id))
        .limit(100)
    : [];
  const names = await personNames(db, [beo?.approvedBy ?? null, ...rows.map((row) => row.changedBy)]);
  const person = (id: string | null) => (id ? { id, name: names.get(id) ?? "" } : null);
  const changes: BeoChange[] = rows.map((row) => ({
    id: row.id,
    fieldKey: row.fieldKey,
    fieldLabel: row.fieldLabel,
    section: beoSectionSchema.catch("notes").parse(row.section),
    from: row.oldValue,
    to: row.newValue,
    changedBy: person(row.changedBy),
    changedAt: row.createdAt.toISOString(),
    marked: row.marked,
  }));
  const marked = new Map<string, BeoChange>();
  for (const change of changes) if (change.marked && !marked.has(change.fieldKey)) marked.set(change.fieldKey, change);
  const canEdit = can(actor, "events.write");
  return {
    eventId,
    exists: Boolean(beo),
    id: beo?.id ?? null,
    status: beo?.status ?? null,
    approvedAt: beo?.approvedAt?.toISOString() ?? null,
    approvedBy: person(beo?.approvedBy ?? null),
    content,
    changedFields: [...marked.values()].map((change) => ({
      key: change.fieldKey,
      label: change.fieldLabel,
      section: change.section,
    })),
    changes,
    keyFields: await keyFieldSetting(db),
    canEdit,
    canApprove: can(actor, "beos.approve"),
    canRequestApproval: canEdit && beo?.status === "working_on",
    canCheckOff: Boolean(beo),
  };
}

// FLOW-143: generates the BEO. It starts as "working on". Asking again answers
// the BEO that is already there.
export async function createBeo(db: Db, actor: Actor, eventId: string): Promise<BeoView> {
  if (!can(actor, "events.write")) throw forbidden();
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    await ensureBeoDraft(tx, actor.userId, eventId);
  });
  return getBeo(db, actor, eventId);
}

// Used by the planning job and the explicit BEO action. A retry preserves the
// existing draft, its edits and approval history.
export async function ensureBeoDraft(tx: DbLike, userId: string, eventId: string) {
  if (await findBeo(tx, eventId, true)) return false;
  const actor: Actor = { userId, role: "admin", employmentType: "full_time" };
  const [row] = await tx.insert(beos)
    .values({ eventId, status: "working_on", snapshot: {}, createdBy: userId, updatedBy: userId })
    .returning();
  const event = await getEvent(asDb(tx), actor, eventId);
  await seedParts(tx, actor, row, event.areas.map((area) => area.name));
  const fields = beoFields(await assembleBeo(tx, actor, eventId, row));
  await tx.update(beos).set({ snapshot: snapshotOfFields(fields) }).where(eq(beos.id, row.id));
  return true;
}

// The parts of the BEO that no other record owns yet.
export async function updateBeoNotes(
  db: Db,
  actor: Actor,
  eventId: string,
  input: BeoNotesInput,
): Promise<BeoView> {
  if (!can(actor, "events.write")) throw forbidden();
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const beo = await findBeo(tx, eventId, true);
    if (!beo) throw notFound("Banquet event order");
    await tx
      .update(beos)
      .set({
        ...(input.setupDetails !== undefined && { setupDetails: input.setupDetails }),
        ...(input.additionalNotes !== undefined && { additionalNotes: input.additionalNotes }),
        updatedBy: actor.userId,
      })
      .where(eq(beos.id, beo.id));
    await syncBeo(tx, actor, eventId);
  });
  return getBeo(db, actor, eventId);
}

// --- Approval (FLOW-144) --------------------------------------------------------

// The Sales Manager approves; Admin can too (engine: approver role plus Admin).
registerApprovalSubject("beo", {
  approverRole: "sales_manager",
  onApproved: async (tx, actor, request) => {
    const [beo] = await tx.select().from(beos).where(eq(beos.id, request.subjectId)).for("update");
    if (!beo) return;
    const fields = beoFields(await assembleBeo(tx, actor, beo.eventId, beo));
    const now = new Date();
    await tx
      .update(beos)
      .set({
        status: "approved",
        approvalId: request.id,
        approvedAt: now,
        approvedBy: actor.userId,
        snapshot: snapshotOfFields(fields),
        updatedBy: actor.userId,
      })
      .where(eq(beos.id, beo.id));
    // A new approval clears the "changed since approval" marks.
    await tx
      .update(beoChanges)
      .set({ marked: false, updatedBy: actor.userId })
      .where(and(eq(beoChanges.beoId, beo.id), eq(beoChanges.marked, true)));
    await emitDomainEvent(tx, {
      name: "beo.approved",
      entityId: beo.eventId,
      idempotencyKey: `beo.approved:${request.id}`,
      data: { beoId: beo.id, approvedBy: actor.userId },
    });
  },
  onRejected: async (tx, actor, request) => {
    await tx
      .update(beos)
      .set({ status: "working_on", updatedBy: actor.userId })
      .where(and(eq(beos.id, request.subjectId), eq(beos.status, "pending_approval")));
  },
  onWithdrawn: async (tx, actor, request) => {
    await tx
      .update(beos)
      .set({ status: "working_on", updatedBy: actor.userId })
      .where(and(eq(beos.id, request.subjectId), eq(beos.status, "pending_approval")));
  },
});

async function openRequest(tx: DbLike, actor: Actor, eventId: string, notifyApprovers: boolean) {
  const event = await findVisibleEvent(tx, actor, eventId);
  const beo = await findBeo(tx, eventId, true);
  if (!beo) throw notFound("Banquet event order");
  if (beo.status === "approved")
    throw new ApiError(409, "BEO_APPROVED", "This banquet event order is already approved.");
  const approvalId = await requestApproval(tx, actor, {
    subjectType: "beo",
    subjectId: beo.id,
    summary: `Approve the banquet event order: ${event.title}`,
    link: `/events/${eventId}`,
    notifyApprovers,
  });
  await tx
    .update(beos)
    .set({ status: "pending_approval", approvalId, updatedBy: actor.userId })
    .where(eq(beos.id, beo.id));
  return { beo, approvalId };
}

// Asks the Sales Manager to approve; the request shows in their approvals queue.
export async function requestBeoApproval(db: Db, actor: Actor, eventId: string): Promise<BeoView> {
  if (!can(actor, "events.write")) throw forbidden();
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const beo = await findBeo(tx, eventId, true);
    if (beo?.status === "pending_approval")
      throw new ApiError(409, "BEO_PENDING", "This banquet event order is already waiting for approval.");
    await openRequest(tx, actor, eventId, true);
  });
  return getBeo(db, actor, eventId);
}

// Approves the BEO now: through the open request, or one made and decided here by
// the approver themselves (FLOW-144). Emits beo.approved.
export async function approveBeo(db: Db, actor: Actor, eventId: string): Promise<BeoView> {
  if (!can(actor, "beos.approve")) throw forbidden();
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const beo = await findBeo(tx, eventId, true);
    if (!beo) throw notFound("Banquet event order");
    if (beo.status === "approved")
      throw new ApiError(409, "BEO_APPROVED", "This banquet event order is already approved.");
    const approvalId =
      beo.status === "pending_approval" && beo.approvalId
        ? beo.approvalId
        : (await openRequest(tx, actor, eventId, false)).approvalId;
    await decideApproval(tx, actor, approvalId, "approve", "");
  });
  return getBeo(db, actor, eventId);
}

// The approved BEOs of the events the actor is assigned to (production or assistant
// lead, or a staff slot) that start today or in the next `days` days, New York time
// (FLOW-150). Each BEO is projected for the actor's role, like getBeo.
export async function offlineBeos(
  db: Db,
  actor: Actor,
  days = OFFLINE_BEO_DAYS,
  now = new Date(),
): Promise<OfflineBeos> {
  const today = utcToBusinessTime(now).date;
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .innerJoin(beos, and(eq(beos.eventId, events.id), isNull(beos.archivedAt), eq(beos.status, "approved")))
    .where(
      and(
        isNull(events.archivedAt),
        gte(events.startsAt, businessTimeToUtc(today, "00:00")),
        lt(events.startsAt, businessTimeToUtc(addLocalDays(today, days + 1), "00:00")),
        or(
          eq(events.productionLeadId, actor.userId),
          sql`${events.assistantLeadIds} @> ${JSON.stringify([actor.userId])}::jsonb`,
          sql`exists (select 1 from ${eventStaffSlots} join ${eventShifts} on ${eventShifts.id} = ${eventStaffSlots.shiftId} where ${eventShifts.eventId} = ${events.id} and ${eventStaffSlots.assigneeId} = ${actor.userId} and ${eventStaffSlots.archivedAt} is null and ${eventShifts.archivedAt} is null)`,
        ),
      ),
    )
    .orderBy(asc(events.startsAt));
  const result: OfflineBeos["beos"] = [];
  for (const { id } of rows) {
    result.push({ event: await getEvent(db, actor, id), beo: await getBeo(db, actor, id) });
  }
  return { days, syncedAt: now.toISOString(), beos: result };
}
