import { and, eq, gte, isNull, lt } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { beos, eventShifts, eventStaffSlots, events, jobs, paymentScheduleItems, payments, truckAssignments, users } from "../db/schema";
import { emitDomainEvent } from "../jobs/queue";
import { getSettings } from "./settings";
import { getProductionList } from "./production";

const scanner: Actor = { userId: "00000000-0000-4000-8000-000000000000", role: "admin", employmentType: "full_time" };

// Called by cron and by event write middleware. Job keys include the source
// situation and stage, so a repeated scan cannot send the same alert twice.
export async function scanProductionAlerts(db: DbLike, now = new Date(), onlyEventId?: string) {
  const today = utcToBusinessTime(now).date;
  const { defaults } = await getSettings(db);
  const end = businessTimeToUtc(addLocalDays(today, 30), "00:00");
  const candidates = onlyEventId ? await db.select().from(events).where(and(eq(events.id, onlyEventId), isNull(events.archivedAt)))
    : await db.select().from(events).where(and(isNull(events.archivedAt), gte(events.startsAt, businessTimeToUtc(addLocalDays(today, -1), "00:00")), lt(events.startsAt, end)));
  if (!candidates.length) return 0;
  const managers = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "sales_manager"), eq(users.status, "active"), isNull(users.archivedAt)));
  let count = 0;
  for (const event of candidates) {
    if (event.status === "lost" || event.status === "finished") continue;
    const ids = [event.productionLeadId, ...event.assistantLeadIds].filter((id): id is string => Boolean(id));
    const initial = ids.length ? [...new Set(ids)] : managers.map((row) => row.id);
    const list = await getProductionList(db, scanner, event.id, now);
    const eventDate = utcToBusinessTime(event.startsAt).date;
    const digestRecipients = [...new Set([...ids, ...managers.map((row) => row.id)])];
    if (list.items.length && digestRecipients.length && eventDate <= addLocalDays(today, 14)) {
      const digest = await emitDomainEvent(db, { name: "production.alert_raised", entityId: event.id,
        data: { recipientIds: digestRecipients, title: `Production list: ${event.title}`,
          body: `${list.percent}% complete · ${list.complete} of ${list.total} items ready.`, link: `/events/${event.id}` },
        idempotencyKey: `production:list:${event.id}:${today}` });
      if (digest) count++;
    }
    const open = list.items.filter((item) => !item.complete && (
      item.type === "readiness" || item.type === "shortage" || item.type === "staff" || item.type === "truck" ||
      item.type === "kitchen" || (item.type === "task" && (item.assignedUserIds.length === 0 || new Date(item.due) < now)) ||
      ((item.type === "pull" || item.type === "order" || item.type === "setup") && new Date(item.due) < now)
    ));
    for (const item of open) {
      const overdue = item.type === "task" && new Date(item.due) < now;
      const urgent = overdue || item.type === "shortage";
      const firstAt = new Date(item.due);
      const signature = `${item.id}:${item.title}:${item.due}`;
      const alert = async (stage: "initial" | "escalated", recipientIds: string[]) => {
        if (!recipientIds.length) return undefined;
        const job = await emitDomainEvent(db, { name: urgent ? "production.urgent_raised" : "production.alert_raised",
          entityId: event.id, data: { recipientIds, title: `${stage === "escalated" ? "Escalated: " : ""}${item.title}`,
            body: `${event.title} needs attention.`, link: `/events/${event.id}`, observedAt: now.toISOString() },
          idempotencyKey: `production:${event.id}:${signature}:${stage}` });
        if (job) count++;
        return job;
      };
      const initialJob = await alert("initial", initial);
      const [stored] = initialJob ? [initialJob] : await db.select().from(jobs)
        .where(eq(jobs.idempotencyKey, `production:${event.id}:${signature}:initial`));
      const payload = stored?.payload as { observedAt?: string } | null;
      const observedAt = payload?.observedAt ? new Date(payload.observedAt) : stored?.createdAt ?? firstAt;
      if (overdue && stored && now.getTime() >= observedAt.getTime() + defaults.productionEscalationHours * 60 * 60_000)
        await alert("escalated", managers.map((row) => row.id));
    }
    const [beo] = await db.select({ status: beos.status }).from(beos).where(and(eq(beos.eventId, event.id), isNull(beos.archivedAt)));
    if (eventDate <= addLocalDays(today, defaults.beoApprovalDays) && beo?.status !== "approved") {
      const job = await emitDomainEvent(db, { name: "production.alert_raised", entityId: event.id,
        data: { recipientIds: initial, title: `BEO needs approval: ${event.title}`, body: "Approve the BEO before the event.", link: `/events/${event.id}` },
        idempotencyKey: `production:beo:${event.id}:${eventDate}:${beo?.status ?? "missing"}` });
      if (job) count++;
    }
    if (eventDate <= addLocalDays(today, defaults.balanceWarningDays)) {
      const [scheduled, paid] = await Promise.all([
        db.select({ amount: paymentScheduleItems.amountCents }).from(paymentScheduleItems).where(and(eq(paymentScheduleItems.eventId, event.id), isNull(paymentScheduleItems.archivedAt))),
        db.select({ amount: payments.amountCents }).from(payments).where(and(eq(payments.eventId, event.id), isNull(payments.archivedAt))),
      ]);
      const balance = scheduled.reduce((sum, row) => sum + row.amount, 0) - paid.reduce((sum, row) => sum + row.amount, 0);
      if (balance > 0 && scheduled.length) {
        const job = await emitDomainEvent(db, { name: "production.urgent_raised", entityId: event.id,
          data: { recipientIds: initial, title: `Unpaid balance: ${event.title}`, body: "A payment remains outstanding near the event.", link: `/events/${event.id}` },
          idempotencyKey: `production:balance:${event.id}:${balance}:${eventDate}` });
        if (job) count++;
      }
    }
    if (eventDate === addLocalDays(today, 1)) {
      const [slots, assignments] = await Promise.all([
        db.select({ userId: eventStaffSlots.assigneeId }).from(eventStaffSlots)
          .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
          .where(and(eq(eventShifts.eventId, event.id), isNull(eventStaffSlots.archivedAt), isNull(eventShifts.archivedAt))),
        db.select({ driverId: truckAssignments.driverId, loaderIds: truckAssignments.loaderIds }).from(truckAssignments)
          .where(and(eq(truckAssignments.eventId, event.id), isNull(truckAssignments.archivedAt))),
      ]);
      const staff = [...new Set([...ids, ...slots.map((row) => row.userId), ...assignments.flatMap((row) => [row.driverId, ...row.loaderIds])]
        .filter((id): id is string => Boolean(id)))];
      for (const userId of staff) {
        const job = await emitDomainEvent(db, { name: "event.offline_reminder", entityId: event.id,
          data: { recipientIds: [userId], title: `Open ${event.title} in Flowbase today`,
            body: "Open Flowbase before the event so your BEO is available offline.", link: `/events/${event.id}` },
          idempotencyKey: `offline:${event.id}:${eventDate}:${userId}` });
        if (job) count++;
      }
    }
  }
  return count;
}
