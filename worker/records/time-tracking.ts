import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import type {
  activitySessionInputSchema,
  TimeReport,
} from "../../shared/time-tracking";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { Db } from "../db/client";
import { activitySessions, clients, events, users } from "../db/schema";
import { ApiError } from "../hono";
import { timeReportScope } from "../policy";
import { visibleEvents } from "./events";

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

// Effort per booking (time per event) and workload (time per user and activity type)
// for sessions that started between two New York dates, inclusive.
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
  const [effort, workload] = await Promise.all([
    db
      .select({
        eventId: events.id,
        title: events.title,
        startsAt: events.startsAt,
        clientName: clients.name,
        seconds,
        people: sql<number>`count(distinct ${activitySessions.userId})::int`,
      })
      .from(activitySessions)
      .innerJoin(
        events,
        and(
          eq(activitySessions.recordType, "event"),
          eq(activitySessions.recordId, events.id),
        ),
      )
      .innerJoin(clients, eq(clients.id, events.clientId))
      // An event the viewer can no longer see drops out of their report.
      .where(and(where, visibleEvents(actor)))
      .groupBy(events.id, events.title, events.startsAt, clients.name)
      .orderBy(desc(seconds), events.title)
      .limit(500),
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
    workload: workload as TimeReport["workload"],
  };
}
