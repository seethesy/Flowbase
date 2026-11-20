import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { roles } from "../../shared/access";
import { businessDefaultsSchema } from "../../shared/settings";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { eventShifts, eventStaffSlots, events, leads, settings, taskAssignees, tasks, users, venues } from "../db/schema";
import { leadScope, taskScope } from "../policy";
import { visibleEvents } from "./events";
import { visibleLeads } from "./leads";
import { getTaskSummaries } from "./tasks";

export async function homeDashboard(db: DbLike, actor: Actor, now = new Date()) {
  const [setting] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(setting?.value ?? {});
  const hideDays = parsed.success ? parsed.data.hideCompletedTasksAfterDays : 7;
  const cutoff = new Date(now.getTime() - hideDays * 86_400_000);
  const keepTask = or(ne(tasks.status, "done"), gte(tasks.completedAt, cutoff));
  const [mineIds, allIds] = await Promise.all([
    db.select({ id: taskAssignees.taskId }).from(taskAssignees)
      .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
      .where(and(eq(taskAssignees.userId, actor.userId), isNull(taskAssignees.archivedAt),
        isNull(tasks.archivedAt), keepTask)).orderBy(asc(tasks.dueAt)),
    taskScope(actor) === "all" ? db.select({ id: tasks.id }).from(tasks)
      .where(and(isNull(tasks.archivedAt), keepTask)).orderBy(asc(tasks.dueAt)) : Promise.resolve(null),
  ]);
  const [myTasks, allSummaries] = await Promise.all([
    getTaskSummaries(db, actor, mineIds.map((row) => row.id)),
    allIds ? getTaskSummaries(db, actor, allIds.map((row) => row.id)) : Promise.resolve(null),
  ]);
  const assigneeIds = [...new Set((allSummaries ?? []).flatMap((task) => task.assignees.map((person) => person.id)))];
  const roleRows = assigneeIds.length ? await db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, assigneeIds)) : [];
  const roleById = new Map(roleRows.map((row) => [row.id, row.role]));
  const allTasks = allSummaries?.map((task) => ({ task,
    assigneeRoles: [...new Set(task.assignees.flatMap((person) => roleById.get(person.id) ?? []))],
  })) ?? null;

  const myLeadRows = leadScope(actor) === "none" ? null : (await db.select({
    id: leads.id, client: leads.name, event: leads.eventName, date: leads.eventDate, status: leads.status,
  }).from(leads).where(and(visibleLeads(actor), eq(leads.assignedSalespersonId, actor.userId),
    isNull(leads.archivedAt), notInArray(leads.status, ["closed", "lost"])))
    .orderBy(desc(leads.createdAt), desc(leads.id)));
  const leadEvents = myLeadRows?.length ? await db.select({ id: events.id, leadId: events.leadId,
    title: events.title, startsAt: events.startsAt }).from(events)
    .where(and(inArray(events.leadId, myLeadRows.map((row) => row.id)), isNull(events.archivedAt)))
    .orderBy(desc(events.createdAt), desc(events.id)) : [];
  const latest = new Map<string, (typeof leadEvents)[number]>();
  for (const event of leadEvents) if (event.leadId && !latest.has(event.leadId)) latest.set(event.leadId, event);
  const myLeads = myLeadRows?.map((lead) => ({ ...lead,
    event: latest.get(lead.id)?.title ?? lead.event,
    date: latest.get(lead.id)?.startsAt.toISOString() ?? lead.date })) ?? null;

  const today = utcToBusinessTime(now).date;
  const from = businessTimeToUtc(today, "00:00");
  const until = businessTimeToUtc(addLocalDays(today, 31), "00:00");
  const upcomingEvents = (await db.select({ id: events.id, date: events.startsAt,
    event: events.title, venue: venues.name, guests: events.guestCount })
    .from(events).leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(visibleEvents(actor), isNull(events.archivedAt), gte(events.startsAt, from), lt(events.startsAt, until)))
    .orderBy(asc(events.startsAt))).map((row) => ({ ...row, date: row.date.toISOString() }));

  const workingStaff = (await db.select({ id: users.id, name: users.name,
    position: eventStaffSlots.position, since: eventShifts.startsAt })
    .from(eventStaffSlots).innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .innerJoin(events, eq(events.id, eventShifts.eventId))
    .innerJoin(users, eq(users.id, eventStaffSlots.assigneeId))
    .where(and(visibleEvents(actor), isNull(events.archivedAt), isNull(eventShifts.archivedAt),
      isNull(eventStaffSlots.archivedAt), eq(users.status, "active"),
      lte(eventShifts.startsAt, now), gte(eventShifts.endsAt, now)))
    .orderBy(asc(eventShifts.startsAt))).map((row) => ({ ...row, since: row.since.toISOString() }));

  return { myLeads, upcomingEvents, workingStaff, myTasks, allTasks, roles: [...roles], hideCompletedTasksAfterDays: hideDays };
}
