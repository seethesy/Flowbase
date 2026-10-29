import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import type {
  activitySessionInputSchema,
  TimeReport,
} from "../../shared/time-tracking";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { Db } from "../db/client";
import {
  activitySessions,
  clients,
  events,
  leads,
  proposals,
  tasks,
  users,
} from "../db/schema";
import { ApiError } from "../hono";
import { can, timeReportScope } from "../policy";
import { visibleEvents } from "./events";
import { visibleClients } from "./clients";
import { visibleLeads } from "./leads";
import { visibleTasks } from "./tasks";

// Automatic activity time tracking (FLOW-119). Sessions are always the caller's own:
// the user comes from the sign-in, never from the request body.
type SessionInput = z.output<typeof activitySessionInputSchema>;

// Allows for a browser clock running a little ahead of the Worker's.
const CLOCK_SKEW_MS = 5 * 60_000;

export async function recordSessions(
  db: Db,
  actor: Actor,
  input: SessionInput[],
): Promise<{ recorded: number }> {
  const latest = Date.now() + CLOCK_SKEW_MS;
  if (input.some((session) => Date.parse(session.endedAt) > latest))
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "A session can't end in the future.",
    );
  // One row per session id; a batch may carry the same open session twice.
  const byId = new Map<string, SessionInput>();
  for (const session of input) {
    const seen = byId.get(session.id);
    if (!seen || Date.parse(session.endedAt) > Date.parse(seen.endedAt))
      byId.set(session.id, session);
  }
  const sessions = [...byId.values()];
  const recordIds = (type: NonNullable<SessionInput["recordType"]>) =>
    [...new Set(sessions.filter((s) => s.recordType === type).map((s) => s.recordId!))];
  const types = ["lead", "client", "event", "proposal", "task", "beo"] as const;
  const found = await Promise.all(types.map(async (type) => {
    const ids = recordIds(type);
    if (!ids.length) return [] as string[];
    if (type === "beo") return [] as string[];
    if (type === "lead") return (await db.select({ id: leads.id }).from(leads)
      .where(and(inArray(leads.id, ids), isNull(leads.archivedAt), visibleLeads(actor)))).map((r) => r.id);
    if (type === "client") return (await db.select({ id: clients.id }).from(clients)
      .where(and(inArray(clients.id, ids), isNull(clients.archivedAt), visibleClients(actor)))).map((r) => r.id);
    if (type === "event") return (await db.select({ id: events.id }).from(events)
      .where(and(inArray(events.id, ids), isNull(events.archivedAt), visibleEvents(actor)))).map((r) => r.id);
    if (type === "task") return (await db.select({ id: tasks.id }).from(tasks)
      .where(and(inArray(tasks.id, ids), isNull(tasks.archivedAt), visibleTasks(actor)))).map((r) => r.id);
    return (await db.select({ id: proposals.id }).from(proposals)
      .innerJoin(events, eq(proposals.eventId, events.id))
      .where(and(inArray(proposals.id, ids), isNull(proposals.archivedAt), isNull(events.archivedAt), visibleEvents(actor)))).map((r) => r.id);
  }));
  if (types.some((type, index) => recordIds(type).some((id) => !found[index].includes(id))))
    throw new ApiError(400, "INVALID_REQUEST", "A session refers to a record you can't access.");
  await db
    .insert(activitySessions)
    .values(
      sessions.map((session) => ({
        userId: actor.userId,
        clientSessionId: session.id,
        startedAt: new Date(session.startedAt),
        endedAt: new Date(session.endedAt),
        recordType: session.recordType,
        recordId: session.recordId,
        activity: session.activity,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    )
    // A resent open session only ever grows; its start, record and activity stay.
    .onConflictDoUpdate({
      target: [activitySessions.userId, activitySessions.clientSessionId],
      set: {
        endedAt: sql`greatest(${activitySessions.endedAt}, excluded.ended_at)`,
        updatedBy: actor.userId,
      },
    });
  return { recorded: sessions.length };
}

const seconds = sql<number>`coalesce(sum(extract(epoch from (${activitySessions.endedAt} - ${activitySessions.startedAt}))), 0)::int`;

// The record a session was credited to, when it's that kind of record.
const onRecord = (type: "proposal" | "task", id: AnyPgColumn) =>
  and(eq(activitySessions.recordType, type), eq(activitySessions.recordId, id));

// Effort per booking (time per event, counting its proposals and tasks), time per
// proposal (FLOW-167) and workload (time per user and activity type) for sessions
// that started between two New York dates, inclusive.
export async function timeReport(
  db: Db,
  actor: Actor,
  filter: { from: string; to: string; userId?: string },
): Promise<TimeReport> {
  const scope = timeReportScope(actor);
  const userId = scope === "all" ? filter.userId : actor.userId;
  const where = and(
    isNull(activitySessions.archivedAt),
    gte(activitySessions.startedAt, businessTimeToUtc(filter.from, "00:00")),
    lt(activitySessions.startedAt, businessTimeToUtc(addLocalDays(filter.to, 1), "00:00")),
    userId ? eq(activitySessions.userId, userId) : undefined,
  );
  const people = sql<number>`count(distinct ${activitySessions.userId})::int`;
  const [effort, proposalEffort, workload] = await Promise.all([
    db
      .select({
        eventId: events.id,
        title: events.title,
        startsAt: events.startsAt,
        clientName: clients.name,
        seconds,
        people,
      })
      .from(activitySessions)
      .leftJoin(proposals, onRecord("proposal", proposals.id))
      .leftJoin(tasks, onRecord("task", tasks.id))
      .innerJoin(
        events,
        sql`${events.id} = case ${activitySessions.recordType}
          when 'event' then ${activitySessions.recordId}
          when 'proposal' then ${proposals.eventId}
          when 'task' then ${tasks.eventId} end`,
      )
      .innerJoin(clients, eq(clients.id, events.clientId))
      // An event the viewer can no longer see drops out of their report.
      .where(and(where, visibleEvents(actor)))
      .groupBy(events.id, events.title, events.startsAt, clients.name)
      .orderBy(desc(seconds), events.title)
      .limit(500),
    // Proposals stay hidden from roles that can't read them (FLOW-122).
    can(actor, "proposals.read")
      ? db
          .select({
            proposalId: proposals.id,
            title: proposals.title,
            eventId: events.id,
            eventTitle: events.title,
            seconds,
            people,
          })
          .from(activitySessions)
          .innerJoin(proposals, onRecord("proposal", proposals.id))
          .innerJoin(events, eq(events.id, proposals.eventId))
          .where(and(where, isNull(proposals.archivedAt), visibleEvents(actor)))
          .groupBy(proposals.id, proposals.title, events.id, events.title)
          .orderBy(desc(seconds), proposals.title)
          .limit(500)
      : [],
    db
      .select({
        userId: activitySessions.userId,
        userName: sql<string>`coalesce(nullif(${users.name}, ''), ${users.email}, ${activitySessions.userId}::text)`,
        activity: activitySessions.activity,
        seconds,
      })
      .from(activitySessions)
      .leftJoin(users, eq(users.id, activitySessions.userId))
      .where(where)
      .groupBy(
        activitySessions.userId,
        activitySessions.activity,
        users.name,
        users.email,
      )
      .orderBy(activitySessions.userId, desc(seconds)),
  ]);
  return {
    scope,
    effort: effort.map(({ startsAt, ...row }) => ({
      ...row,
      date: utcToBusinessTime(startsAt).date,
    })),
    proposals: proposalEffort,
    workload: workload as TimeReport["workload"],
  };
}
