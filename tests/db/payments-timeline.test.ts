import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { EventHub } from "../../shared/event-hub";
import type { EventTimeline } from "../../shared/event-timeline";
import type { EventPayments } from "../../shared/payments";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { emitPaymentReminders } from "../../worker/records/payments";

// The event timeline (FLOW-126), payment schedule and log (FLOW-131) and payment
// reminders and overdue (FLOW-132) through the real API and database.

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1260000-0000-4000-8000-000000000001",
  sam: "c1260000-0000-4000-8000-000000000002",
  pat: "c1260000-0000-4000-8000-000000000003",
  casey: "c1260000-0000-4000-8000-000000000004",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["sam", "salesperson", "full_time"],
  // A part-time salesperson: assigned to an event, but not FT+ (FLOW-131 AC3).
  ["pat", "salesperson", "part_time"],
  ["casey", "staff", "full_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const app = createApp({
    withDb,
    resolveActor: async () => ({ userId: people[who], role, employmentType }),
  });
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
  const send = async <T>(
    method: string,
    path: string,
    body?: unknown,
    status = method === "POST" ? 201 : 200,
  ) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs("admin");
const sam = signedInAs("sam");
const pat = signedInAs("pat");

const tables = sql`truncate table consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users`;
// The vendors this suite adds. Other tables point at vendors, so they can't be
// truncated here; the timeline entries that name them are gone after the truncate.
const partnerNames = ["DJ Nova (FLOW-126)", "Food Co (FLOW-126)"];
const dropPartners = () =>
  db.delete(schema.vendors).where(inArray(schema.vendors.name, partnerNames));
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await dropPartners();
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@pay.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255591${i}`,
      status: "active" as const,
    })),
  );
});
afterAll(async () => {
  await db.execute(tables);
  await dropPartners();
  await client.end();
});

const newEvent = async (title: string, date = "2026-11-14") => {
  const owner = await sam.send<Client>("POST", "/api/clients", {
    name: `Client of ${title}`,
    kind: "organization",
    contacts: [],
  });
  const event = await sam.send<FlowEvent>("POST", "/api/events", {
    title,
    date,
    startTime: "18:00",
    endTime: "23:00",
    clientId: owner.id,
  });
  await db
    .update(schema.events)
    .set({ assignedSalespersonId: people.sam })
    .where(eq(schema.events.id, event.id));
  return event;
};
const entry = (date: string, startTime: string, endTime: string, activity: string, extra = {}) => ({
  kind: "event",
  date,
  startTime,
  endTime,
  activity,
  ...extra,
});
const timelineOf = (event: FlowEvent) =>
  sam.send<EventTimeline>("GET", `/api/events/${event.id}/timeline`);
const paymentsOf = (event: FlowEvent, as = sam) =>
  as.send<EventPayments>("GET", `/api/events/${event.id}/payments`);

describe("event timeline (FLOW-126)", () => {
  it("shows two days in order, each in start order (AC1)", async () => {
    const event = await newEvent("Fall gala");
    const path = `/api/events/${event.id}/timeline`;
    await sam.send("POST", path, entry("2026-11-14", "21:00", "22:00", "Cake cutting"));
    await sam.send("POST", path, entry("2026-11-13", "09:00", "11:00", "Pull rentals", { kind: "production" }));
    await sam.send("POST", path, entry("2026-11-14", "16:00", "17:30", "Guest arrival"));
    const timeline = await timelineOf(event);
    expect(timeline.days.map((day) => day.date)).toEqual(["2026-11-13", "2026-11-14"]);
    expect(timeline.days[0].entries.map((e) => e.activity)).toEqual(["Pull rentals"]);
    expect(timeline.days[1].entries.map((e) => e.activity)).toEqual([
      "Guest arrival",
      "Cake cutting",
    ]);
    expect(timeline.days[1].isEventDay).toBe(true);
  });

  it("lets an outside event partner be who without being a user (AC2)", async () => {
    const event = await newEvent("Fall gala");
    const [dj] = await db
      .insert(schema.vendors)
      .values({ name: "DJ Nova (FLOW-126)", type: "event_partner" })
      .returning();
    const saved = await sam.send<EventTimeline>(
      "POST",
      `/api/events/${event.id}/timeline`,
      entry("2026-11-14", "19:00", "23:00", "Music", {
        who: { type: "vendor", vendorId: dj.id },
      }),
    );
    const music = saved.days.flatMap((d) => d.entries).find((e) => e.activity === "Music");
    expect(music?.who).toEqual({ type: "vendor", id: dj.id, name: "DJ Nova (FLOW-126)" });
    // Only event partners qualify: a food distributor is refused.
    const [food] = await db
      .insert(schema.vendors)
      .values({ name: "Food Co (FLOW-126)", type: "food_distributor" })
      .returning();
    const refused = await sam.call(
      "POST",
      `/api/events/${event.id}/timeline`,
      entry("2026-11-14", "19:00", "20:00", "Delivery", {
        who: { type: "vendor", vendorId: food.id },
      }),
    );
    expect(refused.status).toBe(400);
  });

  it("names a staff member or a role, and rejects a role not on the list", async () => {
    const event = await newEvent("Fall gala");
    const path = `/api/events/${event.id}/timeline`;
    const staffed = await sam.send<EventTimeline>(
      "POST",
      path,
      entry("2026-11-14", "17:00", "18:00", "Door", { who: { type: "staff", userId: people.casey } }),
    );
    expect(staffed.days[0].entries[0].who).toMatchObject({ type: "staff", name: "Casey" });
    await sam.send(
      "POST",
      path,
      entry("2026-11-14", "18:00", "19:00", "Passed apps", { who: { type: "role", label: "Server" } }),
    );
    const bad = await sam.call(
      "POST",
      path,
      entry("2026-11-14", "18:00", "19:00", "Mystery", { who: { type: "role", label: "Wizard" } }),
    );
    expect(bad.status).toBe(400);
  });

  it("edits and removes an entry, with an audit row each time", async () => {
    const event = await newEvent("Fall gala");
    const created = await sam.send<EventTimeline>(
      "POST",
      `/api/events/${event.id}/timeline`,
      entry("2026-11-14", "16:00", "17:00", "Guest arrival"),
    );
    const id = created.days[0].entries[0].id;
    const edited = await sam.send<EventTimeline>(
      "PUT",
      `/api/events/${event.id}/timeline/${id}`,
      entry("2026-11-14", "16:30", "17:30", "Guest arrival and welcome drink"),
    );
    expect(edited.days[0].entries[0]).toMatchObject({
      startTime: "16:30",
      activity: "Guest arrival and welcome drink",
    });
    const removed = await sam.send<EventTimeline>(
      "POST",
      `/api/events/${event.id}/timeline/${id}/archive`,
      {},
      200,
    );
    expect(removed.days.flatMap((d) => d.entries)).toEqual([]);
    const actions = await db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, id));
    expect(actions.map((a) => a.action).sort()).toEqual(["archive", "create", "update"]);
  });

  it("rejects an entry that ends when it starts, and an area the event doesn't have", async () => {
    const event = await newEvent("Fall gala");
    const path = `/api/events/${event.id}/timeline`;
    expect((await sam.call("POST", path, entry("2026-11-14", "16:00", "16:00", "Nothing"))).status).toBe(400);
    expect(
      (await sam.call("POST", path, entry("2026-11-14", "16:00", "17:00", "Toast", { where: "Moon" }))).status,
    ).toBe(400);
  });

  it("is on the hub for everyone who can open the event", async () => {
    const event = await newEvent("Fall gala");
    const hub = await sam.send<EventHub>("GET", `/api/events/${event.id}/hub`);
    expect(hub.sections).toContain("timeline");
  });
});

describe("payment schedule and log (FLOW-131)", () => {
  it("shows a $3,500 balance on $5,000 with a $1,500 deposit paid (AC1)", async () => {
    const event = await newEvent("Fall gala");
    const base = `/api/events/${event.id}/payments`;
    await sam.send("POST", `${base}/schedule`, {
      kind: "deposit",
      label: "Deposit",
      amountCents: 150_000,
      dueDate: "2027-01-10",
    });
    await sam.send("POST", `${base}/schedule`, {
      kind: "balance",
      label: "Balance",
      amountCents: 350_000,
      dueDate: "2027-02-10",
    });
    const paid = await sam.send<EventPayments>("POST", base, {
      method: "zelle",
      amountCents: 150_000,
      receivedOn: "2026-11-01",
      reference: "ZEL-8841",
    });
    expect(paid).toMatchObject({
      totalCents: 500_000,
      paidCents: 150_000,
      balanceCents: 350_000,
      overdueCount: 0,
    });
    expect(paid.payments[0]).toMatchObject({
      method: "zelle",
      reference: "ZEL-8841",
      recordedBy: { id: people.sam, name: "Sam" },
    });
  });

  it("rejects a full card number in the reference (AC2)", async () => {
    const event = await newEvent("Fall gala");
    const response = await sam.call("POST", `/api/events/${event.id}/payments`, {
      method: "card",
      amountCents: 10_000,
      receivedOn: "2026-11-01",
      reference: "4242 4242 4242 4242",
    });
    expect(response.status).toBe(400);
    expect((await paymentsOf(event)).payments).toEqual([]);
  });

  it("hides amounts from part-time users, even the event's own salesperson (AC3)", async () => {
    const event = await newEvent("Fall gala");
    await sam.send("POST", `/api/events/${event.id}/payments/schedule`, {
      kind: "deposit",
      amountCents: 150_000,
      dueDate: "2027-01-10",
    });
    await db
      .update(schema.events)
      .set({ assignedSalespersonId: people.pat })
      .where(eq(schema.events.id, event.id));
    const read = await pat.call("GET", `/api/events/${event.id}/payments`);
    expect(read.status).toBe(403);
    expect(await read.text()).not.toContain("150000");
    const write = await pat.call("POST", `/api/events/${event.id}/payments`, {
      method: "cash",
      amountCents: 100,
      receivedOn: "2026-11-01",
    });
    expect(write.status).toBe(403);
    const hub = await pat.send<EventHub>("GET", `/api/events/${event.id}/hub`);
    expect(hub.sections).not.toContain("payments");
  });

  it("shows payments to Admin and to the event's FT salesperson, not to other salespeople", async () => {
    const event = await newEvent("Fall gala");
    expect((await admin.call("GET", `/api/events/${event.id}/payments`)).status).toBe(200);
    expect((await sam.call("GET", `/api/events/${event.id}/payments`)).status).toBe(200);
    const hub = await sam.send<EventHub>("GET", `/api/events/${event.id}/hub`);
    expect(hub.sections).toContain("payments");
  });

  it("emits payment.recorded once, in the same transaction as the payment", async () => {
    const event = await newEvent("Fall gala");
    await sam.send("POST", `/api/events/${event.id}/payments`, {
      method: "check",
      amountCents: 25_000,
      receivedOn: "2026-11-01",
      reference: "check #1042",
    });
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "event:payment.recorded"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ eventId: event.id, amountCents: 25_000 });
  });

  it("removes a mistaken payment and recalculates the balance", async () => {
    const event = await newEvent("Fall gala");
    const base = `/api/events/${event.id}/payments`;
    await sam.send("POST", `${base}/schedule`, {
      kind: "balance",
      amountCents: 100_000,
      dueDate: "2027-01-10",
    });
    const paid = await sam.send<EventPayments>("POST", base, {
      method: "cash",
      amountCents: 40_000,
      receivedOn: "2026-11-01",
    });
    expect(paid.balanceCents).toBe(60_000);
    const undone = await sam.send<EventPayments>(
      "POST",
      `${base}/${paid.payments[0].id}/archive`,
      {},
      200,
    );
    expect(undone.balanceCents).toBe(100_000);
  });
});

describe("payment reminders and overdue (FLOW-132)", () => {
  const today = () => utcToBusinessTime(new Date()).date;

  it("flags a past-due item with no matching payment as overdue (AC2)", async () => {
    const event = await newEvent("Fall gala");
    const base = `/api/events/${event.id}/payments`;
    await sam.send("POST", `${base}/schedule`, {
      kind: "deposit",
      amountCents: 150_000,
      dueDate: addLocalDays(today(), -1),
    });
    const page = await paymentsOf(event);
    expect(page.overdueCount).toBe(1);
    expect(page.overdueCents).toBe(150_000);
    expect(page.schedule[0].overdue).toBe(true);
    const cleared = await sam.send<EventPayments>("POST", base, {
      method: "ach",
      amountCents: 150_000,
      receivedOn: today(),
    });
    expect(cleared.overdueCount).toBe(0);
  });

  it("queues one reminder for the salesperson when a payment is due in 3 days (AC1)", async () => {
    const event = await newEvent("Fall gala");
    await sam.send("POST", `/api/events/${event.id}/payments/schedule`, {
      kind: "balance",
      label: "Balance",
      amountCents: 350_000,
      dueDate: "2026-11-07",
    });
    // Noon in New York on Nov 4, 2026: three days before the due date.
    const now = new Date("2026-11-04T17:00:00Z");
    await emitPaymentReminders(db, now);
    await emitPaymentReminders(db, now);
    await emitPaymentReminders(db, new Date("2026-11-04T21:00:00Z"));
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "event:payment.due"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({
      recipientIds: [people.sam],
      link: `/events/${event.id}`,
    });
  });

  it("sends nothing before the window opens or once the item is paid", async () => {
    const event = await newEvent("Fall gala");
    const base = `/api/events/${event.id}/payments`;
    await sam.send("POST", `${base}/schedule`, {
      kind: "balance",
      amountCents: 100_000,
      dueDate: "2026-11-07",
    });
    await emitPaymentReminders(db, new Date("2026-11-03T17:00:00Z"));
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:payment.due"))).toHaveLength(0);
    await sam.send("POST", base, { method: "wire", amountCents: 100_000, receivedOn: "2026-11-03" });
    await emitPaymentReminders(db, new Date("2026-11-04T17:00:00Z"));
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:payment.due"))).toHaveLength(0);
  });

  it("queues one overdue notice per item once it is past due", async () => {
    const event = await newEvent("Fall gala");
    await sam.send("POST", `/api/events/${event.id}/payments/schedule`, {
      kind: "balance",
      amountCents: 100_000,
      dueDate: "2026-11-07",
    });
    const later = new Date("2026-11-09T17:00:00Z");
    await emitPaymentReminders(db, later);
    await emitPaymentReminders(db, new Date("2026-11-10T17:00:00Z"));
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "event:payment.overdue"));
    expect(jobs).toHaveLength(1);
  });

  it("follows the reminder days in the business settings", async () => {
    const event = await newEvent("Fall gala");
    await sam.send("POST", `/api/events/${event.id}/payments/schedule`, {
      kind: "balance",
      amountCents: 100_000,
      dueDate: "2026-11-14",
    });
    // Settings outlive the truncate above, so put the default back afterwards.
    try {
      await admin.send("PUT", "/api/settings/defaults", await defaultsWith(7), 200);
      await emitPaymentReminders(db, new Date("2026-11-07T17:00:00Z"));
      expect(await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:payment.due"))).toHaveLength(1);
    } finally {
      await admin.send("PUT", "/api/settings/defaults", await defaultsWith(3), 200);
    }
  });
});

async function defaultsWith(paymentReminderDays: number) {
  const current = await admin.send<{ defaults: Record<string, unknown> }>("GET", "/api/settings");
  return { ...current.defaults, paymentReminderDays };
}
