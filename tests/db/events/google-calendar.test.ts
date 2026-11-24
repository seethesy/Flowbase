import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Actor } from "../../../shared/access";
import type { EventStatus } from "../../../shared/core-records";
import type { GoogleCalendarStatus, GoogleEvents } from "../../../shared/google-calendar";
import { googleCalendarScopes } from "../../../shared/google-calendar";
import { setGoogleFetch } from "../../../worker/google/calendar-api";
import { decryptToken } from "../../../worker/google/crypto";
import { createJobRegistry } from "../../../worker/jobs/cron";
import {
  GOOGLE_SYNC_JOB,
  resetGoogleCaches,
  sweepGoogleCalendars,
  syncUserCalendar,
} from "../../../worker/records/events/google-calendar";
import { setPolicyMatrix } from "../../../shared/role-permissions";

// Per-user Google Calendar sync (FLOW-268) against Postgres and a fake Google:
// connect, overlay scoping (AC1), upsert and delete (AC2), disconnect (AC3),
// encrypted tokens never sent to the browser (AC4) and a refused refresh.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const tokenKey = btoa("0123456789abcdef0123456789abcdef");
const env = {
  ASSETS: { fetch },
  APP_URL: "https://flowbase.example",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_TOKEN_KEY: tokenKey,
};

const people = {
  sam: "c6800000-0000-4000-8000-000000000001",
  sue: "c6800000-0000-4000-8000-000000000002",
};
type Who = keyof typeof people;
const actorOf = (who: Who): Actor => ({ userId: people[who], role: "salesperson" });
const signedInAs = (who: Who, bindings: Record<string, unknown> = env) => {
  const app = createApp({ withDb, resolveActor: async () => actorOf(who) });
  const call = (method: string, path: string) => app.request(path, { method }, bindings);
  const send = async <T>(method: string, path: string, status = 200) => {
    const response = await call(method, path);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { app, call, send };
};
// The callback is Google's redirect: no Flowbase sign-in.
const anonymous = createApp({ withDb, resolveActor: async () => null });

// ---- Fake Google -----------------------------------------------------------
type Stored = { id: string; body: Record<string, unknown> };
let google: {
  // Who each code, refresh token and access token belongs to.
  codes: Map<string, Who>;
  refreshRefused: Set<Who>;
  calendars: Map<string, Who>;
  events: Map<string, Map<string, Stored>>;
  primary: Record<Who, unknown[]>;
  revoked: string[];
  calls: string[];
};
let counter = 0;
const ownerOfAccess = (header: string | null) => {
  const match = /^Bearer access-(sam|sue)-\d+$/.exec(header ?? "");
  return (match?.[1] as Who | undefined) ?? null;
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeGoogle = async (input: string, init: RequestInit = {}) => {
  const method = init.method ?? "GET";
  const target = new URL(input);
  google.calls.push(`${method} ${target.pathname}`);
  if (target.href.startsWith("https://oauth2.googleapis.com/token")) {
    const form = new URLSearchParams(String(init.body));
    if (form.get("grant_type") === "authorization_code") {
      const who = google.codes.get(form.get("code") ?? "");
      if (!who) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: `access-${who}-${++counter}`, expires_in: 3600, refresh_token: `refresh-${who}` });
    }
    const who = /^refresh-(sam|sue)$/.exec(form.get("refresh_token") ?? "")?.[1] as Who | undefined;
    if (!who || google.refreshRefused.has(who)) return json(400, { error: "invalid_grant" });
    return json(200, { access_token: `access-${who}-${++counter}`, expires_in: 3600 });
  }
  if (target.href.startsWith("https://oauth2.googleapis.com/revoke")) {
    google.revoked.push(new URLSearchParams(String(init.body)).get("token") ?? "");
    return new Response(null, { status: 200 });
  }
  const who = ownerOfAccess(new Headers(init.headers).get("Authorization"));
  if (!who) return json(401, { error: { message: "unauthorized" } });
  const path = target.pathname.replace("/calendar/v3", "");
  if (path === "/calendars" && method === "POST") {
    const id = `cal-${who}-${++counter}`;
    google.calendars.set(id, who);
    google.events.set(id, new Map());
    return json(200, { id });
  }
  if (path === "/calendars/primary/events") return json(200, { items: google.primary[who] });
  const match = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
  if (match) {
    const calendarId = decodeURIComponent(match[1]);
    if (google.calendars.get(calendarId) !== who) return json(404, { error: { message: "not found" } });
    const store = google.events.get(calendarId)!;
    const eventId = match[2] ? decodeURIComponent(match[2]) : null;
    if (method === "POST") {
      const id = `g${++counter}`;
      store.set(id, { id, body: JSON.parse(String(init.body)) });
      return json(200, { id });
    }
    if (!eventId || !store.has(eventId)) return json(404, { error: { message: "not found" } });
    if (method === "PUT") {
      store.set(eventId, { id: eventId, body: JSON.parse(String(init.body)) });
      return json(200, { id: eventId });
    }
    if (method === "DELETE") {
      store.delete(eventId);
      return new Response(null, { status: 204 });
    }
  }
  return json(404, { error: { message: `unexpected ${method} ${path}` } });
};

const copiesOf = (who: Who) =>
  [...google.calendars].filter(([, owner]) => owner === who).flatMap(([id]) => [...google.events.get(id)!.values()]);

// ---- Data ------------------------------------------------------------------
const tables = sql`truncate table google_calendar_event_links, google_calendar_connections, events, jobs cascade`;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
async function event(title: string, status: EventStatus, owner: Who, days = 7) {
  const [row] = await db
    .insert(schema.events)
    .values({ title, status, assignedSalespersonId: people[owner], startsAt: inDays(days), endsAt: new Date(inDays(days).getTime() + 3 * 3_600_000) })
    .returning();
  return row;
}

async function connect(who: Who) {
  const { url: consent } = await signedInAs(who).send<{ url: string }>("POST", "/api/google-calendar/connect");
  const consentUrl = new URL(consent);
  expect(consentUrl.origin).toBe("https://accounts.google.com");
  expect(consentUrl.searchParams.get("scope")).toBe(googleCalendarScopes.join(" "));
  expect(consentUrl.searchParams.get("redirect_uri")).toBe("https://flowbase.example/api/google-calendar/callback");
  const code = `code-${who}-${++counter}`;
  google.codes.set(code, who);
  const response = await anonymous.request(
    `/api/google-calendar/callback?code=${code}&state=${encodeURIComponent(consentUrl.searchParams.get("state")!)}`,
    {},
    env,
  );
  expect(response.status).toBe(302);
  return response.headers.get("Location");
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db
    .insert(schema.users)
    .values(
      (Object.keys(people) as Who[]).map((who, i) => ({
        id: people[who],
        email: `${who}@google-calendar.example`,
        name: who[0].toUpperCase() + who.slice(1),
        role: "salesperson" as const,
        mobile: `20255596${i}`,
        status: "active" as const,
      })),
    )
    .onConflictDoNothing({ target: schema.users.id });
});
beforeEach(async () => {
  await db.execute(tables);
  resetGoogleCaches();
  setPolicyMatrix(null);
  google = {
    codes: new Map(),
    refreshRefused: new Set(),
    calendars: new Map(),
    events: new Map(),
    primary: {
      sam: [
        { id: "p1", summary: "Dentist", htmlLink: "https://calendar.google.com/event?eid=p1", start: { dateTime: "2026-12-02T15:00:00Z" }, end: { dateTime: "2026-12-02T16:00:00Z" } },
        { id: "p2", summary: "Vacation", start: { date: "2026-12-10" }, end: { date: "2026-12-12" } },
        { id: "p3", status: "cancelled", summary: "Gone", start: { date: "2026-12-11" }, end: { date: "2026-12-12" } },
      ],
      sue: [{ id: "q1", summary: "Sue's yoga", start: { dateTime: "2026-12-03T23:00:00Z" }, end: { dateTime: "2026-12-04T00:00:00Z" } }],
    },
    revoked: [],
    calls: [],
  };
  setGoogleFetch(fakeGoogle);
});
afterEach(() => setGoogleFetch(null));
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.users).where(inArray(schema.users.id, Object.values(people)));
  setPolicyMatrix(null);
  await client.end();
});

describe("Google Calendar sync (FLOW-268)", () => {
  it("reports not configured until the Google secrets are set", async () => {
    const status = await signedInAs("sam", { ASSETS: { fetch } }).send<GoogleCalendarStatus>("GET", "/api/google-calendar");
    expect(status).toEqual({ configured: false, connected: false, needsReconnect: false, lastSyncedAt: null });
    await signedInAs("sam", { ASSETS: { fetch } }).send("POST", "/api/google-calendar/connect", 503);
  });

  it("connects through Google, stores the refresh token encrypted and never returns it (AC4)", async () => {
    expect(await connect("sam")).toBe("https://flowbase.example/#/calendar?google=connected");
    const [row] = await db
      .select()
      .from(schema.googleCalendarConnections)
      .where(eq(schema.googleCalendarConnections.userId, people.sam));
    expect(row.refreshTokenCipher).toBeTruthy();
    expect(row.refreshTokenCipher).not.toContain("refresh-sam");
    expect(await decryptToken(tokenKey, row.refreshTokenCipher!)).toBe("refresh-sam");
    // The "Flowbase events" calendar is made in Sam's account and a sync queued.
    expect(google.calls).toContain("POST /calendar/v3/calendars");
    expect(google.calendars.get(row.calendarId!)).toBe("sam");
    const queued = await db.select().from(schema.jobs).where(eq(schema.jobs.type, GOOGLE_SYNC_JOB));
    expect(queued.map((job) => job.payload)).toEqual([{ userId: people.sam }]);

    const response = await signedInAs("sam").call("GET", "/api/google-calendar");
    const text = await response.text();
    expect(text).not.toContain("refresh-sam");
    expect(text).not.toContain(row.refreshTokenCipher!);
    expect(JSON.parse(text)).toMatchObject({ configured: true, connected: true, needsReconnect: false });
  });

  it("refuses a forged or missing state", async () => {
    const forged = await anonymous.request("/api/google-calendar/callback?code=x&state=bad.state", {}, env);
    expect(forged.headers.get("Location")).toBe("https://flowbase.example/#/calendar?google=failed");
    const cancelled = await signedInAs("sam").send<{ url: string }>("POST", "/api/google-calendar/connect");
    const state = new URL(cancelled.url).searchParams.get("state")!;
    const denied = await anonymous.request(`/api/google-calendar/callback?error=access_denied&state=${encodeURIComponent(state)}`, {}, env);
    expect(denied.headers.get("Location")).toBe("https://flowbase.example/#/calendar?google=cancelled");
    expect(await db.select().from(schema.googleCalendarConnections)).toHaveLength(0);
  });

  it("shows each person only their own Google events (AC1)", async () => {
    await connect("sam");
    const range = "/api/google-calendar/events?from=2026-11-29&to=2026-12-31";
    const sams = await signedInAs("sam").send<GoogleEvents>("GET", range);
    expect(sams.events).toEqual([
      { id: "p1", title: "Dentist", start: "2026-12-02T10:00", end: "2026-12-02T11:00", allDay: false, htmlLink: "https://calendar.google.com/event?eid=p1" },
      { id: "p2", title: "Vacation", start: "2026-12-10", end: "2026-12-12", allDay: true, htmlLink: null },
    ]);
    // Sue hasn't connected: nothing, and never Sam's.
    expect((await signedInAs("sue").send<GoogleEvents>("GET", range)).events).toEqual([]);
    await connect("sue");
    const sues = await signedInAs("sue").send<GoogleEvents>("GET", range);
    expect(sues.events.map((entry) => entry.title)).toEqual(["Sue's yoga"]);
    // Cached for five minutes per user and range: no second call to Google.
    const lists = google.calls.filter((call) => call.endsWith("/primary/events")).length;
    await signedInAs("sam").send<GoogleEvents>("GET", range);
    expect(google.calls.filter((call) => call.endsWith("/primary/events")).length).toBe(lists);
  });

  it("copies the events the person sees, updates changes and removes Lost events (AC2)", async () => {
    await connect("sam");
    const gala = await event("Gala", "negotiation", "sam");
    const brunch = await event("Brunch", "closed", "sam", 20);
    await event("Inquiry only", "inquiry", "sam");
    await event("Sue's party", "closed", "sue");
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 2, removed: 0, more: false });
    const copies = copiesOf("sam");
    expect(copies.map((copy) => copy.body.summary).sort()).toEqual(["Brunch", "Gala"]);
    expect(copies.find((copy) => copy.body.summary === "Gala")!.body).toMatchObject({
      description: `Open in Flowbase: https://flowbase.example/#/events/${gala.id}`,
      extendedProperties: { private: { flowbaseEventId: gala.id } },
    });

    // Nothing changed: nothing sent.
    const before = google.calls.length;
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 0, removed: 0, more: false });
    expect(google.calls.slice(before).filter((call) => call.includes("/events"))).toEqual([]);

    await db.update(schema.events).set({ title: "Winter Gala" }).where(eq(schema.events.id, gala.id));
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 1, removed: 0, more: false });
    expect(copiesOf("sam").map((copy) => copy.body.summary).sort()).toEqual(["Brunch", "Winter Gala"]);

    // Lost, or deleted in Flowbase: removed from Google.
    await db.update(schema.events).set({ status: "lost" }).where(eq(schema.events.id, gala.id));
    await db.update(schema.events).set({ archivedAt: new Date() }).where(eq(schema.events.id, brunch.id));
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 0, removed: 2, more: false });
    expect(copiesOf("sam")).toEqual([]);
    const [connection] = await db.select().from(schema.googleCalendarConnections);
    expect(connection.lastSyncedAt).not.toBeNull();
  });

  it("makes a new copy when the person deleted one in Google", async () => {
    await connect("sam");
    const gala = await event("Gala", "closing", "sam");
    await syncUserCalendar(db, env, people.sam);
    for (const store of google.events.values()) store.clear();
    await db.update(schema.events).set({ title: "Gala (moved)" }).where(eq(schema.events.id, gala.id));
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 1, removed: 0, more: false });
    expect(copiesOf("sam").map((copy) => copy.body.summary)).toEqual(["Gala (moved)"]);
  });

  it("writes a long backlog across follow-up jobs", async () => {
    await connect("sam");
    for (let i = 0; i < 11; i += 1) await event(`Event ${i}`, "closed", "sam", i + 1);
    await db.delete(schema.jobs);
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 8, removed: 0, more: true });
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.type, GOOGLE_SYNC_JOB))).toHaveLength(1);
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 3, removed: 0, more: false });
    expect(copiesOf("sam")).toHaveLength(11);
  });

  it("asks to reconnect when Google refuses the refresh token", async () => {
    await connect("sam");
    resetGoogleCaches();
    google.refreshRefused.add("sam");
    const response = await signedInAs("sam").call("GET", "/api/google-calendar/events?from=2026-11-29&to=2026-12-31");
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("GOOGLE_RECONNECT");
    expect((await signedInAs("sam").send<GoogleCalendarStatus>("GET", "/api/google-calendar")).needsReconnect).toBe(true);
    await event("Gala", "closed", "sam");
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 0, removed: 0, more: false });
    // The sweep skips connections that need reconnecting; reconnecting clears it.
    expect(await sweepGoogleCalendars(db)).toBe(0);
    google.refreshRefused.delete("sam");
    await connect("sam");
    expect((await signedInAs("sam").send<GoogleCalendarStatus>("GET", "/api/google-calendar")).needsReconnect).toBe(false);
    expect(await db.select().from(schema.googleCalendarConnections)).toHaveLength(1);
  });

  it("disconnect revokes access, stops pushing and leaves the calendar (AC3)", async () => {
    await connect("sam");
    await event("Gala", "closed", "sam");
    await syncUserCalendar(db, env, people.sam);
    const status = await signedInAs("sam").send<GoogleCalendarStatus>("DELETE", "/api/google-calendar");
    expect(status).toMatchObject({ connected: false });
    expect(google.revoked).toEqual(["refresh-sam"]);
    const [row] = await db.select().from(schema.googleCalendarConnections);
    expect(row.refreshTokenCipher).toBeNull();
    expect(row.archivedAt).not.toBeNull();
    expect(google.calls.some((call) => call.startsWith("DELETE /calendar/v3/calendars/") && !call.includes("/events"))).toBe(false);
    expect(copiesOf("sam")).toHaveLength(1);

    await event("Brunch", "closed", "sam");
    expect(await syncUserCalendar(db, env, people.sam)).toEqual({ upserted: 0, removed: 0, more: false });
    expect((await signedInAs("sam").send<GoogleEvents>("GET", "/api/google-calendar/events?from=2026-11-29&to=2026-12-31")).events).toEqual([]);
    const links = await db
      .select()
      .from(schema.googleCalendarEventLinks)
      .where(isNull(schema.googleCalendarEventLinks.archivedAt));
    expect(links).toEqual([]);
  });

  it("queues a sync per connected user every 15 minutes and on event changes", async () => {
    expect(() => createJobRegistry()).not.toThrow();
    await connect("sam");
    await connect("sue");
    await db.delete(schema.jobs);
    const now = new Date("2026-11-23T15:01:00Z");
    expect(await sweepGoogleCalendars(db, now)).toBe(2);
    expect(await sweepGoogleCalendars(db, new Date("2026-11-23T15:14:00Z"))).toBe(0);
    expect(await sweepGoogleCalendars(db, new Date("2026-11-23T15:16:00Z"))).toBe(2);

    await db.delete(schema.jobs);
    const registry = createJobRegistry();
    const handler = registry.get("event:event.closed")!;
    await handler({ id: crypto.randomUUID(), type: "event:event.closed", payload: {} } as never, { db, env });
    const queued = await db
      .select({ payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.type, GOOGLE_SYNC_JOB)));
    expect(queued.map((job) => (job.payload as { userId: string }).userId).sort()).toEqual([people.sam, people.sue].sort());
  });
});
