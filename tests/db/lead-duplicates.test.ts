import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { jobs, leadDuplicates, leads } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createLead } from "../../worker/records/leads";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, Role } from "../../shared/access";
import type { Client, ClientInput } from "../../shared/core-records";
import {
  type Lead,
  type LeadDuplicate,
  type LeadIntake,
} from "../../shared/leads";

// Lead duplicate detection and merge (FLOW-110) against the CI Postgres service.
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
      return (await response.json().catch(() => null)) as T;
    },
  };
};
const admin = signedInAs(people.admin, "admin");
const manager = signedInAs(people.manager, "sales_manager");
const sam = signedInAs(people.sam, "salesperson");
const sue = signedInAs(people.sue, "salesperson");

const intake = (overrides: Partial<LeadIntake> = {}): LeadIntake => ({
  channel: "collector",
  source: "Bark",
  sourceLeadId: "bark-1",
  sourceLeadUrl: "https://bark.example/leads/1",
  name: "Maya Ortiz",
  email: "maya@example.com",
  phone: "(202) 555-0142",
  eventDate: "2026-11-14",
  rawPayload: { site: "bark" },
  ...overrides,
});
const thumbtack = (overrides: Partial<LeadIntake> = {}) =>
  intake({
    channel: "webhook",
    source: "Thumbtack",
    sourceLeadId: "tt-1",
    sourceLeadUrl: "https://thumbtack.example/leads/1",
    phone: "",
    rawPayload: { site: "thumbtack" },
    ...overrides,
  });
const seed = async (input: LeadIntake, assignedSalespersonId?: string) =>
  (await createLead(db, input, { assignedSalespersonId })).id;
const openDuplicates = () =>
  db.select().from(leadDuplicates).where(eq(leadDuplicates.status, "open"));

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

describe("matching (FLOW-110)", () => {
  it("flags the same client arriving from Bark and Thumbtack with the same email (AC1)", async () => {
    const bark = await seed(intake());
    const tt = await seed(thumbtack({ name: "M. Ortiz", eventDate: null }));
    const [duplicate] = await openDuplicates();
    expect(duplicate).toMatchObject({ leadId: tt, matchedLeadId: bark, reason: "email" });
    const detail = await admin.get<Lead>(`/api/leads/${bark}`);
    expect(detail.duplicates).toEqual([
      expect.objectContaining({ reason: "email", lead: expect.objectContaining({ id: tt }) }),
    ]);
    const types = (await db.select({ type: jobs.type }).from(jobs)).map((j) => j.type);
    expect(types).toContain("event:lead.duplicates_found");
  });

  it("updates the stored lead when the same source sends the same lead again", async () => {
    const first = await seed(intake({ guestCount: null }));
    const again = await createLead(db, intake({ guestCount: 120, rawPayload: { v: 2 } }));
    expect(again).toEqual({ id: first, created: false });
    const rows = await db.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guestCount: 120, rawPayload: { v: 2 } });
    expect(await openDuplicates()).toEqual([]);
    // A different source with the same lead id is a different lead.
    expect((await createLead(db, intake({ source: "WeddingPro" }))).created).toBe(true);
  });

  it("matches by phone, then by name and event date", async () => {
    const original = await seed(intake());
    const byPhone = await seed(
      thumbtack({ sourceLeadId: "tt-2", email: "other@example.com", phone: "+1 202 555 0142" }),
    );
    const byName = await seed(
      thumbtack({ sourceLeadId: "tt-3", email: "", phone: "", name: "maya ortiz" }),
    );
    await seed(
      thumbtack({ sourceLeadId: "tt-4", email: "", phone: "", name: "Maya Ortiz", eventDate: "2027-01-01" }),
    );
    await seed(
      thumbtack({ sourceLeadId: "tt-5", email: "", phone: "", name: "Jordan Lee" }),
    );
    const reasons = (await openDuplicates()).map((row) => [row.leadId, row.matchedLeadId, row.reason]);
    expect(reasons).toEqual(
      expect.arrayContaining([
        [byPhone, original, "phone"],
        [byName, original, "name_event_date"],
      ]),
    );
    expect(reasons).toHaveLength(3);
    expect(reasons).toContainEqual([byName, byPhone, "name_event_date"]);
  });

  it("links a lead to an existing client with the same email", async () => {
    const created = await admin.post<Client>(
      "/api/clients",
      {
        name: "Maya Ortiz",
        kind: "person",
        contacts: [{ name: "Maya Ortiz", role: "primary_poc", email: "MAYA@example.com" }],
      } satisfies ClientInput,
      201,
    );
    const lead = await seed(intake());
    const detail = await admin.get<Lead>(`/api/leads/${lead}`);
    expect(detail.duplicates).toEqual([
      expect.objectContaining({ reason: "email", lead: null, client: { id: created.id, name: "Maya Ortiz" } }),
    ]);
  });
});

describe("cross-owner duplicates (FLOW-110, Q-41c)", () => {
  it("hides every indication of cross-owner matches from salespeople (FLOW-38)", async () => {
    const sues = await seed(intake(), people.sue);
    const sams = await seed(thumbtack(), people.sam);
    const detail = await sam.get<Lead>(`/api/leads/${sams}`);
    expect(detail.duplicates).toEqual([]);
    expect(detail.assignedElsewhere).toBe(false);
    expect(JSON.stringify(detail)).not.toContain(sues);
    expect(await sam.get<LeadDuplicate[]>("/api/leads/duplicates")).toEqual([]);
    // The same holds the other way round.
    const suesView = await sue.get<Lead>(`/api/leads/${sues}`);
    expect(suesView).toMatchObject({ duplicates: [], assignedElsewhere: false });
    expect(JSON.stringify(suesView)).not.toContain(sams);

    const queue = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    expect(queue).toEqual([
      expect.objectContaining({
        crossOwner: true,
        lead: expect.objectContaining({ id: sams }),
        matchedLead: expect.objectContaining({ id: sues }),
      }),
    ]);
    expect(await manager.get<LeadDuplicate[]>("/api/leads/duplicates")).toHaveLength(1);
    expect(
      (await sam.call("POST", `/api/leads/duplicates/${queue[0].id}/merge`, { keepLeadId: sams }))
        .status,
    ).toBe(404);
    expect((await sam.call("POST", `/api/leads/duplicates/${queue[0].id}/dismiss`)).status).toBe(
      404,
    );
  });

  it("lets a salesperson resolve duplicates among their own leads", async () => {
    await seed(intake(), people.sam);
    const second = await seed(thumbtack(), people.sam);
    const [duplicate] = await sam.get<LeadDuplicate[]>("/api/leads/duplicates");
    expect(duplicate.crossOwner).toBe(false);
    const kept = await sam.post<Lead>(`/api/leads/duplicates/${duplicate.id}/merge`, {
      keepLeadId: second,
    });
    expect(kept.id).toBe(second);
    expect(kept.assignedElsewhere).toBe(false);
  });
});

describe("merge (FLOW-110)", () => {
  it("keeps both source links and raw payloads on the surviving lead (AC3)", async () => {
    const bark = await seed(intake({ guestCount: 80 }));
    const tt = await seed(thumbtack({ guestCount: null, eventDate: null }));
    const [duplicate] = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    const kept = await admin.post<Lead>(`/api/leads/duplicates/${duplicate.id}/merge`, {
      keepLeadId: tt,
    });
    expect(kept.sourceLinks?.map((link) => [link.source, link.sourceLeadId])).toEqual([
      ["Thumbtack", "tt-1"],
      ["Bark", "bark-1"],
    ]);
    const merged = kept.sourceLinks?.find((link) => link.leadId === bark);
    expect(merged).toMatchObject({ mergedBy: people.admin });
    expect(merged?.mergedAt).toBeTruthy();
    // Details only the merged lead had move to the kept one.
    expect(kept).toMatchObject({ guestCount: 80, eventDate: "2026-11-14", phone: "(202) 555-0142" });
    const [archived] = await db.select().from(leads).where(eq(leads.id, bark));
    expect(archived).toMatchObject({ mergedIntoLeadId: tt, rawPayload: { site: "bark" } });
    expect(archived.archivedAt).not.toBeNull();
    expect((await admin.call("GET", `/api/leads/${bark}`)).status).toBe(404);
    expect((await admin.get<Lead[]>("/api/leads")).map((lead) => lead.id)).toEqual([tt]);
    expect(await admin.get<LeadDuplicate[]>("/api/leads/duplicates")).toEqual([]);
    const types = (await db.select({ type: jobs.type }).from(jobs)).map((j) => j.type);
    expect(types).toContain("event:lead.merged");
  });

  it("moves the merged lead's other duplicates to the kept lead", async () => {
    const a = await seed(intake());
    const b = await seed(thumbtack());
    const c = await seed(thumbtack({ source: "WeddingPro", sourceLeadId: "wp-1" }));
    const pairs = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    const ab = pairs.find((p) => p.lead.id === b && p.matchedLead?.id === a)!;
    await admin.post(`/api/leads/duplicates/${ab.id}/merge`, { keepLeadId: a });
    const remaining = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    expect(remaining.map((p) => [p.lead.id, p.matchedLead?.id])).toEqual([[c, a]]);
    const [second] = remaining;
    const kept = await admin.post<Lead>(`/api/leads/duplicates/${second.id}/merge`, {
      keepLeadId: a,
    });
    expect(kept.sourceLinks?.map((link) => link.leadId).sort()).toEqual([a, b, c].sort());
  });

  it("keeps a converted lead and refuses to merge it away", async () => {
    const converted = await seed(intake());
    const fresh = await seed(thumbtack());
    await db.update(leads).set({ status: "converted" }).where(eq(leads.id, converted));
    const [duplicate] = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    const refused = await admin.call("POST", `/api/leads/duplicates/${duplicate.id}/merge`, {
      keepLeadId: fresh,
    });
    expect(refused.status).toBe(409);
    expect(
      (await admin.call("POST", `/api/leads/duplicates/${duplicate.id}/merge`, { keepLeadId: converted }))
        .status,
    ).toBe(200);
  });

  it("rejects keeping a lead outside the pair", async () => {
    await seed(intake());
    await seed(thumbtack());
    const outsider = await seed(intake({ source: "Eventective", sourceLeadId: "ev-1", email: "x@example.com", phone: "", name: "Someone Else" }));
    const [duplicate] = (await admin.get<LeadDuplicate[]>("/api/leads/duplicates")).filter(
      (p) => p.lead.id !== outsider,
    );
    expect(
      (await admin.call("POST", `/api/leads/duplicates/${duplicate.id}/merge`, { keepLeadId: outsider }))
        .status,
    ).toBe(400);
  });

  it("dismisses a match that isn't a duplicate", async () => {
    const first = await seed(intake());
    await seed(thumbtack());
    const [duplicate] = await admin.get<LeadDuplicate[]>("/api/leads/duplicates");
    expect((await admin.call("POST", `/api/leads/duplicates/${duplicate.id}/dismiss`)).status).toBe(204);
    expect(await admin.get<LeadDuplicate[]>("/api/leads/duplicates")).toEqual([]);
    expect((await admin.get<Lead>(`/api/leads/${first}`)).duplicates).toEqual([]);
    const [row] = await db.select().from(leadDuplicates);
    expect(row).toMatchObject({ status: "dismissed", resolvedBy: people.admin });
  });
});
