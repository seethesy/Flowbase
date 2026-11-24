import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Role } from "../../../shared/access";
import type { Client, FlowEvent } from "../../../shared/core-records";
import type { EventRoster } from "../../../shared/event-staff";
import type { StaffMember } from "../../../shared/staff";
import type { PayException, Payroll, StaffPay } from "../../../shared/staff-pay";
import type { DeleteResult } from "../../../shared/deletions";
import { deliver } from "../../../worker/notifications/fanout";
import { invalidatePolicy } from "../../../worker/records/settings/permissions";

// Staff directory, staff without accounts and the Payroll tab (FLOW-270) through
// the real API and database.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c2700000-0000-4000-8000-000000000001",
  tech: "c2700000-0000-4000-8000-000000000002",
  manager: "c2700000-0000-4000-8000-000000000003",
  casey: "c2700000-0000-4000-8000-000000000004",
};
const directory: [keyof typeof people, Role, string][] = [
  ["admin", "admin", "Avery Admin"],
  ["tech", "technical", "Toni Tech"],
  ["manager", "sales_manager", "Morgan Manager"],
  ["casey", "staff", "Casey Crew"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role] = directory.find(([name]) => name === who)!;
  const app = createApp({ withDb, resolveActor: async () => ({ userId: people[who], role }) });
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
  const send = async <T>(method: string, path: string, body?: unknown, status = method === "POST" ? 201 : 200) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs("admin");
const tech = signedInAs("tech");
const manager = signedInAs("manager");
const casey = signedInAs("casey");

const tables = sql`truncate table staff_pay, staff_pay_exceptions, deletions, notifications, sms_outbox, activity_sessions, event_staff_slots, event_shifts, audit_log, events, client_contacts, clients, jobs, role_permissions, users cascade`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  invalidatePolicy();
  await db.insert(schema.users).values(
    directory.map(([key, role, name], i) => ({
      id: people[key],
      email: `${key}@payroll.example`,
      name,
      role,
      mobile: `20255580${i}`,
      status: "active" as const,
    })),
  );
});
afterAll(async () => {
  // Other suites delete users; leave no slot pointing at one.
  await db.execute(tables);
  await client.end();
});

const addNoAccount = (name = "Riley Runner") =>
  admin.send<StaffMember>("POST", "/api/staff", { name, mobile: "2025550199", positions: [] });

describe("staff without accounts (AC4)", () => {
  it("an Admin adds one: blank role, no email, listed in the directory but not in Settings › Users", async () => {
    const riley = await addNoAccount();
    expect(riley).toMatchObject({ name: "Riley Runner", role: null, hasAccount: false, email: "", status: "active", active: true });
    const listed = await casey.send<StaffMember[]>("GET", "/api/staff");
    expect(listed.find((member) => member.id === riley.id)).toMatchObject({ role: null, hasAccount: false });
    const users = await admin.send<{ id: string }[]>("GET", "/api/admin/users");
    expect(users.map((user) => user.id)).not.toContain(riley.id);
    // Only an Admin adds staff.
    expect((await tech.call("POST", "/api/staff", { name: "Someone" })).status).toBe(403);
    // A second person without an email doesn't collide with the first.
    expect((await addNoAccount("Sky Server")).hasAccount).toBe(false);
  });

  it("keeps their role blank and lets an Admin mark them Inactive", async () => {
    const riley = await addNoAccount();
    expect((await admin.call("PATCH", `/api/staff/${riley.id}`, { role: "staff" })).status).toBe(409);
    const inactive = await admin.send<StaffMember>("PATCH", `/api/staff/${riley.id}`, { status: "deactivated" });
    expect(inactive).toMatchObject({ status: "deactivated", active: false });
    // People with an account change status in Settings › Users.
    expect((await admin.call("PATCH", `/api/staff/${people.casey}`, { status: "deactivated" })).status).toBe(409);
  });

  it("can be assigned to an event shift", async () => {
    const riley = await addNoAccount();
    const { id: clientId } = await admin.send<Client>("POST", "/api/clients", { name: "Juniper & Co.", kind: "organization", contacts: [] });
    const event = await admin.send<FlowEvent>("POST", "/api/events", {
      title: "Spring gala", date: "2027-05-01", startTime: "18:00", endTime: "23:00", clientId,
    });
    let roster = await admin.send<EventRoster>("POST", `/api/events/${event.id}/shifts`, {
      kind: "event_day", date: "2027-05-01", startTime: "16:00", endTime: "23:30",
    });
    roster = await admin.send<EventRoster>("POST", `/api/events/${event.id}/slots`, {
      shiftId: roster.shifts[0].id, position: "Server", department: "service", count: 1,
    });
    const slot = roster.shifts[0].slots[0];
    roster = await admin.send<EventRoster>("PATCH", `/api/events/${event.id}/slots/${slot.id}`, { assigneeId: riley.id });
    expect(roster.shifts[0].slots[0].assignee).toEqual({ id: riley.id, name: "Riley Runner" });
    // Delete skips people on upcoming shifts, and your own account (FLOW-260 rules).
    const result = await admin.send<DeleteResult>("POST", "/api/deletions/staff_member", {
      ids: [riley.id, people.admin, people.manager],
    }, 200);
    expect(result.deleted).toEqual([people.manager]);
    expect(result.skipped.map((row) => [row.id, row.reason]).sort()).toEqual(
      [[people.admin, "is your own account"], [riley.id, "is on upcoming shifts"]].sort(),
    );
  });

  it("never receives notifications", async () => {
    const riley = await addNoAccount();
    const [job] = await db.insert(schema.jobs).values({ type: "event:test", payload: {}, idempotencyKey: "no-account" }).returning();
    const created = await deliver(db, job, "task_assigned", [
      { userId: riley.id, title: "A task", body: "", link: null },
      { userId: people.casey, title: "A task", body: "", link: null },
    ]);
    expect(created).toBe(1);
    const rows = await db.select().from(schema.notifications);
    expect(rows.map((row) => row.userId)).toEqual([people.casey]);
  });
});

describe("pay (AC1, AC2)", () => {
  it("Admin and Technical see and edit pay and exceptions; the changes persist", async () => {
    const saved = await tech.send<StaffPay>("PUT", "/api/staff-pay", {
      staffFullName: "Casey Crew", payType: "hourly", rateCents: 2500, secondRateCents: 2800, secondRateLabel: "bartender",
    });
    expect(saved).toMatchObject({ payType: "hourly", rateCents: 2500, rateUnit: "hour", secondRateCents: 2800 });
    await admin.send<StaffPay>("PUT", "/api/staff-pay", {
      staffFullName: "Casey Crew", payType: "per_event", rateCents: 20000, secondRateCents: null, secondRateLabel: "",
    });
    const { id: clientId } = await admin.send<Client>("POST", "/api/clients", { name: "Juniper & Co.", kind: "organization", contacts: [] });
    const event = await admin.send<FlowEvent>("POST", "/api/events", {
      title: "Fall gala", date: "2027-05-02", startTime: "18:00", endTime: "23:00", clientId,
    });
    const forEvent = await tech.send<PayException>("POST", "/api/staff-pay/exceptions", {
      staffFullName: "Casey Crew", eventId: event.id, amountCents: 30000, note: "Lead server",
    });
    expect(forEvent).toMatchObject({ eventTitle: "Fall gala", project: null, amountCents: 30000 });
    const forProject = await admin.send<PayException>("POST", "/api/staff-pay/exceptions", {
      staffFullName: "Casey Crew", project: "Warehouse move", amountCents: 15000,
    });
    // An exception names an event or a project, not both or neither.
    expect((await admin.call("POST", "/api/staff-pay/exceptions", { staffFullName: "Casey Crew", amountCents: 1 })).status).toBe(400);
    await tech.send("PATCH", `/api/staff-pay/exceptions/${forProject.id}`, { amountCents: 16000 });
    await admin.send("DELETE", `/api/staff-pay/exceptions/${forEvent.id}`);
    // Hours from time tracking.
    await db.insert(schema.activitySessions).values({
      userId: people.casey, clientSessionId: "c2700000-0000-4000-8000-0000000000aa",
      startedAt: new Date("2026-11-03T15:00:00Z"), endedAt: new Date("2026-11-03T17:30:00Z"), activity: "event",
    });
    const payroll = await tech.send<Payroll>("GET", "/api/staff-pay?from=2026-11-01&to=2026-11-30");
    expect(payroll.rows.find((row) => row.staffFullName === "Casey Crew")).toMatchObject({
      staffId: people.casey, payType: "per_event", rateCents: 20000, rateUnit: "event", workedSeconds: 9000,
    });
    expect(payroll.exceptions).toEqual([expect.objectContaining({ project: "Warehouse move", amountCents: 16000 })]);
    // Every change is audit-logged.
    const audit = await db.select().from(schema.auditLog).where(sql`${schema.auditLog.entityType} in ('staff_pay', 'staff_pay_exception')`);
    expect(audit.map((row) => `${row.entityType}:${row.action}`).sort()).toEqual([
      "staff_pay:create", "staff_pay:update",
      "staff_pay_exception:archive", "staff_pay_exception:create", "staff_pay_exception:create", "staff_pay_exception:update",
    ]);
  });

  it("every other role gets no Payroll and no pay fields", async () => {
    await admin.send("PUT", "/api/staff-pay", {
      staffFullName: "Casey Crew", payType: "hourly", rateCents: 2500, secondRateCents: null, secondRateLabel: "",
    });
    for (const who of [manager, casey]) {
      expect((await who.call("GET", "/api/staff-pay")).status).toBe(403);
      expect((await who.call("PUT", "/api/staff-pay", { staffFullName: "Casey Crew", payType: null, rateCents: null, secondRateCents: null })).status).toBe(403);
      const response = await who.call("GET", "/api/staff");
      const text = await response.text();
      expect(text).not.toMatch(/payType|payRate|rateCents/);
      const one = await (await who.call("GET", `/api/staff/${people.casey}`)).text();
      expect(one).not.toMatch(/payType|payRate/);
    }
    const seenByTech = await tech.send<StaffMember[]>("GET", "/api/staff");
    expect(seenByTech.find((member) => member.id === people.casey)).toMatchObject({ payType: "hourly", payRate: "$25.00 / hr" });
  });

  it("links pay by full name: a rename moves it, and two staff can't share a name", async () => {
    await admin.send("PUT", "/api/staff-pay", {
      staffFullName: "Casey Crew", payType: "hourly", rateCents: 2500, secondRateCents: null, secondRateLabel: "",
    });
    await admin.send("POST", "/api/staff-pay/exceptions", { staffFullName: "Casey Crew", project: "Inventory day", amountCents: 9000 });
    await admin.send<StaffMember>("PATCH", `/api/staff/${people.casey}`, { name: "Casey Crewe" });
    const payroll = await admin.send<Payroll>("GET", "/api/staff-pay?from=2026-11-01&to=2026-11-30");
    expect(payroll.rows.find((row) => row.staffId === people.casey)).toMatchObject({ staffFullName: "Casey Crewe", rateCents: 2500 });
    expect(payroll.exceptions[0].staffFullName).toBe("Casey Crewe");
    expect((await admin.call("PATCH", `/api/staff/${people.manager}`, { name: "casey crewe" })).status).toBe(409);
    expect((await admin.call("POST", "/api/staff", { name: "Casey Crewe" })).status).toBe(409);
  });
});

describe("roles in the directory (A5)", () => {
  it("Technical changes roles but never grants or removes Admin; others can't", async () => {
    expect((await tech.send<StaffMember>("PATCH", `/api/staff/${people.casey}`, { role: "kitchen_staff" })).role).toBe("kitchen_staff");
    expect((await tech.call("PATCH", `/api/staff/${people.casey}`, { role: "admin" })).status).toBe(403);
    expect((await tech.call("PATCH", `/api/staff/${people.admin}`, { role: "staff" })).status).toBe(403);
    // Technical still can't change other profile fields.
    expect((await tech.call("PATCH", `/api/staff/${people.casey}`, { notes: "x" })).status).toBe(403);
    expect((await manager.call("PATCH", `/api/staff/${people.casey}`, { role: "staff" })).status).toBe(403);
  });
});

it("seeds Technical's Staff pay level at Write", async () => {
  // The built-in level, with nothing stored.
  const { matrix } = await admin.send<{ matrix: Record<string, Record<string, string>> }>("GET", "/api/permissions");
  expect(matrix.technical.staff_pay).toBe("write");
  // The migration moves a stored None (the old seed) to Write.
  await db
    .insert(schema.rolePermissions)
    .values({ role: "technical", area: "staff_pay", level: "none" })
    .onConflictDoUpdate({ target: [schema.rolePermissions.role, schema.rolePermissions.area], set: { level: "none" } });
  const migration = readFileSync("drizzle/0072_flow_270_staff_pay.sql", "utf8");
  await db.execute(sql.raw(migration.slice(migration.indexOf("UPDATE \"role_permissions\""))));
  const [row] = await db.select().from(schema.rolePermissions)
    .where(sql`${schema.rolePermissions.role} = 'technical' and ${schema.rolePermissions.area} = 'staff_pay'`);
  expect(row?.level).toBe("write");
  invalidatePolicy();
});
