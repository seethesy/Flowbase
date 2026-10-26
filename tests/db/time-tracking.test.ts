import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { activitySessions } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { Client, EventInput, FlowEvent } from "../../shared/core-records";
import type { EventHub } from "../../shared/event-hub";
import type { TimeReport } from "../../shared/time-tracking";
import { utcToBusinessTime } from "../../shared/time";

// The event hub (FLOW-57) and activity time tracking (FLOW-119) against Postgres.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "a0000000-0000-4000-8000-000000000001",
  manager: "a0000000-0000-4000-8000-000000000002",
  sam: "a0000000-0000-4000-8000-000000000003",
  sue: "a0000000-0000-4000-8000-000000000004",
  helper: "a0000000-0000-4000-8000-000000000006",
};
const signedInAs = (
  userId: string,
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = { userId, role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
  return {
    call,
    get: async <T>(path: string) => {
      const response = await call("GET", path);
      expect(response.status).toBe(200);
      return (await response.json()) as T;
    },
    post: async <T>(path: string, body: unknown, status = 201) => {
      const response = await call("POST", path, body);
      expect(response.status).toBe(status);
      return (await response.json()) as T;
    },
  };
};
const admin = signedInAs(people.admin, "admin");
const manager = signedInAs(people.manager, "sales_manager");
const sam = signedInAs(people.sam, "salesperson");
const partTimeSam = signedInAs(people.sam, "salesperson", "part_time");
const sue = signedInAs(people.sue, "salesperson");
const helper = signedInAs(people.helper, "staff", "part_time");

// Juniper belongs to Sam; the gala is Sam's, with the helper assisting.
async function seed() {
  const juniper = await admin.post<Client>("/api/clients", {
    name: "Juniper & Co.",
    kind: "organization",
    assignedSalespersonId: people.sam,
    contacts: [
      {
        name: "Olivia Bennett",
        role: "primary_poc",
        email: "olivia@juniper.example",
        phone: "(202) 555-0101",
      },
    ],
  });
  const event = (title: string, overrides: Partial<EventInput> = {}) =>
    admin.post<FlowEvent>("/api/events", {
      title,
      date: "2026-11-14",
      startTime: "18:00",
      clientId: juniper.id,
      assignedSalespersonId: people.sam,
      assistantLeadIds: [people.helper],
      ...overrides,
    });
  return {
    juniper,
    gala: await event("Fall gala"),
    brunch: await event("Board brunch", {
      assignedSalespersonId: people.sue,
      assistantLeadIds: [],
    }),
  };
}

const MIN = 60_000;
// One fixed "now" so session lengths are exact.
const base = Date.now();
const ago = (minutes: number) => new Date(base - minutes * MIN).toISOString();
let ids = 0;
const sessionId = () =>
  `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const onEvent = (
  eventId: string,
  from: number,
  to: number,
  id = sessionId(),
) => ({
  id,
  startedAt: ago(from),
  endedAt: ago(to),
  recordType: "event",
  recordId: eventId,
  activity: "event_planning",
});
// Yesterday to today, so sessions from just before midnight still count.
const range = `?from=${utcToBusinessTime(new Date(base - 24 * 60 * MIN)).date}&to=${utcToBusinessTime(new Date(base)).date}`;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table activity_sessions, lead_duplicates, leads, audit_log, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("event hub", () => {
  // AC1
  it("loads the details, client and files sections for Admin", async () => {
    const { gala, juniper } = await seed();
    const hub = await admin.get<EventHub>(`/api/events/${gala.id}/hub`);
    expect(hub.sections).toEqual(["details", "client", "files"]);
    expect(hub.event.title).toBe("Fall gala");
    expect(hub.client?.id).toBe(juniper.id);
    expect(hub.client?.contacts[0].email).toBe("olivia@juniper.example");
    expect(hub.canEdit).toBe(true);
  });

  // AC2
  it("hides contact details from a part-time salesperson", async () => {
    const { gala } = await seed();
    const hub = await partTimeSam.get<EventHub>(`/api/events/${gala.id}/hub`);
    expect(hub.sections).toEqual(["details", "client", "files"]);
    expect(hub.client?.contacts[0]).toMatchObject({
      name: "Olivia Bennett",
      email: null,
      phone: null,
    });
  });

  // AC2
  it("shows part-time staff only the event, without the client or editing", async () => {
    const { gala, brunch } = await seed();
    const hub = await helper.get<EventHub>(`/api/events/${gala.id}/hub`);
    expect(hub.sections).toEqual(["details", "files"]);
    expect(hub.client).toBeNull();
    expect(hub.event.client.name).toBe("Juniper & Co.");
    expect(hub.canEdit).toBe(false);
    expect(
      (await helper.call("GET", `/api/events/${brunch.id}/hub`)).status,
    ).toBe(404);
  });

  it("drops the client section when the salesperson can't see the client", async () => {
    const { brunch } = await seed();
    const hub = await sue.get<EventHub>(`/api/events/${brunch.id}/hub`);
    expect(hub.sections).toEqual(["details", "files"]);
    expect(hub.client).toBeNull();
    expect(hub.canEdit).toBe(true);
  });

  it("answers 404 for an event the user can't see", async () => {
    const { gala } = await seed();
    expect((await sue.call("GET", `/api/events/${gala.id}/hub`)).status).toBe(
      404,
    );
  });
});

describe("time tracking", () => {
  it("keeps one row per session, which only grows when resent", async () => {
    const { gala } = await seed();
    const id = sessionId();
    await sam.post(
      "/api/time/sessions",
      { sessions: [onEvent(gala.id, 10, 8, id)] },
      200,
    );
    await sam.post(
      "/api/time/sessions",
      // The same open session twice in one batch, then an older copy.
      { sessions: [onEvent(gala.id, 10, 6, id), onEvent(gala.id, 10, 5, id)] },
      200,
    );
    await sam.post(
      "/api/time/sessions",
      { sessions: [onEvent(gala.id, 10, 9, id)] },
      200,
    );
    const rows = await db.select().from(activitySessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: people.sam,
      recordType: "event",
      recordId: gala.id,
      activity: "event_planning",
      createdBy: people.sam,
    });
    expect(rows[0].endedAt.getTime() - rows[0].startedAt.getTime()).toBe(
      5 * MIN,
    );
  });

  it("keeps the same session id from different users apart", async () => {
    const { gala } = await seed();
    const id = sessionId();
    await sam.post(
      "/api/time/sessions",
      { sessions: [onEvent(gala.id, 10, 8, id)] },
      200,
    );
    await helper.post(
      "/api/time/sessions",
      { sessions: [onEvent(gala.id, 10, 7, id)] },
      200,
    );
    expect(await db.select().from(activitySessions)).toHaveLength(2);
  });

  it("rejects a session that ends in the future", async () => {
    const { gala } = await seed();
    const response = await sam.call("POST", "/api/time/sessions", {
      sessions: [onEvent(gala.id, 1, -30)],
    });
    expect(response.status).toBe(400);
    expect(await db.select().from(activitySessions)).toHaveLength(0);
  });

  it("reports effort per event and workload, scoped by role", async () => {
    const { gala, brunch } = await seed();
    await sam.post(
      "/api/time/sessions",
      {
        sessions: [
          onEvent(gala.id, 30, 20),
          {
            id: sessionId(),
            startedAt: ago(20),
            endedAt: ago(15),
            recordType: null,
            recordId: null,
            activity: "proposal_work",
          },
        ],
      },
      200,
    );
    await helper.post(
      "/api/time/sessions",
      { sessions: [onEvent(gala.id, 15, 10)] },
      200,
    );
    // Sue can't see the gala any more than she could open it.
    await sue.post(
      "/api/time/sessions",
      { sessions: [onEvent(brunch.id, 30, 28), onEvent(gala.id, 28, 25)] },
      200,
    );

    const all = await manager.get<TimeReport>(`/api/time/report${range}`);
    expect(all.scope).toBe("all");
    expect(all.effort).toEqual([
      {
        eventId: gala.id,
        title: "Fall gala",
        date: "2026-11-14",
        clientName: "Juniper & Co.",
        seconds: 18 * 60,
        people: 3,
      },
      {
        eventId: brunch.id,
        title: "Board brunch",
        date: "2026-11-14",
        clientName: "Juniper & Co.",
        seconds: 2 * 60,
        people: 1,
      },
    ]);
    expect(all.workload).toHaveLength(4);
    expect(all.workload).toContainEqual({
      userId: people.sam,
      userName: people.sam,
      activity: "proposal_work",
      seconds: 5 * 60,
    });

    const own = await sam.get<TimeReport>(
      `/api/time/report${range}&userId=${people.helper}`,
    );
    expect(own.scope).toBe("own");
    expect(own.effort.map((row) => [row.title, row.seconds])).toEqual([
      ["Fall gala", 10 * 60],
    ]);
    expect(own.workload.map((row) => [row.activity, row.seconds])).toEqual([
      ["event_planning", 10 * 60],
      ["proposal_work", 5 * 60],
    ]);

    const sues = await sue.get<TimeReport>(`/api/time/report${range}`);
    expect(sues.effort.map((row) => row.title)).toEqual(["Board brunch"]);
    expect(sues.workload).toEqual([
      {
        userId: people.sue,
        userName: people.sue,
        activity: "event_planning",
        seconds: 5 * 60,
      },
    ]);

    const helpers = await manager.get<TimeReport>(
      `/api/time/report${range}&userId=${people.helper}`,
    );
    expect(helpers.workload).toEqual([
      {
        userId: people.helper,
        userName: people.helper,
        activity: "event_planning",
        seconds: 5 * 60,
      },
    ]);

    const before = await manager.get<TimeReport>(
      "/api/time/report?from=2020-01-01&to=2020-01-31",
    );
    expect(before).toEqual({ scope: "all", effort: [], workload: [] });
  });
});
