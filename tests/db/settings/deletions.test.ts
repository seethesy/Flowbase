import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { auditLog, clients, deletions } from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Actor, Role } from "../../../shared/access";
import type { Client, FlowEvent } from "../../../shared/core-records";
import type { DeletedRecord, DeleteResult } from "../../../shared/deletions";

// Bulk delete with Undo (FLOW-260, A1): delete archives the record and opens a
// deletions row; blocked records are skipped with their reason; Undo and the
// Admin's Settings › Archived restore it.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const people: Record<"admin" | "sam" | "pat", Actor> = {
  admin: { userId: "d2600000-0000-4000-8000-000000000001", role: "admin" },
  sam: { userId: "d2600000-0000-4000-8000-000000000002", role: "salesperson" },
  pat: { userId: "d2600000-0000-4000-8000-000000000003", role: "staff" as Role },
};
const as = (who: keyof typeof people) => {
  const app = createApp({ withDb, resolveActor: async () => people[who] });
  return async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await app.request(
      path,
      {
        method,
        ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      },
      env,
    );
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
};
const admin = as("admin");
const sam = as("sam");
const pat = as("pat");
const newClient = (name: string) => admin<Client>("POST", "/api/clients", { name, kind: "organization", contacts: [] }, 201);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table deletions, closeout_lines, event_closeouts, truck_assignments, event_planning_outputs, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("FLOW-260 bulk delete", () => {
  it("deletes 3 clients in one request and Undo restores them (AC2)", async () => {
    const made = await Promise.all(["Alder", "Birch", "Cedar"].map(newClient));
    const ids = made.map((row) => row.id);
    const result = await admin<DeleteResult>("POST", "/api/deletions/client", { ids });
    expect(result).toEqual({ deleted: ids, skipped: [] });
    // Gone from the list and from Show archived; marked who and when.
    expect((await admin<Client[]>("GET", "/api/clients")).map((row) => row.id)).toEqual([]);
    expect((await admin<Client[]>("GET", "/api/clients?archived=true")).map((row) => row.id)).toEqual([]);
    const rows = await db.select().from(deletions);
    expect(rows.map((row) => [row.entityType, row.deletedBy, row.restoredAt])).toEqual(
      ids.map(() => ["client", people.admin.userId, null]),
    );
    // Audit-logged as an archive, through the client's own archive.
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, ids[0]))).map((row) => row.action)).toContain("archive");

    expect(await admin("POST", "/api/deletions/client/restore", { ids })).toEqual({ restored: expect.arrayContaining(ids) });
    expect((await admin<Client[]>("GET", "/api/clients")).map((row) => row.name).sort()).toEqual(["Alder", "Birch", "Cedar"]);
    expect((await db.select().from(deletions)).every((row) => row.restoredAt !== null)).toBe(true);
  });

  it("skips a client with events, with its reason, and deletes the rest (AC3)", async () => {
    const busy = await newClient("Ward & Co.");
    const idle = await newClient("Quiet Co.");
    await admin<FlowEvent>("POST", "/api/events", { title: "Holiday party", date: "2026-12-14", startTime: "18:00", clientId: busy.id }, 201);
    const result = await admin<DeleteResult>("POST", "/api/deletions/client", { ids: [busy.id, idle.id] });
    expect(result).toEqual({ deleted: [idle.id], skipped: [{ id: busy.id, name: "Ward & Co.", reason: "has events" }] });
    const [kept] = await db.select().from(clients).where(eq(clients.id, busy.id));
    expect(kept.archivedAt).toBeNull();
  });

  it("refuses Delete without edit rights (AC4) and more than 100 rows", async () => {
    const one = await newClient("Alder");
    await pat("POST", "/api/deletions/client", { ids: [one.id] }, 403);
    const many = Array.from({ length: 101 }, (_, i) => `d2600000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await admin("POST", "/api/deletions/client", { ids: many }, 400);
  });

  it("lets only the person who deleted it, or an Admin, restore; the Admin sees it in Archived (AC5)", async () => {
    const one = await newClient("Alder");
    await admin("POST", "/api/deletions/client", { ids: [one.id] });
    await sam("POST", "/api/deletions/client/restore", { ids: [one.id] }, 403);
    await sam("GET", "/api/deletions", undefined, 403);
    const archived = await admin<DeletedRecord[]>("GET", "/api/deletions");
    expect(archived).toEqual([
      expect.objectContaining({ entityType: "client", entityId: one.id, name: "Alder" }),
    ]);
    await admin("POST", "/api/deletions/client/restore", { ids: [one.id] });
    expect(await admin<DeletedRecord[]>("GET", "/api/deletions")).toEqual([]);
  });

  it("skips leads at Closing or Closed: they already have a client record", async () => {
    const lead = await admin<{ id: string }>("POST", "/api/leads", { source: "Referral", name: "Closing lead", email: "c@lead.example", phone: "", eventDate: null }, 201);
    await db.update(schema.leads).set({ status: "closing" }).where(eq(schema.leads.id, lead.id));
    const open = await admin<{ id: string }>("POST", "/api/leads", { source: "Referral", name: "Open lead", email: "o@lead.example", phone: "", eventDate: null }, 201);
    const result = await admin<DeleteResult>("POST", "/api/deletions/lead", { ids: [lead.id, open.id] });
    expect(result).toEqual({
      deleted: [open.id],
      skipped: [{ id: lead.id, name: "Closing lead", reason: "already has a client record" }],
    });
    await admin("POST", "/api/deletions/lead/restore", { ids: [open.id] });
    expect((await admin<{ id: string }[]>("GET", "/api/leads")).map((row) => row.id)).toContain(open.id);
  });
});
