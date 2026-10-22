import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { auditLog, eventStatusHistory, jobs } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { ApiError } from "../../worker/hono";
import { advanceEventStatus } from "../../worker/records/events";
import type { Actor, Role } from "../../shared/access";
import type {
  Client,
  EventInput,
  EventStatus,
  EventStatusChange,
  FlowEvent,
} from "../../shared/core-records";

// Event lifecycle (FLOW-56) against the real database.
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
  admin: "c0000000-0000-4000-8000-000000000001",
  manager: "c0000000-0000-4000-8000-000000000002",
  sam: "c0000000-0000-4000-8000-000000000003",
  sue: "c0000000-0000-4000-8000-000000000004",
  tech: "c0000000-0000-4000-8000-000000000005",
};
const as = (userId: string, role: Role) => {
  const actor: Actor = { userId, role, employmentType: "full_time" };
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
    json: async <T>(method: string, path: string, body?: unknown, status = 200) => {
      const response = await call(method, path, body);
      expect(response.status).toBe(status);
      return (await response.json()) as T;
    },
  };
};
const admin = as(people.admin, "admin");
const manager = as(people.manager, "sales_manager");
const sam = as(people.sam, "salesperson");
const sue = as(people.sue, "salesperson");
const tech = as(people.tech, "technical");

const newEvent = async (status?: EventStatus) => {
  const owner = await sam.json<Client>(
    "POST",
    "/api/clients",
    { name: "Juniper & Co.", kind: "organization", contacts: [] },
    201,
  );
  return sam.json<FlowEvent>(
    "POST",
    "/api/events",
    {
      title: "Juniper holiday party",
      date: "2026-12-12",
      startTime: "18:00",
      clientId: owner.id,
      ...(status && { status }),
    } satisfies EventInput,
    201,
  );
};
const historyOf = (eventId: string) =>
  db
    .select()
    .from(eventStatusHistory)
    .where(eq(eventStatusHistory.eventId, eventId))
    .orderBy(eventStatusHistory.createdAt);
const statusEventsOf = (eventId: string) =>
  db
    .select()
    .from(jobs)
    .where(
      and(
        like(jobs.type, "event:event.%"),
        sql`${jobs.payload}->>'entityId' = ${eventId}`,
        sql`${jobs.type} not in ('event:event.created', 'event:event.updated')`,
      ),
    );

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table audit_log, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("creating", () => {
  it("starts in Inquiry by default and records it", async () => {
    const event = await newEvent();
    expect(event.status).toBe("inquiry");
    const [row] = await historyOf(event.id);
    expect(row).toMatchObject({
      fromStatus: null,
      toStatus: "inquiry",
      manual: true,
      createdBy: people.sam,
    });
  });

  it("allows any starting status (A4)", async () => {
    const event = await newEvent("negotiation");
    expect(event.status).toBe("negotiation");
    expect(event.bookedAt).toBeNull();
  });

  it("sets booked_at when created as Closed", async () => {
    expect((await newEvent("closed")).bookedAt).not.toBeNull();
  });
});

describe("manual changes", () => {
  it("moves to any status and records who, when and why with one domain event", async () => {
    const event = await newEvent();
    const changed = await sam.json<FlowEvent>(
      "POST",
      `/api/events/${event.id}/status`,
      { status: "lost", reason: "Went with another caterer" },
    );
    expect(changed.status).toBe("lost");
    const rows = await historyOf(event.id);
    expect(rows[1]).toMatchObject({
      fromStatus: "inquiry",
      toStatus: "lost",
      reason: "Went with another caterer",
      manual: true,
      createdBy: people.sam,
    });
    const emitted = await statusEventsOf(event.id);
    expect(emitted.map((job) => job.type)).toEqual(["event:event.lost"]);
    expect(emitted[0].payload).toMatchObject({
      from: "inquiry",
      to: "lost",
      manual: true,
    });
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, event.id), eq(auditLog.action, "update")));
    expect(audits).toHaveLength(1);
    expect(audits[0].changes.status).toEqual({ before: "inquiry", after: "lost" });
  });

  it("doesn't need a reason (A3)", async () => {
    const event = await newEvent();
    const changed = await sam.json<FlowEvent>(
      "POST",
      `/api/events/${event.id}/status`,
      { status: "lost" },
    );
    expect(changed.status).toBe("lost");
  });

  it("can skip ahead and go back (A1)", async () => {
    const event = await newEvent();
    await admin.json("POST", `/api/events/${event.id}/status`, { status: "finished" });
    const back = await admin.json<FlowEvent>(
      "POST",
      `/api/events/${event.id}/status`,
      { status: "pitching" },
    );
    expect(back.status).toBe("pitching");
  });

  it("is limited to Admin and the event's salesperson (A2)", async () => {
    const event = await newEvent();
    for (const other of [manager, tech])
      expect(
        (
          await other.call("POST", `/api/events/${event.id}/status`, {
            status: "pitching",
          })
        ).status,
      ).toBe(403);
    expect(
      (
        await sue.call("POST", `/api/events/${event.id}/status`, {
          status: "pitching",
        })
      ).status,
    ).toBe(404);
    expect((await historyOf(event.id)).length).toBe(1);
    expect(await statusEventsOf(event.id)).toEqual([]);
  });

  it("refuses a move to the current status", async () => {
    const event = await newEvent();
    const response = await sam.call("POST", `/api/events/${event.id}/status`, {
      status: "inquiry",
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("INVALID_TRANSITION");
  });

  it("validates the status", async () => {
    const event = await newEvent();
    const response = await sam.call("POST", `/api/events/${event.id}/status`, {
      status: "booked",
    });
    expect(response.status).toBe(400);
  });

  it("sets booked_at the first time the event reaches Closed and keeps it", async () => {
    const event = await newEvent();
    const closed = await sam.json<FlowEvent>(
      "POST",
      `/api/events/${event.id}/status`,
      { status: "closed" },
    );
    expect(closed.bookedAt).not.toBeNull();
    await sam.json("POST", `/api/events/${event.id}/status`, { status: "negotiation" });
    const again = await sam.json<FlowEvent>(
      "POST",
      `/api/events/${event.id}/status`,
      { status: "closed" },
    );
    expect(again.bookedAt).toBe(closed.bookedAt);
  });

  it("leaves the status alone when the event is edited", async () => {
    const event = await newEvent();
    const edited = await sam.json<FlowEvent>("PUT", `/api/events/${event.id}`, {
      title: "Renamed",
      date: event.date,
      startTime: event.startTime,
      clientId: event.client.id,
      status: "closed",
    } satisfies EventInput);
    expect(edited).toMatchObject({ title: "Renamed", status: "inquiry" });
    expect((await historyOf(event.id)).length).toBe(1);
  });

  it("serves the status history newest first", async () => {
    const event = await newEvent();
    await sam.json("POST", `/api/events/${event.id}/status`, {
      status: "pitching",
      reason: "Call booked",
    });
    const history = await sam.json<EventStatusChange[]>(
      "GET",
      `/api/events/${event.id}/status-history`,
    );
    expect(history.map((entry) => [entry.from, entry.to])).toEqual([
      ["inquiry", "pitching"],
      [null, "inquiry"],
    ]);
    expect(history[0]).toMatchObject({ reason: "Call booked", actorId: people.sam });
    expect(
      (await sue.call("GET", `/api/events/${event.id}/status-history`)).status,
    ).toBe(404);
  });
});

describe("automatic changes", () => {
  it("moves one step forward without a user", async () => {
    const event = await newEvent();
    await db.transaction((tx) => advanceEventStatus(tx, event.id, "pitching"));
    const [, row] = await historyOf(event.id);
    expect(row).toMatchObject({
      fromStatus: "inquiry",
      toStatus: "pitching",
      manual: false,
      createdBy: null,
    });
    const emitted = await statusEventsOf(event.id);
    expect(emitted.map((job) => job.type)).toEqual(["event:event.pitching"]);
  });

  it("can mark the event Lost from any open status", async () => {
    const event = await newEvent("negotiation");
    await db.transaction((tx) => advanceEventStatus(tx, event.id, "lost"));
    expect((await historyOf(event.id)).at(-1)?.toStatus).toBe("lost");
  });

  it("rejects an invalid move with a clear error and changes nothing (AC1)", async () => {
    const event = await newEvent();
    const error = await db
      .transaction((tx) => advanceEventStatus(tx, event.id, "closed"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "INVALID_TRANSITION",
      message:
        "An event can't move automatically from Inquiry to Closed. Allowed next statuses: Pitching, Lost.",
    });
    expect((await historyOf(event.id)).length).toBe(1);
    expect(await statusEventsOf(event.id)).toEqual([]);
  });

  it("treats Finished and Lost as final", async () => {
    const event = await newEvent("finished");
    await expect(
      db.transaction((tx) => advanceEventStatus(tx, event.id, "lost")),
    ).rejects.toMatchObject({
      message: "An event can't move automatically from Finished to Lost. Finished is final.",
    });
  });
});
