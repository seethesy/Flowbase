import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { auditLog, jobs, venues } from "../../worker/db/schema";
import type { Db } from "../../worker/db/client";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { setVenueArchived } from "../../worker/records/venues";
import type { Actor } from "../../shared/access";
import type { Client, FlowEvent, Venue } from "../../shared/core-records";

// Shared archive and restore (FLOW-192): one audit row and one domain event per
// change, in the change's transaction; venues now emit their lifecycle events.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const actor: Actor = {
  userId: "d0000000-0000-4000-8000-000000000001",
  role: "admin",
  employmentType: "full_time",
};
const app = createApp({ withDb, resolveActor: async () => actor });
const post = async <T>(path: string, body: unknown, status = 200) => {
  const response = await app.request(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    env,
  );
  expect(response.status).toBe(status);
  return (await response.json()) as T;
};
const lifecycleOf = async (entityId: string) => ({
  jobs: (
    await db
      .select({ type: jobs.type })
      .from(jobs)
      .where(sql`${jobs.payload}->>'entityId' = ${entityId}`)
      .orderBy(jobs.createdAt)
  )
    .map((job) => job.type)
    .filter((type) => /\.(archived|restored)$/.test(type)),
  audits: (
    await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, entityId))
      .orderBy(auditLog.createdAt)
  )
    .map((row) => row.action)
    .filter((action) => action === "archive" || action === "restore"),
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table consumable_allocations, event_requirements, reservation_conflicts, reservations, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("venues", () => {
  it("emits venue.archived and venue.restored with their audit rows", async () => {
    const venue = await post<Venue>("/api/venues", { name: "Glasshouse" }, 201);
    await post(`/api/venues/${venue.id}/archive`, {});
    await post(`/api/venues/${venue.id}/restore`, {});
    expect(await lifecycleOf(venue.id)).toEqual({
      jobs: ["event:venue.archived", "event:venue.restored"],
      audits: ["archive", "restore"],
    });
  });

  it("leaves no venue change, audit row or job when the transaction rolls back", async () => {
    const venue = await post<Venue>("/api/venues", { name: "Glasshouse" }, 201);
    await db
      .transaction(async (tx) => {
        await setVenueArchived(tx as unknown as Db, actor, venue.id, true);
        tx.rollback();
      })
      .catch(() => undefined);
    const [row] = await db.select().from(venues).where(eq(venues.id, venue.id));
    expect(row.archivedAt).toBeNull();
    expect(await lifecycleOf(venue.id)).toEqual({ jobs: [], audits: [] });
  });
});

describe("other records", () => {
  it("still writes exactly one audit row and one event per client and event change", async () => {
    const owner = await post<Client>(
      "/api/clients",
      { name: "Juniper & Co.", kind: "organization", contacts: [] },
      201,
    );
    const event = await post<FlowEvent>(
      "/api/events",
      {
        title: "Fall gala",
        date: "2026-11-14",
        startTime: "18:00",
        clientId: owner.id,
      },
      201,
    );
    for (const [resource, id] of [
      ["clients", owner.id],
      ["events", event.id],
    ] as const) {
      await post(`/api/${resource}/${id}/archive`, {});
      await post(`/api/${resource}/${id}/restore`, {});
    }
    expect(await lifecycleOf(owner.id)).toEqual({
      jobs: ["event:client.archived", "event:client.restored"],
      audits: ["archive", "restore"],
    });
    expect(await lifecycleOf(event.id)).toEqual({
      jobs: ["event:event.archived", "event:event.restored"],
      audits: ["archive", "restore"],
    });
  });

  it("records the archiving user", async () => {
    const venue = await post<Venue>("/api/venues", { name: "Glasshouse" }, 201);
    await post(`/api/venues/${venue.id}/archive`, {});
    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, venue.id), eq(auditLog.action, "archive")));
    expect(row.createdBy).toBe(actor.userId);
    expect(Object.keys(row.changes)).toEqual(["archivedAt"]);
  });
});
