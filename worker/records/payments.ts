import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import { isFtPlus } from "../../shared/access";
import {
  byDueDate,
  dueForReminder,
  formatCents,
  allocatePayments,
  parsePaymentLine,
  paymentTotals,
  type EventPayments,
  type PaymentSuggestion,
  type paymentInputSchema,
  type scheduleItemInputSchema,
} from "../../shared/payments";
import type { ProposalMapping } from "../../shared/proposal-mapping";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { canSeeField } from "../../shared/visibility";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  events,
  paymentScheduleItems,
  payments,
  proposalMappings,
  proposals,
  users,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can } from "../policy";
import { findVisibleEvent } from "./events";
import { getSettings } from "./settings";

// The payment schedule and payment log (FLOW-131) and the reminders and overdue
// flag that follow them (FLOW-132). Money is integer cents. A reference never holds
// a card number (shared/payments.ts). Full-time staff only, and only those who may
// see an event's financials: Admin, Technical, Sales Manager and the event's own
// salesperson. Everyone else gets a 403, so a part-time user never sees an amount
// (AC3).

type ItemRow = typeof paymentScheduleItems.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ItemInput = z.output<typeof scheduleItemInputSchema>;
type PaymentInput = z.output<typeof paymentInputSchema>;

const todayOf = (now: Date) => utcToBusinessTime(now).date;

export function mayViewPayments(
  actor: Actor,
  event: { assignedSalespersonId: string | null },
) {
  return (
    isFtPlus(actor) &&
    canSeeField(actor, "financials", {
      assignedSalespersonId: event.assignedSalespersonId,
    })
  );
}

async function visibleEventForPayments(db: DbLike, actor: Actor, eventId: string) {
  const event = await findVisibleEvent(db, actor, eventId);
  if (!mayViewPayments(actor, event))
    throw forbidden();
  return event;
}

function paymentLines(mapping: ProposalMapping) {
  return mapping.paymentSchedule.map((line, index) => ({
    sourceKey: line.sourceBlockId ?? `line-${index}`,
    text: line.value.trim(),
  }));
}

async function paymentsOf(
  db: DbLike,
  actor: Actor,
  eventId: string,
  now = new Date(),
): Promise<EventPayments> {
  const today = todayOf(now);
  const [items, received, settings] = await Promise.all([
    db
      .select()
      .from(paymentScheduleItems)
      .where(
        and(
          eq(paymentScheduleItems.eventId, eventId),
          isNull(paymentScheduleItems.archivedAt),
        ),
      ),
    db
      .select({
        payment: payments,
        recorderName: users.name,
        recorderEmail: users.email,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.createdBy))
      .where(and(eq(payments.eventId, eventId), isNull(payments.archivedAt)))
      .orderBy(desc(payments.receivedOn), desc(payments.createdAt)),
    getSettings(db),
  ]);
  const sorted = [...items].sort(byDueDate);
  const receivedCents = received.reduce((sum, r) => sum + r.payment.amountCents, 0);
  const totals = paymentTotals(sorted, receivedCents, today);
  const itemById = new Map(sorted.map((i) => [i.id, i]));

  let suggestions: PaymentSuggestion[] = [];
  if (can(actor, "proposals.read")) {
    const mappings = await db
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
    // Archived items still count as used, so removing one never re-suggests it
    // unless it is added again on purpose.
    const used = new Set(
      items.filter((i) => i.proposalId && i.sourceKey).map((i) => `${i.proposalId}:${i.sourceKey}`),
    );
    suggestions = mappings.flatMap((m) =>
      paymentLines(m.data)
        .filter((l) => l.text && !used.has(`${m.proposalId}:${l.sourceKey}`))
        .map((l) => ({
          proposalId: m.proposalId,
          proposalTitle: m.title,
          sourceKey: l.sourceKey,
          text: l.text,
          ...parsePaymentLine(l.text),
        })),
    );
  }

  return {
    eventId,
    schedule: totals.allocated.map((item) => {
      const row = itemById.get(item.id)!;
      return {
        id: row.id,
        kind: row.kind,
        label: row.label,
        amountCents: row.amountCents,
        dueDate: row.dueDate,
        paidCents: item.paidCents,
        remainingCents: item.remainingCents,
        overdue: item.overdue,
        fromProposal: row.proposalId !== null,
      };
    }),
    payments: received.map(({ payment, recorderName, recorderEmail }) => ({
      id: payment.id,
      method: payment.method,
      amountCents: payment.amountCents,
      receivedOn: payment.receivedOn,
      reference: payment.reference,
      note: payment.note,
      recordedBy: payment.createdBy
        ? { id: payment.createdBy, name: recorderName || recorderEmail || payment.createdBy }
        : null,
      recordedAt: payment.createdAt.toISOString(),
    })),
    totalCents: totals.totalCents,
    paidCents: totals.paidCents,
    balanceCents: totals.balanceCents,
    overdueCount: totals.overdueCount,
    overdueCents: totals.overdueCents,
    today,
    reminderDays: settings.defaults.paymentReminderDays,
    suggestions,
    canEdit: can(actor, "payments.record"),
  };
}

export async function getEventPayments(db: Db, actor: Actor, eventId: string) {
  await visibleEventForPayments(db, actor, eventId);
  return paymentsOf(db, actor, eventId);
}

function requireRecord(actor: Actor) {
  if (!can(actor, "payments.record"))
    throw forbidden();
}

const itemSnapshot = (row: ItemRow) => ({
  eventId: row.eventId,
  kind: row.kind,
  label: row.label,
  amountCents: row.amountCents,
  dueDate: row.dueDate,
  proposalId: row.proposalId,
  sourceKey: row.sourceKey,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

const paymentSnapshot = (row: PaymentRow) => ({
  eventId: row.eventId,
  method: row.method,
  amountCents: row.amountCents,
  receivedOn: row.receivedOn,
  reference: row.reference,
  note: row.note,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

async function findItem(tx: DbLike, eventId: string, itemId: string) {
  const [row] = await tx
    .select()
    .from(paymentScheduleItems)
    .where(
      and(
        eq(paymentScheduleItems.id, itemId),
        eq(paymentScheduleItems.eventId, eventId),
        isNull(paymentScheduleItems.archivedAt),
      ),
    )
    .for("update");
  if (!row) throw notFound("Schedule item");
  return row;
}

// An item added from a proposal line must name a line the current mapping has.
async function checkSource(tx: DbLike, eventId: string, source: ItemInput["source"]) {
  if (!source) return { proposalId: null, sourceKey: null };
  const [row] = await tx
    .select({ data: proposalMappings.data })
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
        eq(proposals.id, source.proposalId),
        eq(proposals.eventId, eventId),
        isNull(proposals.archivedAt),
      ),
    );
  if (!row || !paymentLines(row.data).some((l) => l.sourceKey === source.sourceKey))
    throw new ApiError(400, "INVALID_REQUEST", "That proposal line is no longer on the proposal.");
  return { proposalId: source.proposalId, sourceKey: source.sourceKey };
}

export async function createScheduleItem(
  db: Db,
  actor: Actor,
  eventId: string,
  input: ItemInput,
) {
  await visibleEventForPayments(db, actor, eventId);
  requireRecord(actor);
  await db.transaction(async (tx) => {
    const source = await checkSource(tx, eventId, input.source);
    const [row] = await tx
      .insert(paymentScheduleItems)
      .values({
        eventId,
        kind: input.kind,
        label: input.label,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        ...source,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "payment_schedule_item",
      entityId: row.id,
      action: "create",
      before: null,
      after: itemSnapshot(row),
    });
  });
  return paymentsOf(db, actor, eventId);
}

export async function updateScheduleItem(
  db: Db,
  actor: Actor,
  eventId: string,
  itemId: string,
  input: ItemInput,
) {
  await visibleEventForPayments(db, actor, eventId);
  requireRecord(actor);
  await db.transaction(async (tx) => {
    const before = await findItem(tx, eventId, itemId);
    const [after] = await tx
      .update(paymentScheduleItems)
      .set({
        kind: input.kind,
        label: input.label,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        updatedBy: actor.userId,
      })
      .where(eq(paymentScheduleItems.id, itemId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "payment_schedule_item",
      entityId: itemId,
      action: "update",
      before: itemSnapshot(before),
      after: itemSnapshot(after),
    });
  });
  return paymentsOf(db, actor, eventId);
}

export async function archiveScheduleItem(
  db: Db,
  actor: Actor,
  eventId: string,
  itemId: string,
) {
  await visibleEventForPayments(db, actor, eventId);
  requireRecord(actor);
  await db.transaction(async (tx) => {
    const before = await findItem(tx, eventId, itemId);
    const [after] = await tx
      .update(paymentScheduleItems)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(paymentScheduleItems.id, itemId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "payment_schedule_item",
      entityId: itemId,
      action: "archive",
      before: itemSnapshot(before),
      after: itemSnapshot(after),
    });
  });
  return paymentsOf(db, actor, eventId);
}

// Records a payment received (AC: method, amount, date, reference, who recorded it)
// and emits payment.recorded in the same transaction.
export async function recordPayment(
  db: Db,
  actor: Actor,
  eventId: string,
  input: PaymentInput,
) {
  await visibleEventForPayments(db, actor, eventId);
  requireRecord(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(payments)
      .values({
        eventId,
        method: input.method,
        amountCents: input.amountCents,
        receivedOn: input.receivedOn,
        reference: input.reference,
        note: input.note,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "payment",
      entityId: row.id,
      action: "create",
      before: null,
      after: paymentSnapshot(row),
    });
    await emitDomainEvent(tx, {
      name: "payment.recorded",
      entityId: row.id,
      data: {
        eventId,
        method: row.method,
        amountCents: row.amountCents,
        receivedOn: row.receivedOn,
      },
      idempotencyKey: `event:payment.recorded:${row.id}`,
    });
  });
  return paymentsOf(db, actor, eventId);
}

// A mistaken payment is removed (archived) rather than edited, so the log keeps
// its history in the audit trail.
export async function archivePayment(
  db: Db,
  actor: Actor,
  eventId: string,
  paymentId: string,
) {
  await visibleEventForPayments(db, actor, eventId);
  requireRecord(actor);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, paymentId),
          eq(payments.eventId, eventId),
          isNull(payments.archivedAt),
        ),
      )
      .for("update");
    if (!before) throw notFound("Payment");
    const [after] = await tx
      .update(payments)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(payments.id, paymentId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "payment",
      entityId: paymentId,
      action: "archive",
      before: paymentSnapshot(before),
      after: paymentSnapshot(after),
    });
  });
  return paymentsOf(db, actor, eventId);
}

// FLOW-132. Run by the cron. For each live event with a scheduled item due within
// the reminder window, or already past due, with money still owed, queues
// payment.due (once per item and due date, AC1) or payment.overdue (once per item
// and due date) for the event's salesperson. Internal only: the client is never
// told. The notification payload is the generic one (recipientIds, title, body,
// link), so the notification fan-out delivers it unchanged.
export async function emitPaymentReminders(db: DbLike, now = new Date()) {
  const today = todayOf(now);
  const { defaults } = await getSettings(db);
  const until = addLocalDays(today, defaults.paymentReminderDays);

  const candidates = await db
    .selectDistinct({ eventId: paymentScheduleItems.eventId })
    .from(paymentScheduleItems)
    .innerJoin(events, eq(events.id, paymentScheduleItems.eventId))
    .where(
      and(
        isNull(paymentScheduleItems.archivedAt),
        isNull(events.archivedAt),
        lte(paymentScheduleItems.dueDate, until),
      ),
    );
  if (!candidates.length) return 0;
  const eventIds = candidates.map((c) => c.eventId);

  const [eventRows, items, received] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        salespersonId: events.assignedSalespersonId,
      })
      .from(events)
      .where(inArray(events.id, eventIds)),
    db
      .select()
      .from(paymentScheduleItems)
      .where(
        and(
          inArray(paymentScheduleItems.eventId, eventIds),
          isNull(paymentScheduleItems.archivedAt),
        ),
      ),
    db
      .select({
        eventId: payments.eventId,
        total: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
      })
      .from(payments)
      .where(and(inArray(payments.eventId, eventIds), isNull(payments.archivedAt)))
      .groupBy(payments.eventId),
  ]);
  const receivedBy = new Map(received.map((r) => [r.eventId, r.total]));

  let queued = 0;
  for (const event of eventRows) {
    if (!event.salespersonId) continue;
    const mine = items
      .filter((i) => i.eventId === event.id)
      .sort(byDueDate);
    const allocated = allocatePayments(mine, receivedBy.get(event.id) ?? 0, today);
    const link = `/events/${event.id}`;
    for (const item of dueForReminder(allocated, today, defaults.paymentReminderDays)) {
      await emitDomainEvent(db, {
        name: "payment.due",
        entityId: item.id,
        data: {
          recipientIds: [event.salespersonId],
          title: `Payment due ${item.dueDate}: ${event.title}`.slice(0, 200),
          body: `${formatCents(item.remainingCents)} is still owed${item.label ? ` (${item.label})` : ""}.`,
          link,
        },
        idempotencyKey: `event:payment.due:${item.id}:${item.dueDate}`,
      });
      queued += 1;
    }
    for (const item of allocated.filter((i) => i.overdue)) {
      await emitDomainEvent(db, {
        name: "payment.overdue",
        entityId: item.id,
        data: {
          recipientIds: [event.salespersonId],
          title: `Payment overdue: ${event.title}`.slice(0, 200),
          body: `${formatCents(item.remainingCents)} was due ${item.dueDate}${item.label ? ` (${item.label})` : ""}.`,
          link,
        },
        idempotencyKey: `event:payment.overdue:${item.id}:${item.dueDate}`,
      });
      queued += 1;
    }
  }
  return queued;
}
