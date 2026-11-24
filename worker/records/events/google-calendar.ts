import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import { calendarEventStatuses, type CalendarRange } from "../../../shared/calendar";
import { eventStatuses } from "../../../shared/core-records";
import {
  FLOWBASE_CALENDAR_NAME,
  GOOGLE_OVERLAY_CACHE_MS,
  GOOGLE_SYNC_MINUTES,
  googleCalendarScopes,
  type GoogleCalendarStatus,
  type GoogleEvent,
} from "../../../shared/google-calendar";
import { setPolicyMatrix } from "../../../shared/role-permissions";
import { addLocalDays, BUSINESS_TIME_ZONE, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import type { Bindings } from "../../bindings";
import type { Db, DbLike } from "../../db/client";
import { events, googleCalendarConnections, googleCalendarEventLinks, users, venues } from "../../db/schema";
import { decryptToken, encryptToken, fingerprint, signState, verifyState } from "../../google/crypto";
import {
  authorizationUrl,
  createCalendar,
  deleteEvent,
  exchangeCode,
  GoogleApiError,
  GoogleAuthError,
  insertEvent,
  listPrimaryEvents,
  refreshAccessToken,
  revokeToken,
  updateEvent,
  type GoogleClient,
  type GoogleEventResource,
  type PushedEvent,
} from "../../google/calendar-api";
import { ApiError } from "../../hono";
import { enqueueJob, type JobRegistry } from "../../jobs/queue";
import { visibleEvents } from "./events";
import { loadMatrix } from "../settings/permissions";

// Per-user Google Calendar sync (FLOW-268).
//
// Connect: OAuth 2.0 authorization code through the Worker. The state is signed
// with GOOGLE_TOKEN_KEY and names the user, so the callback (a plain browser
// redirect without our bearer token) knows whose account it is. The refresh
// token is stored encrypted and never leaves the Worker (AC4).
//
// Read: the overlay asks Google for the user's primary calendar in the visible
// range and answers only that user; nothing is stored, and responses are cached
// in memory 5 minutes per user and range (AC1).
//
// Write: a "Flowbase events" calendar is created in the user's account on
// connect. A sync job upserts every event the user may see on the Flowbase
// calendar (Negotiation and later, FLOW-265) and removes the ones that left it
// (Lost, deleted, no longer visible). Event changes queue a sync for every
// connected user, and the cron sweep queues one every 15 minutes (AC2).

export const GOOGLE_SYNC_JOB = "google_calendar.sync";
// Events copied: the last 30 days and the next year.
const PAST_DAYS = 30;
const FUTURE_DAYS = 366;
// Google writes per job; a longer backlog continues in a follow-up job, so one
// cron run stays well inside the Worker's subrequest limit.
const WRITES_PER_JOB = 8;

export function googleClient(env: Bindings | undefined): (GoogleClient & { tokenKey: string }) | null {
  if (!env?.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_TOKEN_KEY || !env.APP_URL) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenKey: env.GOOGLE_TOKEN_KEY,
    redirectUri: `${env.APP_URL.replace(/\/$/, "")}/api/google-calendar/callback`,
  };
}
const required = (env: Bindings | undefined) => {
  const client = googleClient(env);
  if (!client) throw new ApiError(503, "GOOGLE_NOT_CONFIGURED", "Google Calendar isn't set up for Flowbase yet.");
  return client;
};

type Connection = typeof googleCalendarConnections.$inferSelect;
const connectionOf = async (db: DbLike, userId: string): Promise<Connection | null> => {
  const [row] = await db
    .select()
    .from(googleCalendarConnections)
    .where(and(eq(googleCalendarConnections.userId, userId), isNull(googleCalendarConnections.archivedAt)));
  return row ?? null;
};

// Short-lived access tokens and overlay responses, per isolate.
const accessTokens = new Map<string, { token: string; until: number }>();
const overlays = new Map<string, { at: number; events: GoogleEvent[] }>();
const forget = (userId: string) => {
  accessTokens.delete(userId);
  for (const key of overlays.keys()) if (key.startsWith(`${userId}:`)) overlays.delete(key);
};
// Tests start each case from a cold isolate.
export const resetGoogleCaches = () => {
  accessTokens.clear();
  overlays.clear();
};

async function markNeedsReconnect(db: DbLike, connection: Connection) {
  forget(connection.userId);
  await db
    .update(googleCalendarConnections)
    .set({ needsReconnectAt: new Date() })
    .where(eq(googleCalendarConnections.id, connection.id));
}

// A working access token, refreshed from the stored refresh token when needed.
// A refused refresh marks the connection for reconnecting and throws 409.
async function accessTokenFor(db: DbLike, client: GoogleClient & { tokenKey: string }, connection: Connection, now = Date.now()) {
  const cached = accessTokens.get(connection.userId);
  if (cached && cached.until > now) return cached.token;
  if (!connection.refreshTokenCipher || connection.needsReconnectAt) throw reconnect();
  const refreshToken = await decryptToken(client.tokenKey, connection.refreshTokenCipher);
  try {
    const tokens = await refreshAccessToken(client, refreshToken);
    // A minute early, so a token never expires mid-request.
    accessTokens.set(connection.userId, { token: tokens.accessToken, until: now + (tokens.expiresIn - 60) * 1000 });
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await markNeedsReconnect(db, connection);
      throw reconnect();
    }
    throw error;
  }
}
const reconnect = () =>
  new ApiError(409, "GOOGLE_RECONNECT", "Google Calendar stopped accepting Flowbase's access. Reconnect Google Calendar.");

export async function googleStatus(db: DbLike, env: Bindings | undefined, actor: Actor): Promise<GoogleCalendarStatus> {
  const connection = await connectionOf(db, actor.userId);
  return {
    configured: googleClient(env) !== null,
    connected: connection !== null,
    needsReconnect: Boolean(connection?.needsReconnectAt),
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
  };
}

// Where "Connect Google Calendar" sends the browser.
export async function startConnect(env: Bindings | undefined, actor: Actor) {
  const client = required(env);
  return { url: authorizationUrl(client, googleCalendarScopes, await signState(client.tokenKey, actor.userId)) };
}

// The OAuth callback: exchange the code, store the refresh token encrypted,
// create the "Flowbase events" calendar and queue the first sync. Answers the
// app path to send the browser back to.
export async function completeConnect(
  db: Db,
  env: Bindings | undefined,
  query: { code?: string; state?: string; error?: string },
): Promise<string> {
  const client = required(env);
  const userId = query.state ? await verifyState(client.tokenKey, query.state) : null;
  if (!userId) return "/#/calendar?google=failed";
  if (query.error || !query.code) return "/#/calendar?google=cancelled";
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active"), isNull(users.archivedAt)));
  if (!user) return "/#/calendar?google=failed";
  const tokens = await exchangeCode(client, query.code);
  if (!tokens.refreshToken) return "/#/calendar?google=failed";
  const existing = await connectionOf(db, userId);
  // Reconnecting keeps the calendar made the first time.
  const calendarId = existing?.calendarId ?? (await createCalendar(tokens.accessToken, FLOWBASE_CALENDAR_NAME, BUSINESS_TIME_ZONE));
  const refreshTokenCipher = await encryptToken(client.tokenKey, tokens.refreshToken);
  await db.transaction(async (tx) => {
    if (existing)
      await tx
        .update(googleCalendarConnections)
        .set({ refreshTokenCipher, calendarId, needsReconnectAt: null, updatedBy: userId })
        .where(eq(googleCalendarConnections.id, existing.id));
    else
      await tx
        .insert(googleCalendarConnections)
        .values({ userId, refreshTokenCipher, calendarId, createdBy: userId, updatedBy: userId });
    await queueSync(tx, userId);
  });
  forget(userId);
  accessTokens.set(userId, { token: tokens.accessToken, until: Date.now() + (tokens.expiresIn - 60) * 1000 });
  return "/#/calendar?google=connected";
}

// Disconnect (AC3): revoke the token at Google, delete it here and stop
// pushing. The "Flowbase events" calendar stays for the user to delete.
export async function disconnect(db: Db, env: Bindings | undefined, actor: Actor) {
  const connection = await connectionOf(db, actor.userId);
  if (!connection) return googleStatus(db, env, actor);
  const client = googleClient(env);
  if (client && connection.refreshTokenCipher) {
    const token = await decryptToken(client.tokenKey, connection.refreshTokenCipher).catch(() => null);
    if (token) await revokeToken(token);
  }
  await db.transaction(async (tx) => {
    await tx
      .update(googleCalendarConnections)
      .set({ refreshTokenCipher: null, archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(googleCalendarConnections.id, connection.id));
    await tx
      .update(googleCalendarEventLinks)
      .set({ archivedAt: new Date() })
      .where(and(eq(googleCalendarEventLinks.connectionId, connection.id), isNull(googleCalendarEventLinks.archivedAt)));
  });
  forget(actor.userId);
  return googleStatus(db, env, actor);
}

const wallClock = (instant: Date) => {
  const { date, time } = utcToBusinessTime(instant);
  return `${date}T${time}`;
};
function toOverlay(item: GoogleEventResource): GoogleEvent | null {
  const allDay = Boolean(item.start?.date);
  const start = item.start?.date ?? (item.start?.dateTime ? wallClock(new Date(item.start.dateTime)) : null);
  if (!start) return null;
  const end = item.end?.date ?? (item.end?.dateTime ? wallClock(new Date(item.end.dateTime)) : null);
  return { id: item.id, title: item.summary || "(No title)", start, end, allDay, htmlLink: item.htmlLink ?? null };
}

// The user's own Google events in the range, for them alone (AC1).
export async function overlayEvents(
  db: DbLike,
  env: Bindings | undefined,
  actor: Actor,
  range: CalendarRange,
  now = Date.now(),
): Promise<GoogleEvent[]> {
  const client = required(env);
  const connection = await connectionOf(db, actor.userId);
  if (!connection) return [];
  if (connection.needsReconnectAt) throw reconnect();
  const key = `${actor.userId}:${range.from}:${range.to}`;
  const cached = overlays.get(key);
  if (cached && now - cached.at < GOOGLE_OVERLAY_CACHE_MS) return cached.events;
  const token = await accessTokenFor(db, client, connection, now);
  const items = await listPrimaryEvents(
    token,
    businessTimeToUtc(range.from, "00:00"),
    businessTimeToUtc(addLocalDays(range.to, 1), "00:00"),
  ).catch(async (error) => {
    if (error instanceof GoogleAuthError) {
      await markNeedsReconnect(db, connection);
      throw reconnect();
    }
    throw error;
  });
  const result = items.map(toOverlay).filter((item): item is GoogleEvent => item !== null);
  overlays.set(key, { at: now, events: result });
  return result;
}

// ---- Push ------------------------------------------------------------------

export function queueSync(db: DbLike, userId: string, now = new Date(), suffix = "") {
  // One sync per user per minute however many changes arrive.
  const bucket = Math.floor(now.getTime() / 60_000);
  return enqueueJob(db, {
    type: GOOGLE_SYNC_JOB,
    payload: { userId },
    idempotencyKey: `${GOOGLE_SYNC_JOB}:${userId}:${bucket}${suffix}`,
  });
}

async function connectedUsers(db: DbLike) {
  return db
    .select({ userId: googleCalendarConnections.userId })
    .from(googleCalendarConnections)
    .where(and(isNull(googleCalendarConnections.archivedAt), isNull(googleCalendarConnections.needsReconnectAt)));
}

// The cron sweep: a sync for every connected user once per 15 minutes.
export async function sweepGoogleCalendars(db: DbLike, now = new Date()) {
  const bucket = Math.floor(now.getTime() / (GOOGLE_SYNC_MINUTES * 60_000));
  let queued = 0;
  for (const { userId } of await connectedUsers(db)) {
    const job = await enqueueJob(db, {
      type: GOOGLE_SYNC_JOB,
      payload: { userId },
      idempotencyKey: `${GOOGLE_SYNC_JOB}:sweep:${userId}:${bucket}`,
    });
    if (job) queued += 1;
  }
  return queued;
}

const appLink = (env: Bindings | undefined, eventId: string) =>
  `${(env?.APP_URL ?? "").replace(/\/$/, "")}/#/events/${eventId}`;

// What Flowbase writes to Google for one event: title, start and end, venue and
// a link back. Without an end time the copy lasts an hour.
function pushedEvent(
  env: Bindings | undefined,
  row: { id: string; title: string; startsAt: Date; endsAt: Date | null; venueName: string | null },
): PushedEvent {
  const end = row.endsAt ?? new Date(row.startsAt.getTime() + 60 * 60_000);
  return {
    summary: row.title,
    ...(row.venueName ? { location: row.venueName } : {}),
    description: `Open in Flowbase: ${appLink(env, row.id)}`,
    start: { dateTime: row.startsAt.toISOString(), timeZone: BUSINESS_TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: BUSINESS_TIME_ZONE },
    extendedProperties: { private: { flowbaseEventId: row.id } },
  };
}

export type SyncResult = { upserted: number; removed: number; more: boolean };

// Brings one user's "Flowbase events" calendar in line with what they may see.
export async function syncUserCalendar(db: Db, env: Bindings | undefined, userId: string, now = new Date()): Promise<SyncResult> {
  const result: SyncResult = { upserted: 0, removed: 0, more: false };
  const client = googleClient(env);
  const connection = await connectionOf(db, userId);
  if (!client || !connection?.calendarId || connection.needsReconnectAt) return result;
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active"), isNull(users.archivedAt)));
  // The matrix decides what this person may see, as on a request.
  setPolicyMatrix(await loadMatrix(db));
  const actor: Actor | null = user ? { userId: user.id, role: user.role } : null;
  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + FUTURE_DAYS * 86_400_000);
  const shown = actor
    ? await db
        .select({ id: events.id, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, venueName: venues.name })
        .from(events)
        .leftJoin(venues, eq(venues.id, events.venueId))
        .where(
          and(
            isNull(events.archivedAt),
            visibleEvents(actor),
            inArray(events.status, [...calendarEventStatuses]),
            gte(events.startsAt, from),
            lte(events.startsAt, to),
          ),
        )
        .orderBy(asc(events.startsAt))
    : [];
  const links = await db
    .select()
    .from(googleCalendarEventLinks)
    .where(and(eq(googleCalendarEventLinks.connectionId, connection.id), isNull(googleCalendarEventLinks.archivedAt)));
  const linkOf = new Map(links.map((link) => [link.eventId, link]));
  const wanted = new Set(shown.map((row) => row.id));
  let writes = 0;
  const token = async () => {
    try {
      return await accessTokenFor(db, client, connection, now.getTime());
    } catch (error) {
      if (error instanceof ApiError && error.code === "GOOGLE_RECONNECT") return null;
      throw error;
    }
  };
  const calendarId = connection.calendarId;
  for (const row of shown) {
    const event = pushedEvent(env, row);
    const print = await fingerprint(event);
    const link = linkOf.get(row.id);
    if (link?.fingerprint === print) continue;
    if (writes >= WRITES_PER_JOB) {
      result.more = true;
      break;
    }
    const access = await token();
    if (!access) return result;
    writes += 1;
    if (link) {
      try {
        await updateEvent(access, calendarId, link.googleEventId, event);
        await db.update(googleCalendarEventLinks).set({ fingerprint: print }).where(eq(googleCalendarEventLinks.id, link.id));
      } catch (error) {
        // The user deleted the copy in Google: make a new one.
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
        const googleEventId = await insertEvent(access, calendarId, event);
        await db.update(googleCalendarEventLinks).set({ googleEventId, fingerprint: print }).where(eq(googleCalendarEventLinks.id, link.id));
      }
    } else {
      const googleEventId = await insertEvent(access, calendarId, event);
      await db.insert(googleCalendarEventLinks).values({ connectionId: connection.id, eventId: row.id, googleEventId, fingerprint: print });
    }
    result.upserted += 1;
  }
  // Events that left the user's calendar (Lost, deleted, no longer theirs, or
  // out of the window) are removed from Google.
  for (const link of links) {
    if (wanted.has(link.eventId)) continue;
    if (writes >= WRITES_PER_JOB) {
      result.more = true;
      break;
    }
    const access = await token();
    if (!access) return result;
    writes += 1;
    await deleteEvent(access, calendarId, link.googleEventId);
    await db.update(googleCalendarEventLinks).set({ archivedAt: new Date() }).where(eq(googleCalendarEventLinks.id, link.id));
    result.removed += 1;
  }
  await db
    .update(googleCalendarConnections)
    .set({ lastSyncedAt: now })
    .where(eq(googleCalendarConnections.id, connection.id));
  if (result.more) await queueSync(db, userId, now, `:more:${crypto.randomUUID()}`);
  return result;
}

// Changes to any event queue a sync for everyone connected; each sync works out
// what that person sees.
const eventChanges = ["event.created", "event.updated", ...eventStatuses.map((status) => `event.${status}`)];

export function registerGoogleCalendar(registry: JobRegistry) {
  registry.register(GOOGLE_SYNC_JOB, async (job, { db, env }) => {
    const userId = (job.payload as { userId?: unknown } | null)?.userId;
    if (typeof userId === "string") await syncUserCalendar(db, env, userId);
  });
  for (const name of eventChanges)
    registry.register(`event:${name}`, async (_job, { db }) => {
      for (const { userId } of await connectedUsers(db)) await queueSync(db, userId);
    });
  return registry;
}
