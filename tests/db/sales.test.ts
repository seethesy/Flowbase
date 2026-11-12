import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import * as s from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { Actor, Role } from "../../shared/access";
import type { RunWithDb } from "../../worker/hono";
import { seedUsers } from "../../worker/db/seed";
import { salesClientSchema, salesDataSchema, salesReportSchema } from "../../shared/sales";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: s });
const withDb: RunWithDb = (_env, run) => run(db);
const admin = seedUsers.find((row) => row.role === "admin")!;
const salespeople = seedUsers.filter((row) => row.role === "salesperson");
const actor = (id: string, role: Role): Actor => ({ userId: id, role, employmentType: "full_time" });
const call = (id: string, role: Role, path: string, init?: RequestInit) => createApp({ withDb, resolveActor: async () => actor(id, role) }).request(path, init, { ASSETS: { fetch } });
const ids = {
  client: "a0000000-0000-4000-8000-000000000001",
  events: [1, 2, 3].map((n) => `b0000000-0000-4000-8000-00000000000${n}`),
  proposals: [1, 2, 3].map((n) => `c0000000-0000-4000-8000-00000000000${n}`),
  versions: [1, 2, 3].map((n) => `d0000000-0000-4000-8000-00000000000${n}`),
};

beforeEach(async () => {
  await db.execute(sql`truncate table sales_views, proposal_version_mappings, proposal_mappings, proposal_versions, proposals, payments, payment_schedule_items, leads, events, clients cascade`);
  await db.insert(s.clients).values({ id: ids.client, name: "Aster", kind: "organization", assignedSalespersonId: salespeople[0].id });
  for (let i = 0; i < 3; i++) {
    const owner = i === 2 ? salespeople[1].id : salespeople[0].id;
    await db.insert(s.events).values({ id: ids.events[i], title: `Event ${i + 1}`, clientId: ids.client,
      startsAt: new Date(`2026-${i === 2 ? "12" : "11"}-${String(12 + i).padStart(2, "0")}T23:00:00Z`),
      status: i === 2 ? "preparation" : "finished", assignedSalespersonId: owner });
    await db.insert(s.proposals).values({ id: ids.proposals[i], eventId: ids.events[i], clientId: ids.client,
      title: `Proposal ${i + 1}`, stage: i === 0 ? "signed" : i === 1 ? "lost" : "finalized", assignedSalespersonId: owner });
    await db.insert(s.proposalVersions).values({ id: ids.versions[i], proposalId: ids.proposals[i], number: 1,
      status: "ready", completedAt: new Date(), docx: { key: `test-${i}`, fileName: `test-${i}.docx`, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 } });
    await db.update(s.proposals).set({ currentVersionId: ids.versions[i] }).where(eq(s.proposals.id, ids.proposals[i]));
    const totalCents = (i + 1) * 100_000;
    const data = { versionId: ids.versions[i], totalCents, fields: {}, lines: [], staffing: [], timeline: [], charges: [], paymentSchedule: [], unextractedBlockIds: [] };
    await db.insert(s.proposalMappings).values({ proposalId: ids.proposals[i], versionId: ids.versions[i], data });
    await db.insert(s.proposalVersionMappings).values({ versionId: ids.versions[i], data });
    await db.insert(s.paymentScheduleItems).values({ eventId: ids.events[i], kind: "balance", amountCents: totalCents, dueDate: "2026-12-20" });
    await db.insert(s.payments).values({ eventId: ids.events[i], method: "cash", amountCents: 20_000, receivedOn: "2026-11-10" });
    await db.insert(s.leads).values({ name: `Lead ${i}`, channel: "manual", source: i === 1 ? "Bark" : "Referral",
      status: "converted", assignedSalespersonId: owner, convertedClientId: ids.client, convertedEventId: ids.events[i] });
  }
});
afterAll(async () => { await db.execute(sql`truncate table sales_views`); await client.end(); });

describe("sales dataset (FLOW-117/118/121)", () => {
  it("updates the proposal stage and scopes a salesperson's rows", async () => {
    const before = salesDataSchema.parse(await (await call(admin.id, "admin", "/api/sales")).json());
    expect(before.rows.find((row) => row.id === ids.proposals[0])?.stage).toBe("signed");
    await db.update(s.proposals).set({ stage: "revisions" }).where(eq(s.proposals.id, ids.proposals[0]));
    const after = salesDataSchema.parse(await (await call(admin.id, "admin", "/api/sales")).json());
    expect(after.rows.find((row) => row.id === ids.proposals[0])?.stage).toBe("revisions");
    const own = salesDataSchema.parse(await (await call(salespeople[0].id, "salesperson", "/api/sales")).json());
    expect(own.rows.some((row) => row.id === ids.events[2] || row.id === ids.proposals[2])).toBe(false);
    expect(own.rows.find((row) => row.id === ids.proposals[0])?.totalCents).toBe(100_000);
    expect((await call(seedUsers.find((row) => row.role === "kitchen_staff")!.id, "kitchen_staff", "/api/sales")).status).toBe(403);
  });
  it("shows all statuses, balances and the booked lifetime total for a client", async () => {
    const result = salesClientSchema.parse(await (await call(admin.id, "admin", `/api/sales/clients/${ids.client}`)).json());
    expect(result.events.map((event) => event.status).sort()).toEqual(["finished", "finished", "preparation"]);
    expect(result.events.map((event) => event.balanceCents).sort()).toEqual([80_000, 180_000, 280_000]);
    expect(result.lifetimeBookedCents).toBe(600_000);
    expect(result.events.every((event) => event.proposals[0].versions[0].number === 1)).toBe(true);
  });
  it("aggregates stage, booked month and win rate within the owner's scope", async () => {
    const all = salesReportSchema.parse(await (await call(admin.id, "admin", "/api/sales/reports?from=2026-11-01&to=2026-12-31")).json());
    expect(all.pipeline.reduce((sum, row) => sum + row.count, 0)).toBe(3);
    expect(all.bookedByMonth.map((row) => [row.month, row.totalCents])).toEqual([["2026-11", 300_000], ["2026-12", 300_000]]);
    expect(all.winBySource.find((row) => row.source === "Referral")?.rate).toBe(1);
    const own = salesReportSchema.parse(await (await call(salespeople[0].id, "salesperson", "/api/sales/reports")).json());
    expect(own.pipeline.reduce((sum, row) => sum + row.count, 0)).toBe(2);
    expect(own.bookedByMonth).toEqual([{ month: "2026-11", count: 2, totalCents: 300_000 }]);
  });
  it("stores saved views per user", async () => {
    const response = await call(salespeople[0].id, "salesperson", "/api/sales/views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Mine", filter: { kind: "proposal" } }) });
    expect(response.status).toBe(201);
    const mine = await (await call(salespeople[0].id, "salesperson", "/api/sales/views")).json();
    const theirs = await (await call(salespeople[1].id, "salesperson", "/api/sales/views")).json();
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
  });
});
