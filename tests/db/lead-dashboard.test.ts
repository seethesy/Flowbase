import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { clients, events, leads } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createLead } from "../../worker/records/leads";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, Role } from "../../shared/access";
import type { EventStatus } from "../../shared/core-records";
import type { LeadDashboard, LeadIntake, LeadStatus } from "../../shared/leads";

// Lead dashboard (FLOW-113): the numbers match the lead records of a seeded data set.
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
};
const signedInAs = (userId: string, role: Role) => {
  const actor: Actor = { userId, role, employmentType: "full_time" };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return {
    call: (path: string) => app.request(path, {}, env),
    dashboard: async (query = "?from=2026-10-01&to=2026-10-31") => {
      const response = await app.request(`/api/leads/dashboard${query}`, {}, env);
      expect(response.status).toBe(200);
      return (await response.json()) as LeadDashboard;
    },
  };
};
const admin = signedInAs(people.admin, "admin");
const manager = signedInAs(people.manager, "sales_manager");
const sam = signedInAs(people.sam, "salesperson");
const staff = signedInAs("a0000000-0000-4000-8000-000000000009", "staff");

let n = 0;
async function seed(
  lead: Partial<LeadIntake> & {
    status?: LeadStatus;
    eventStatus?: EventStatus;
    respondedAfterHours?: number;
    salesperson?: string;
  },
) {
  n += 1;
  const { status, eventStatus, respondedAfterHours, salesperson, ...intake } = lead;
  const receivedAt = intake.receivedAt ?? "2026-10-10T15:00:00.000Z";
  const { id } = await createLead(
    db,
    {
      channel: "collector",
      source: "Bark",
      sourceLeadId: `lead-${n}`,
      name: `Person ${n}`,
      email: `person${n}@example.com`,
      receivedAt,
      ...intake,
    },
    { assignedSalespersonId: salesperson },
  );
  let convertedEventId: string | null = null;
  let convertedClientId: string | null = null;
  if (eventStatus) {
    const [row] = await db
      .insert(clients)
      .values({ name: `Client ${n}`, kind: "person" })
      .returning({ id: clients.id });
    const [event] = await db
      .insert(events)
      .values({
        title: `Event ${n}`,
        startsAt: new Date("2026-12-01T23:00:00Z"),
        clientId: row.id,
        status: eventStatus,
      })
      .returning({ id: events.id });
    convertedClientId = row.id;
    convertedEventId = event.id;
  }
  await db
    .update(leads)
    .set({
      status: status ?? (eventStatus ? "converted" : "new"),
      convertedClientId,
      convertedEventId,
      firstRespondedAt:
        respondedAfterHours === undefined
          ? null
          : new Date(Date.parse(receivedAt) + respondedAfterHours * 3_600_000),
    })
    .where(eq(leads.id, id));
  return id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
  await seed({ purchased: true, budgetCents: 1_000_000, eventStatus: "closed", respondedAfterHours: 1, salesperson: people.sam });
  await seed({ eventStatus: "finished", respondedAfterHours: 3, salesperson: people.sue });
  await seed({ budgetCents: 500_000, salesperson: people.sam });
  await seed({ source: "Thumbtack", channel: "webhook", status: "contacted", respondedAfterHours: 2, salesperson: people.sue });
  await seed({ source: "Thumbtack", channel: "webhook", status: "lost" });
  // Outside the range.
  await seed({ budgetCents: 9_000_000, receivedAt: "2026-09-15T15:00:00.000Z" });
});
afterAll(async () => {
  await client.end();
});

describe("lead dashboard (FLOW-113)", () => {
  it("matches the underlying lead records (AC1)", async () => {
    const dashboard = await admin.dashboard();
    expect(dashboard).toMatchObject({ from: "2026-10-01", to: "2026-10-31", scope: "all" });
    expect(dashboard.averageBudgetCents).toBe(750_000);
    expect(dashboard.totals).toEqual({
      leads: 5,
      converted: 2,
      conversionRate: 0.4,
      closed: 2,
      // $10,000 stated, plus the $7,500 average for the closed lead with no budget.
      estimatedClosedCents: 1_750_000,
      medianFirstResponseSeconds: 7_200,
      awaitingAction: 1,
      purchased: 1,
    });
    expect(dashboard.bySource).toEqual([
      {
        source: "Bark",
        leads: 3,
        converted: 2,
        conversionRate: 2 / 3,
        closed: 2,
        estimatedClosedCents: 1_750_000,
        medianFirstResponseSeconds: 7_200,
        awaitingAction: 1,
        purchased: 1,
        hasPurchased: true,
      },
      {
        source: "Thumbtack",
        leads: 2,
        converted: 0,
        conversionRate: 0,
        closed: 0,
        estimatedClosedCents: 0,
        medianFirstResponseSeconds: 7_200,
        awaitingAction: 0,
        purchased: 0,
        hasPurchased: false,
      },
    ]);
    expect(Object.fromEntries(dashboard.byStatus.map((row) => [row.status, row.leads]))).toEqual({
      new: 1,
      contacted: 1,
      converted: 2,
      lost: 1,
    });
    expect(dashboard.byChannel.map((row) => [row.channel, row.leads])).toEqual([
      ["collector", 3],
      ["webhook", 2],
    ]);
    expect(
      Object.fromEntries(dashboard.bySalesperson.map((row) => [String(row.salespersonId), row.leads])),
    ).toEqual({ [people.sam]: 2, [people.sue]: 2, null: 1 });
    expect(await manager.dashboard()).toEqual(dashboard);
  });

  it("shows a salesperson only their own leads (AC2)", async () => {
    const dashboard = await sam.dashboard();
    expect(dashboard.scope).toBe("own");
    expect(dashboard.totals).toMatchObject({
      leads: 2,
      converted: 1,
      closed: 1,
      estimatedClosedCents: 1_000_000,
      awaitingAction: 1,
    });
    expect(dashboard.bySource.map((row) => row.source)).toEqual(["Bark"]);
    expect(dashboard.bySalesperson.map((row) => row.salespersonId)).toEqual([people.sam]);
  });

  it("covers the range by New York days and refuses a bad range", async () => {
    const september = await admin.dashboard("?from=2026-09-01&to=2026-09-30");
    expect(september.totals.leads).toBe(1);
    const defaults = await admin.dashboard("");
    expect(defaults.to >= defaults.from).toBe(true);
    for (const query of ["?from=2026-10-31&to=2026-10-01", "?from=2026-02-30", "?to=soon"])
      expect((await admin.call(`/api/leads/dashboard${query}`)).status).toBe(400);
    expect((await staff.call("/api/leads/dashboard")).status).toBe(403);
  });
});
