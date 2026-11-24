import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import type { DbLike } from "../../db/client";
import { beos, eventShifts, eventStaffSlots, events, jobs, paymentScheduleItems, payments, truckAssignments, users } from "../../db/schema";
import { emitDomainEvent } from "../../jobs/queue";
import { getSettings } from "../settings/settings";
import { getProductionLists } from "./production";

const scanner: Actor = { userId: "00000000-0000-4000-8000-000000000000", role: "admin" };

// Events per batch of set-based queries (FLOW-307).
export const SCAN_BATCH_SIZE = 25;

type Emission = { key: string; name: string; entityId: string; data: Record<string, unknown> };

// Called by cron and by the production.scan job. Job keys include the source
// situation and stage, so a repeated scan cannot send the same alert twice.
// Events load in batches of SCAN_BATCH_SIZE with set-based queries keyed by
// event id, and the alerts a batch already raised are read in one query, so a
// quiet scan costs a fixed number of queries per batch (FLOW-307).
export async function scanProductionAlerts(db: DbLike, now = new Date(), onlyEventId?: string) {
  const today = utcToBusinessTime(now).date;
  const { defaults } = await getSettings(db);
  const end = businessTimeToUtc(addLocalDays(today, 30), "00:00");
  const candidates = onlyEventId ? await db.select().from(events).where(and(eq(events.id, onlyEventId), isNull(events.archivedAt)))
    : await db.select().from(events).where(and(isNull(events.archivedAt), gte(events.startsAt, businessTimeToUtc(addLocalDays(today, -1), "00:00")), lt(events.startsAt, end)));
  const active = candidates.filter((event) => event.status !== "lost" && event.status !== "finished");
  if (!active.length) return 0;
  const managers = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "sales_manager"), eq(users.status, "active"), isNull(users.archivedAt)));
  let count = 0;
  for (let index = 0; index < active.length; index += SCAN_BATCH_SIZE)
    count += await scanBatch(db, now, today, defaults, managers.map((row) => row.id), active.slice(index, index + SCAN_BATCH_SIZE));
  return count;
}

async function scanBatch(db: DbLike, now: Date, today: string,
  defaults: Awaited<ReturnType<typeof getSettings>>["defaults"], managerIds: string[],
  batch: (typeof events.$inferSelect)[]) {
  const ids = batch.map((event) => event.id);
  const tomorrow = batch.filter((event) => utcToBusinessTime(event.startsAt).date === addLocalDays(today, 1)).map((event) => event.id);
  const [lists, beoRows, scheduledRows, paidRows, slotRows, assignmentRows] = await Promise.all([
    getProductionLists(db, scanner, ids, now),
    db.select({ eventId: beos.eventId, status: beos.status }).from(beos).where(and(inArray(beos.eventId, ids), isNull(beos.archivedAt))),
    db.select({ eventId: paymentScheduleItems.eventId, amount: paymentScheduleItems.amountCents }).from(paymentScheduleItems)
      .where(and(inArray(paymentScheduleItems.eventId, ids), isNull(paymentScheduleItems.archivedAt))),
    db.select({ eventId: payments.eventId, amount: payments.amountCents }).from(payments)
      .where(and(inArray(payments.eventId, ids), isNull(payments.archivedAt))),
    tomorrow.length ? db.select({ eventId: eventShifts.eventId, userId: eventStaffSlots.assigneeId }).from(eventStaffSlots)
      .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
      .where(and(inArray(eventShifts.eventId, tomorrow), isNull(eventStaffSlots.archivedAt), isNull(eventShifts.archivedAt))) : [],
    tomorrow.length ? db.select({ eventId: truckAssignments.eventId, driverId: truckAssignments.driverId, loaderIds: truckAssignments.loaderIds })
      .from(truckAssignments).where(and(inArray(truckAssignments.eventId, tomorrow), isNull(truckAssignments.archivedAt))) : [],
  ]);
  // First pass: every alert the batch would raise, in the order it raised them.
  const emissions: Emission[] = [];
  const escalations: { event: typeof events.$inferSelect; initialKey: string; urgent: boolean; title: string; signature: string; firstAt: Date }[] = [];
  const alertData = (title: string, eventTitle: string, eventId: string) =>
    ({ title, body: `${eventTitle} needs attention.`, link: `/events/${eventId}`, observedAt: now.toISOString() });
  for (const event of batch) {
    const list = lists.get(event.id);
    if (!list) continue;
    const ids = [event.productionLeadId, ...event.assistantLeadIds].filter((id): id is string => Boolean(id));
    const initial = ids.length ? [...new Set(ids)] : managerIds;
    const eventDate = utcToBusinessTime(event.startsAt).date;
    const digestRecipients = [...new Set([...ids, ...managerIds])];
    if (list.items.length && digestRecipients.length && eventDate <= addLocalDays(today, 14))
      emissions.push({ key: `production:list:${event.id}:${today}`, name: "production.alert_raised", entityId: event.id,
        data: { recipientIds: digestRecipients, title: `Production list: ${event.title}`,
          body: `${list.percent}% complete · ${list.complete} of ${list.total} items ready.`, link: `/events/${event.id}` } });
    const open = list.items.filter((item) => !item.complete && (
      item.type === "readiness" || item.type === "shortage" || item.type === "staff" || item.type === "truck" ||
      item.type === "kitchen" || (item.type === "task" && (item.assignedUserIds.length === 0 || new Date(item.due) < now)) ||
      ((item.type === "pull" || item.type === "order" || item.type === "setup") && new Date(item.due) < now)
    ));
    for (const item of open) {
      const overdue = item.type === "task" && new Date(item.due) < now;
      const urgent = overdue || item.type === "shortage";
      const signature = `${item.id}:${item.title}:${item.due}`;
      const initialKey = `production:${event.id}:${signature}:initial`;
      if (initial.length) emissions.push({ key: initialKey, name: urgent ? "production.urgent_raised" : "production.alert_raised",
        entityId: event.id, data: { recipientIds: initial, ...alertData(item.title, event.title, event.id) } });
      if (overdue) escalations.push({ event, initialKey, urgent, title: item.title, signature, firstAt: new Date(item.due) });
    }
    const beo = beoRows.find((row) => row.eventId === event.id);
    if (eventDate <= addLocalDays(today, defaults.beoApprovalDays) && beo?.status !== "approved")
      emissions.push({ key: `production:beo:${event.id}:${eventDate}:${beo?.status ?? "missing"}`, name: "production.alert_raised", entityId: event.id,
        data: { recipientIds: initial, title: `BEO needs approval: ${event.title}`, body: "Approve the BEO before the event.", link: `/events/${event.id}` } });
    if (eventDate <= addLocalDays(today, defaults.balanceWarningDays)) {
      const scheduled = scheduledRows.filter((row) => row.eventId === event.id);
      const paid = paidRows.filter((row) => row.eventId === event.id);
      const balance = scheduled.reduce((sum, row) => sum + row.amount, 0) - paid.reduce((sum, row) => sum + row.amount, 0);
      if (balance > 0 && scheduled.length)
        emissions.push({ key: `production:balance:${event.id}:${balance}:${eventDate}`, name: "production.urgent_raised", entityId: event.id,
          data: { recipientIds: initial, title: `Unpaid balance: ${event.title}`, body: "A payment remains outstanding near the event.", link: `/events/${event.id}` } });
    }
    if (eventDate === addLocalDays(today, 1)) {
      const staff = [...new Set([...ids, ...slotRows.filter((row) => row.eventId === event.id).map((row) => row.userId),
        ...assignmentRows.filter((row) => row.eventId === event.id).flatMap((row) => [row.driverId, ...row.loaderIds])]
        .filter((id): id is string => Boolean(id)))];
      for (const userId of staff)
        emissions.push({ key: `offline:${event.id}:${eventDate}:${userId}`, name: "event.offline_reminder", entityId: event.id,
          data: { recipientIds: [userId], title: `Open ${event.title} in Flowbase today`,
            body: "Open Flowbase before the event so your BEO is available offline.", link: `/events/${event.id}` } });
    }
  }
  const escalationKey = (row: typeof escalations[number]) => `production:${row.event.id}:${row.signature}:escalated`;
  const keys = [...new Set([...emissions.map((row) => row.key), ...escalations.flatMap((row) => [row.initialKey, escalationKey(row)])])];
  if (!keys.length) return 0;
  // Alerts already raised: one query for the batch. Their insert would be a no-op.
  const existing = new Map((await db.select({ key: jobs.idempotencyKey, payload: jobs.payload, createdAt: jobs.createdAt })
    .from(jobs).where(inArray(jobs.idempotencyKey, keys))).map((row) => [row.key, row]));
  let count = 0;
  const emit = async (emission: Emission) => {
    if (existing.has(emission.key)) return undefined;
    const job = await emitDomainEvent(db, { name: emission.name, entityId: emission.entityId, data: emission.data,
      idempotencyKey: emission.key });
    if (job) {
      count++;
      existing.set(emission.key, { key: emission.key, payload: job.payload, createdAt: job.createdAt });
    }
    return job;
  };
  for (const emission of emissions) await emit(emission);
  for (const row of escalations) {
    // The first alert's time, from the job (created now or before).
    const stored = existing.get(row.initialKey);
    const payload = stored?.payload as { observedAt?: string } | null | undefined;
    const observedAt = payload?.observedAt ? new Date(payload.observedAt) : stored?.createdAt ?? row.firstAt;
    if (stored && managerIds.length && now.getTime() >= observedAt.getTime() + defaults.productionEscalationHours * 60 * 60_000)
      await emit({ key: escalationKey(row), name: row.urgent ? "production.urgent_raised" : "production.alert_raised",
        entityId: row.event.id, data: { recipientIds: managerIds, ...alertData(`Escalated: ${row.title}`, row.event.title, row.event.id) } });
  }
  return count;
}
