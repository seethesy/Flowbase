import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import {
  clients,
  events,
  jobs,
  leads,
  proposals,
  proposalStageHistory,
} from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createLead } from "../../worker/records/leads";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { Client, FlowEvent } from "../../shared/core-records";
import type {
  Lead,
  LeadConversion,
  LeadIntake,
} from "../../shared/leads";

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
  kitchen: "a0000000-0000-4000-8000-000000000005",
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
    post: async <T>(path: string, body: unknown, status = 200) => {
      const response = await call("POST", path, body);
      expect(response.status).toBe(status);
      return (await response.json()) as T;
    },
  };
};
const admin = signedInAs(people.admin, "admin");
const manager = signedInAs(people.manager, "sales_manager");
const sam = signedInAs(people.sam, "salesperson");
const sue = signedInAs(people.sue, "salesperson");
const partTimeSam = signedInAs(people.sam, "salesperson", "part_time");
const kitchen = signedInAs(people.kitchen, "kitchen_lead");

// Each seeded lead is its own source record: the same source and source lead id
// again would update the first lead (FLOW-110).
let sourceLeadNumber = 1000;
const intake = (overrides: Partial<LeadIntake> = {}): LeadIntake => ({
  channel: "webhook",
  source: "Bark",
  sourceLeadId: `bark-${(sourceLeadNumber += 1)}`,
  sourceLeadUrl: "https://bark.example/leads/1001",
  purchased: true,
  name: "Maya Ortiz",
  email: "maya@example.com",
  phone: "(202) 555-0142",
  eventDate: "2026-11-14",
  guestCount: 80,
  location: "Brooklyn, NY",
  eventType: "Wedding",
  budgetCents: 1_200_000,
  message: "Plated dinner for 80.",
  ...overrides,
});
const seed = async (overrides: Partial<LeadIntake> = {}) =>
  (await createLead(db, intake(overrides))).id;
const names = (rows: Lead[]) => rows.map((row) => row.name);
const jobTypes = async () =>
  (await db.select({ type: jobs.type }).from(jobs)).map((row) => row.type);
const qualify = async (id: string) => {
  await admin.post<Lead>(`/api/leads/${id}/status`, { status: "contacted" });
  await admin.post<Lead>(`/api/leads/${id}/status`, { status: "qualified" });
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_versions, proposal_stage_history, proposals, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("inbox (FLOW-100)", () => {
  it("stores a lead from every channel and emits the matching event", async () => {
    await seed({ channel: "webhook", name: "Webhook", sourceLeadId: "bark-1001" });
    await seed({ channel: "collector", name: "Collector" });
    await seed({ channel: "manual", name: "Manual" });
    await seed({ channel: "import", name: "Import" });
    // The four share an email, so each later one also reports possible duplicates
    // (FLOW-110, covered in lead-duplicates.test.ts).
    const types = (await jobTypes())
      .filter((type) => type !== "event:lead.duplicates_found")
      .sort();
    expect(types).toEqual([
      "event:lead.collected",
      "event:lead.received",
      "event:lead.received",
      "event:lead.received",
    ]);
    const list = await admin.get<Lead[]>("/api/leads");
    expect(list).toHaveLength(4);
    expect(list.find((row) => row.name === "Webhook")).toMatchObject({
      channel: "webhook",
      source: "Bark",
      sourceLeadId: "bark-1001",
      purchased: true,
      status: "new",
      budgetCents: 1_200_000,
      assignedSalespersonId: null,
    });
  });

  it("puts a lead with no event date or no contact method in needs review", async () => {
    await seed({ name: "Complete" });
    await seed({ name: "No date", eventDate: null });
    await seed({ name: "No contact", email: "", phone: "" });
    await seed({ name: "Phone only", email: "" });
    const review = await admin.get<Lead[]>("/api/leads?needsReview=true");
    expect(names(review).sort()).toEqual(["No contact", "No date"]);
    expect(review.every((row) => row.needsReview)).toBe(true);
    const all = await admin.get<Lead[]>("/api/leads");
    expect(all.find((row) => row.name === "Complete")?.needsReview).toBe(false);
  });

  it("filters by status, source, channel and search, newest first", async () => {
    await seed({
      name: "Older",
      receivedAt: "2026-10-01T12:00:00.000Z",
      source: "Thumbtack",
      channel: "collector",
    });
    await seed({ name: "Newer", receivedAt: "2026-10-02T12:00:00.000Z" });
    await seed({ name: "Searchable", email: "zed@example.com" });
    const all = await admin.get<Lead[]>("/api/leads");
    expect(names(all).slice(-2)).toEqual(["Newer", "Older"]);
    expect(names(await admin.get<Lead[]>("/api/leads?source=Thumbtack"))).toEqual([
      "Older",
    ]);
    expect(names(await admin.get<Lead[]>("/api/leads?channel=collector"))).toEqual([
      "Older",
    ]);
    expect(names(await admin.get<Lead[]>("/api/leads?search=zed"))).toEqual([
      "Searchable",
    ]);
    expect(await admin.get<Lead[]>("/api/leads?status=lost")).toEqual([]);
    expect(await admin.get<Lead[]>("/api/leads?status=bogus")).toEqual([]);
    expect(await admin.get<Lead[]>("/api/leads?channel=bogus")).toEqual([]);
  });

  it("shows a salesperson only their assigned leads and answers 404 for others", async () => {
    const mine = await seed({ name: "Mine" });
    const theirs = await seed({ name: "Theirs" });
    await seed({ name: "Unassigned" });
    await admin.post(`/api/leads/${mine}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await admin.post(`/api/leads/${theirs}/assign`, {
      assignedSalespersonId: people.sue,
    });
    expect(names(await sam.get<Lead[]>("/api/leads"))).toEqual(["Mine"]);
    expect(names(await sue.get<Lead[]>("/api/leads"))).toEqual(["Theirs"]);
    expect((await sam.call("GET", `/api/leads/${theirs}`)).status).toBe(404);
    expect(
      (
        await sam.call("POST", `/api/leads/${theirs}/status`, {
          status: "contacted",
        })
      ).status,
    ).toBe(404);
    expect((await sam.call("GET", `/api/leads/${mine}`)).status).toBe(200);
    expect(await manager.get<Lead[]>("/api/leads")).toHaveLength(3);
    expect(await admin.get<Lead[]>("/api/leads")).toHaveLength(3);
    expect((await kitchen.call("GET", "/api/leads")).status).toBe(403);
  });

  it("hides the raw payload from part-time users and from every list", async () => {
    const id = await seed({
      name: "Payload",
      rawPayload: { bark: { id: 1001, answers: ["a", "b"] } },
    });
    await admin.post(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sam,
    });
    const full = await admin.get<Lead>(`/api/leads/${id}`);
    expect(full.rawPayload).toEqual({ bark: { id: 1001, answers: ["a", "b"] } });
    expect((await sam.get<Lead>(`/api/leads/${id}`)).rawPayload).toEqual({
      bark: { id: 1001, answers: ["a", "b"] },
    });
    const partTime = await partTimeSam.get<Lead>(`/api/leads/${id}`);
    expect(partTime.rawPayload).toBeNull();
    expect(JSON.stringify(partTime)).not.toContain("answers");
    for (const list of [
      await admin.get<Lead[]>("/api/leads"),
      await partTimeSam.get<Lead[]>("/api/leads"),
    ])
      expect(list.every((row) => !("rawPayload" in row))).toBe(true);
  });
});

describe("triage and status (FLOW-111)", () => {
  it("lists only open, unassigned leads in the triage queue", async () => {
    const a = await seed({ name: "A" });
    await seed({ name: "B" });
    const lost = await seed({ name: "Lost" });
    await admin.post(`/api/leads/${a}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await admin.post(`/api/leads/${lost}/status`, {
      status: "lost",
      reason: "No budget",
    });
    expect(names(await admin.get<Lead[]>("/api/leads?triage=true"))).toEqual(["B"]);
    expect(names(await manager.get<Lead[]>("/api/leads?triage=true"))).toEqual([
      "B",
    ]);
  });

  it("lets only Admin assign or reassign, and notifies the salesperson", async () => {
    const id = await seed();
    const body = { assignedSalespersonId: people.sam };
    for (const other of [manager, sam, kitchen])
      expect((await other.call("POST", `/api/leads/${id}/assign`, body)).status).toBe(
        403,
      );
    expect(
      (
        await manager.call("POST", "/api/leads/assign", {
          leadIds: [id],
          assignedSalespersonId: people.sam,
        })
      ).status,
    ).toBe(403);
    expect((await admin.get<Lead>(`/api/leads/${id}`)).assignedSalespersonId).toBeNull();

    const assigned = await admin.post<Lead>(`/api/leads/${id}/assign`, body);
    expect(assigned.assignedSalespersonId).toBe(people.sam);
    const reassigned = await admin.post<Lead>(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sue,
    });
    expect(reassigned.assignedSalespersonId).toBe(people.sue);
    // Assigning the same person again changes nothing and notifies nobody.
    await admin.post(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sue,
    });
    const assignedEvents = await db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(sql`${jobs.type} = 'event:lead.assigned'`);
    expect(assignedEvents.map((row) => row.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: id,
          assignedSalespersonId: people.sam,
          previousSalespersonId: null,
        }),
        expect.objectContaining({
          entityId: id,
          assignedSalespersonId: people.sue,
          previousSalespersonId: people.sam,
        }),
      ]),
    );
    expect(assignedEvents).toHaveLength(2);
  });

  it("bulk assigns from the queue, all or nothing", async () => {
    const ids = [await seed({ name: "One" }), await seed({ name: "Two" })];
    const missing = "a0000000-0000-4000-8000-0000000000ff";
    const failed = await admin.call("POST", "/api/leads/assign", {
      leadIds: [...ids, missing],
      assignedSalespersonId: people.sam,
    });
    expect(failed.status).toBe(404);
    expect(await admin.get<Lead[]>("/api/leads?triage=true")).toHaveLength(2);
    const done = await admin.post<Lead[]>("/api/leads/assign", {
      leadIds: ids,
      assignedSalespersonId: people.sam,
    });
    expect(done.map((row) => row.assignedSalespersonId)).toEqual([
      people.sam,
      people.sam,
    ]);
    expect(await admin.get<Lead[]>("/api/leads?triage=true")).toEqual([]);
    expect(names(await sam.get<Lead[]>("/api/leads")).sort()).toEqual(["One", "Two"]);
  });

  it("requires a reason to mark a lead lost and treats lost as final", async () => {
    const id = await seed();
    const missing = await admin.call("POST", `/api/leads/${id}/status`, {
      status: "lost",
    });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toBe(
      "A reason is required when marking a lead lost.",
    );
    const lost = await admin.post<Lead>(`/api/leads/${id}/status`, {
      status: "lost",
      reason: "Booked another caterer",
    });
    expect(lost).toMatchObject({
      status: "lost",
      lostReason: "Booked another caterer",
    });
    const again = await admin.call("POST", `/api/leads/${id}/status`, {
      status: "contacted",
    });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("INVALID_TRANSITION");
  });

  it("follows new, contacted, qualified and never skips or converts by status", async () => {
    const id = await seed();
    const skip = await admin.call("POST", `/api/leads/${id}/status`, {
      status: "qualified",
    });
    expect(skip.status).toBe(409);
    expect(
      (await admin.call("POST", `/api/leads/${id}/status`, { status: "converted" }))
        .status,
    ).toBe(400);
    await admin.post(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sam,
    });
    // A salesperson moves their own lead along.
    const contacted = await sam.post<Lead>(`/api/leads/${id}/status`, {
      status: "contacted",
    });
    expect(contacted.status).toBe("contacted");
    expect(
      (await sam.post<Lead>(`/api/leads/${id}/status`, { status: "qualified" }))
        .status,
    ).toBe("qualified");
    const changes = await db
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(sql`${jobs.type} = 'event:lead.status_changed'`);
    expect(changes).toHaveLength(2);
  });

  it("records first-response time as received to the first move to contacted", async () => {
    const id = await seed({ receivedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    expect((await admin.get<Lead>(`/api/leads/${id}`)).firstResponseSeconds).toBeNull();
    const contacted = await admin.post<Lead>(`/api/leads/${id}/status`, {
      status: "contacted",
    });
    expect(contacted.firstRespondedAt).not.toBeNull();
    expect(contacted.firstResponseSeconds).toBeGreaterThanOrEqual(7200);
    expect(contacted.firstResponseSeconds).toBeLessThan(7200 + 120);
    const expected = Math.round(
      (new Date(contacted.firstRespondedAt!).getTime() -
        new Date(contacted.receivedAt).getTime()) /
        1000,
    );
    expect(contacted.firstResponseSeconds).toBe(expected);
    const qualified = await admin.post<Lead>(`/api/leads/${id}/status`, {
      status: "qualified",
    });
    expect(qualified.firstRespondedAt).toBe(contacted.firstRespondedAt);
  });
});

describe("conversion (FLOW-112)", () => {
  const convertBody = (overrides: Record<string, unknown> = {}) => ({
    event: { startTime: "18:00" },
    ...overrides,
  });

  it("creates a client, contact and inquiry event pre-filled from the lead", async () => {
    const id = await seed();
    await admin.post(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await qualify(id);
    const result = await admin.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody(),
    );
    expect(result.lead).toMatchObject({
      status: "converted",
      convertedClientId: result.client.id,
      convertedEventId: result.event.id,
    });
    expect(result.client.name).toBe("Maya Ortiz");
    expect(result.event.title).toBe("Maya Ortiz — Wedding");

    const event = await admin.get<FlowEvent>(`/api/events/${result.event.id}`);
    expect(event).toMatchObject({
      status: "inquiry",
      date: "2026-11-14",
      startTime: "18:00",
      guestCount: 80,
      eventType: "Wedding",
      address: "Brooklyn, NY",
      internalNotes: "Plated dinner for 80.",
      assignedSalespersonId: people.sam,
    });
    const created = await admin.get<Client>(`/api/clients/${result.client.id}`);
    expect(created).toMatchObject({ kind: "person", assignedSalespersonId: people.sam });
    expect(created.contacts).toEqual([
      expect.objectContaining({
        name: "Maya Ortiz",
        role: "primary_poc",
        email: "maya@example.com",
        phone: "(202) 555-0142",
      }),
    ]);
    expect(event.pocContactId).toBe(created.contacts[0].id);
    const types = await jobTypes();
    expect(types).toEqual(
      expect.arrayContaining([
        "event:client.created",
        "event:event.created",
        "event:proposal.created",
        "event:lead.converted",
      ]),
    );
  });

  // FLOW-163 AC1
  it("creates exactly one proposal in Client communication for the new event", async () => {
    const id = await seed();
    await admin.post(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await qualify(id);
    const result = await admin.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody(),
    );
    const rows = await db.select().from(proposals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.proposal.id,
      eventId: result.event.id,
      clientId: result.client.id,
      title: "Maya Ortiz — Wedding",
      stage: "client_communication",
      assignedSalespersonId: people.sam,
      currentVersionId: null,
    });
    expect(
      await db
        .select({ from: proposalStageHistory.fromStage, to: proposalStageHistory.toStage })
        .from(proposalStageHistory),
    ).toEqual([{ from: null, to: "client_communication" }]);
  });

  // FLOW-163: linking to an existing client creates the proposal the same way.
  it("creates the proposal when the lead is linked to an existing client", async () => {
    const existing = await admin.post<Client>(
      "/api/clients",
      { name: "Juniper & Co.", kind: "organization", contacts: [] },
      201,
    );
    const id = await seed();
    await qualify(id);
    const result = await admin.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody({ client: { mode: "link", clientId: existing.id } }),
    );
    const rows = await db.select().from(proposals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.proposal.id,
      eventId: result.event.id,
      clientId: existing.id,
      stage: "client_communication",
    });
  });

  it("converts a lead with a date and guest count into an event with both", async () => {
    const id = await seed({ eventDate: "2027-02-06", guestCount: 125 });
    await qualify(id);
    const result = await admin.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody({ event: { startTime: "12:30", title: "Winter gala" } }),
    );
    const event = await admin.get<FlowEvent>(`/api/events/${result.event.id}`);
    expect(event).toMatchObject({
      title: "Winter gala",
      date: "2027-02-06",
      guestCount: 125,
    });
  });

  it("needs a qualified lead and converts only once", async () => {
    const id = await seed();
    const early = await admin.call("POST", `/api/leads/${id}/convert`, convertBody());
    expect(early.status).toBe(409);
    await qualify(id);
    await admin.post(`/api/leads/${id}/convert`, convertBody());
    const twice = await admin.call("POST", `/api/leads/${id}/convert`, convertBody());
    expect(twice.status).toBe(409);
    expect(await db.select().from(clients)).toHaveLength(1);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("asks for an event date when the lead has none", async () => {
    const id = await seed({ eventDate: null });
    await qualify(id);
    const missing = await admin.call("POST", `/api/leads/${id}/convert`, convertBody());
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toBe("Enter the event date.");
    const result = await admin.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody({ event: { startTime: "18:00", date: "2026-12-12" } }),
    );
    expect(
      (await admin.get<FlowEvent>(`/api/events/${result.event.id}`)).date,
    ).toBe("2026-12-12");
  });

  it("warns about a matching client and lets the user link or create anyway", async () => {
    const existing = await admin.post<Client>(
      "/api/clients",
      {
        name: "Ortiz Family",
        kind: "organization",
        contacts: [
          { name: "Maya", role: "primary_poc", email: "MAYA@example.com" },
        ],
      },
      201,
    );
    const id = await seed();
    await qualify(id);
    const warned = await admin.call("POST", `/api/leads/${id}/convert`, convertBody());
    expect(warned.status).toBe(409);
    const body = await warned.json();
    expect(body.error.code).toBe("POSSIBLE_DUPLICATE");
    expect(body.duplicates).toEqual([{ id: existing.id, name: "Ortiz Family" }]);
    expect(await db.select().from(clients)).toHaveLength(1);

    const linked = await admin.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody({ client: { mode: "link", clientId: existing.id } }),
    );
    expect(linked.client).toEqual({ id: existing.id, name: "Ortiz Family" });
    expect(await db.select().from(clients)).toHaveLength(1);
    const after = await admin.get<Client>(`/api/clients/${existing.id}`);
    // The matching contact is reused, not duplicated.
    expect(after.contacts).toHaveLength(1);
    const event = await admin.get<FlowEvent>(`/api/events/${linked.event.id}`);
    expect(event.client.id).toBe(existing.id);
    expect(event.pocContactId).toBe(after.contacts[0].id);
  });

  it("adds the lead as a contact when linking to a client without a match", async () => {
    const existing = await admin.post<Client>(
      "/api/clients",
      { name: "Hudson Events", kind: "organization", contacts: [] },
      201,
    );
    const id = await seed();
    await qualify(id);
    await admin.post(
      `/api/leads/${id}/convert`,
      convertBody({ client: { mode: "link", clientId: existing.id } }),
    );
    const after = await admin.get<Client>(`/api/clients/${existing.id}`);
    expect(after.contacts).toEqual([
      expect.objectContaining({ name: "Maya Ortiz", role: "primary_poc" }),
    ]);
  });

  it("creates the client anyway after the warning", async () => {
    await admin.post(
      "/api/clients",
      {
        name: "Ortiz Family",
        kind: "organization",
        contacts: [{ name: "Maya", role: "primary_poc", phone: "202-555-0142" }],
      },
      201,
    );
    const id = await seed();
    await qualify(id);
    await admin.post(
      `/api/leads/${id}/convert`,
      convertBody({
        client: { mode: "create", allowDuplicate: true, kind: "organization" },
      }),
    );
    expect(await db.select().from(clients)).toHaveLength(2);
  });

  it("lets a salesperson convert their own lead into their own client", async () => {
    const id = await seed();
    await admin.post(`/api/leads/${id}/assign`, {
      assignedSalespersonId: people.sam,
    });
    await qualify(id);
    expect(
      (await sue.call("POST", `/api/leads/${id}/convert`, convertBody())).status,
    ).toBe(404);
    const result = await sam.post<LeadConversion>(
      `/api/leads/${id}/convert`,
      convertBody(),
    );
    expect(
      (await sam.get<Client>(`/api/clients/${result.client.id}`))
        .assignedSalespersonId,
    ).toBe(people.sam);
    expect(
      (await sam.get<FlowEvent>(`/api/events/${result.event.id}`))
        .assignedSalespersonId,
    ).toBe(people.sam);
  });

  it("is all or nothing: a failure late in the transaction leaves nothing behind", async () => {
    const id = await seed();
    await qualify(id);
    await db.execute(sql`
      create function fail_lead_converted() returns trigger language plpgsql as $$
      begin
        if new.type = 'event:lead.converted' then
          raise exception 'simulated failure';
        end if;
        return new;
      end $$`);
    await db.execute(sql`
      create trigger fail_lead_converted before insert on jobs
      for each row execute function fail_lead_converted()`);
    try {
      const response = await admin.call(
        "POST",
        `/api/leads/${id}/convert`,
        convertBody(),
      );
      expect(response.status).toBe(500);
    } finally {
      await db.execute(sql`drop trigger if exists fail_lead_converted on jobs`);
      await db.execute(sql`drop function if exists fail_lead_converted()`);
    }
    expect(await db.select().from(clients)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
    // FLOW-163 AC2: the proposal goes with them.
    expect(await db.select().from(proposals)).toHaveLength(0);
    expect(await db.select().from(proposalStageHistory)).toHaveLength(0);
    const [row] = await db.select().from(leads);
    expect(row).toMatchObject({
      status: "qualified",
      convertedClientId: null,
      convertedEventId: null,
    });
    const types = await jobTypes();
    expect(types).not.toContain("event:lead.converted");
    expect(types).not.toContain("event:client.created");
    expect(types).not.toContain("event:event.created");
    expect(types).not.toContain("event:proposal.created");
  });

  // FLOW-163 AC2: a failure while creating the proposal itself keeps nothing.
  it("keeps no client, contact, event or lead change when the proposal insert fails", async () => {
    const id = await seed();
    await qualify(id);
    await db.execute(sql`
      create function fail_proposal_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'simulated proposal failure';
      end $$`);
    await db.execute(sql`
      create trigger fail_proposal_insert before insert on proposals
      for each row execute function fail_proposal_insert()`);
    try {
      const response = await admin.call(
        "POST",
        `/api/leads/${id}/convert`,
        convertBody(),
      );
      expect(response.status).toBe(500);
    } finally {
      await db.execute(sql`drop trigger if exists fail_proposal_insert on proposals`);
      await db.execute(sql`drop function if exists fail_proposal_insert()`);
    }
    expect(await db.select().from(clients)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(proposals)).toHaveLength(0);
    const [row] = await db.select().from(leads);
    expect(row).toMatchObject({ status: "qualified", convertedEventId: null });
  });
});
