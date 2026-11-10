import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { EmploymentType, Role } from "../../shared/access";
import type { ApprovalRequest } from "../../shared/approvals";
import type { BeoView } from "../../shared/beo";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { EventRoster } from "../../shared/event-staff";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";

// The BEO core (FLOW-143, 144, 148) through the real API, jobs and database.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c1500000-0000-4000-8000-000000000001",
  manager: "c1500000-0000-4000-8000-000000000002",
  sam: "c1500000-0000-4000-8000-000000000003",
  jamie: "c1500000-0000-4000-8000-000000000004",
  casey: "c1500000-0000-4000-8000-000000000005",
  kit: "c1500000-0000-4000-8000-000000000006",
  nora: "c1500000-0000-4000-8000-000000000007",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["sam", "salesperson", "full_time"],
  ["jamie", "staff", "part_time"],
  ["casey", "staff", "full_time"],
  ["kit", "kitchen_staff", "part_time"],
  ["nora", "staff", "part_time"],
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
  const send = async <T>(method: string, path: string, body?: unknown, status = method === "POST" ? 201 : 200) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs("admin");
const manager = signedInAs("manager");
const sam = signedInAs("sam");
const jamie = signedInAs("jamie");
const casey = signedInAs("casey");
const kit = signedInAs("kit");
const nora = signedInAs("nora");

const tables = sql`truncate table pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, sms_outbox, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, notifications, notification_preferences, approval_requests, settings, event_staff_slots, event_shifts, lead_duplicates, leads, audit_log, event_status_history, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs, users cascade`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    directory.map(([name, role, employmentType], i) => ({
      id: people[name],
      email: `${name}@beo.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      employmentType,
      mobile: `20255591${i}`,
      status: "active" as const,
      smsConsentAt: name === "jamie" ? new Date() : null,
    })),
  );
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const drain = async () => {
  const registry = createJobRegistry({ emailProvider: () => undefined });
  for (let i = 0; i < 20; i += 1)
    if (!(await runDueJobs(db, registry, { maxAttempts: 1 })).claimed) return;
};
const notificationsOf = (who: keyof typeof people) =>
  db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, people[who]), eq(schema.notifications.type, "beo_changed")));

// Tomorrow evening, always inside the next 48 hours; and a date well past them.
const soon = new Date(Date.now() + 20 * 3_600_000).toISOString().slice(0, 10);
const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

// An event with a client contact, a venue contact, a shift with a server (Jamie),
// a server who is a full-timer (Casey), a kitchen worker (Kit) and one open slot.
async function seed(date = later) {
  const owner = await sam.send<Client>("POST", "/api/clients", {
    name: "Juniper & Co.",
    kind: "organization",
    contacts: [{ name: "Pat Poc", role: "primary_poc", email: "pat@juniper.example", phone: "2025550100" }],
  });
  const event = await sam.send<FlowEvent>("POST", "/api/events", {
    title: "Fall gala",
    date,
    startTime: "18:00",
    endTime: "23:00",
    clientId: owner.id,
    pocContactId: owner.contacts[0].id,
    guestCount: 80,
    dressCode: "Black tie",
    assignedSalespersonId: people.sam,
  });
  const [venue] = await db.insert(schema.venues).values({ name: "The Atrium", address: "1 Main St" }).returning();
  await db.insert(schema.venueContacts).values({
    venueId: venue.id,
    name: "Vic Venue",
    role: "manager",
    email: "vic@atrium.example",
    phone: "2025550111",
  });
  await db.update(schema.events).set({ venueId: venue.id, address: "1 Main St" }).where(eq(schema.events.id, event.id));
  let roster = await sam.send<EventRoster>("POST", `/api/events/${event.id}/shifts`, {
    kind: "event_day",
    date,
    startTime: "16:00",
    endTime: "23:30",
  });
  roster = await sam.send<EventRoster>("POST", `/api/events/${event.id}/slots`, {
    shiftId: roster.shifts[0].id,
    position: "Server",
    department: "service",
    count: 4,
  });
  const slots = roster.shifts[0].slots;
  for (const [slot, who] of [
    [slots[0], "jamie"],
    [slots[1], "casey"],
    [slots[2], "kit"],
  ] as const)
    await sam.send<EventRoster>("PATCH", `/api/events/${event.id}/slots/${slot.id}`, { assigneeId: people[who] });
  return event;
}
const getBeo = (who: ReturnType<typeof signedInAs>, event: FlowEvent) =>
  who.send<BeoView>("GET", `/api/events/${event.id}/beo`);
const edit = async (event: FlowEvent, patch: Record<string, unknown>) => {
  const current = await sam.send<FlowEvent>("GET", `/api/events/${event.id}`);
  await sam.send<FlowEvent>("PUT", `/api/events/${event.id}`, {
    title: current.title,
    date: current.date,
    startTime: current.startTime,
    endTime: current.endTime,
    clientId: current.client.id,
    pocContactId: current.pocContactId,
    venueId: current.venue?.id ?? null,
    address: current.address,
    guestCount: current.guestCount,
    dressCode: current.dressCode,
    ...patch,
    updatedAt: current.updatedAt,
  });
};
const approved = async (event: FlowEvent) => {
  await sam.send<BeoView>("POST", `/api/events/${event.id}/beo`, {});
  return manager.send<BeoView>("POST", `/api/events/${event.id}/beo/approve`, {}, 200);
};

describe("FLOW-143: generating the BEO", () => {
  it("starts as working on, with the ten sections' data and open or TBD items marked (AC1, AC3)", async () => {
    const event = await seed();
    const [dish] = await db.insert(schema.recipes).values({ name: "Short rib", category: "Mains" }).returning();
    await sam.send("POST", `/api/events/${event.id}/kitchen-menu/lines`, { recipeId: dish.id, course: "Mains", plannedQuantity: null });
    const preview = await getBeo(sam, event);
    expect(preview).toMatchObject({ exists: false, status: null });
    const beo = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo`, {});
    expect(beo).toMatchObject({ exists: true, status: "working_on" });
    expect(Object.keys(beo.content)).toEqual([
      "header",
      "event",
      "summary",
      "foodSetup",
      "staff",
      "timeline",
      "equipment",
      "runOfShow",
      "layout",
      "setupCleanup",
      "notes",
    ]);
    expect(beo.content.event).toMatchObject({ title: "Fall gala", client: "Juniper & Co.", venue: "The Atrium" });
    expect(beo.content.summary).toMatchObject({ guestCount: 80, dressCode: "Black tie" });
    // AC3: one server slot is still open; the dish defaults to the guest count.
    expect(beo.content.staff.openSlots).toBe(1);
    expect(beo.content.staff.shifts[0].slots.filter((slot) => slot.open)).toHaveLength(1);
    expect(beo.content.foodSetup.courses[0].lines[0]).toMatchObject({ name: "Short rib", quantity: 80, tbd: false });
    expect(beo.content.foodSetup.tbdCount).toBe(0);
  });

  it("answers the same BEO when generated twice, and only for people who may edit the event", async () => {
    const event = await seed();
    const first = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo`, {});
    const second = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo`, {});
    expect(second.id).toBe(first.id);
    expect((await casey.call("POST", `/api/events/${event.id}/beo`, {})).status).toBe(403);
  });

  it("carries no price, cost or payment for any reader (AC2)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    for (const who of [admin, manager, sam, casey, jamie, kit])
      expect(JSON.stringify((await getBeo(who, event)).content)).not.toMatch(/price|cost|payment|amount/i);
  });
});

describe("FLOW-144: approval and changes after approval", () => {
  it("is approved by the Sales Manager through the approvals queue and emits beo.approved", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const asked = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo/request-approval`, {}, 200);
    expect(asked.status).toBe("pending_approval");
    const queue = await manager.send<ApprovalRequest[]>("GET", "/api/approvals?queue=true");
    const request = queue.find((row) => row.subjectType === "beo")!;
    expect(request.canDecide).toBe(true);
    // The salesperson cannot approve their own BEO.
    expect((await sam.call("POST", `/api/events/${event.id}/beo/approve`, {})).status).toBe(403);
    await manager.send("POST", `/api/approvals/${request.id}/approve`, {}, 200);
    const beo = await getBeo(sam, event);
    expect(beo).toMatchObject({ status: "approved" });
    expect(beo.approvedBy?.name).toBe("Manager");
    const emitted = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:beo.approved"));
    expect(emitted).toHaveLength(1);
  });

  it("lets the Sales Manager approve directly without asking anyone", async () => {
    const event = await seed();
    const beo = await approved(event);
    expect(beo.status).toBe("approved");
    expect(await db.select().from(schema.approvalRequests)).toHaveLength(1);
    await drain();
    // No approver was told about a request that was decided in the same breath.
    expect(
      await db.select().from(schema.notifications).where(eq(schema.notifications.type, "approval_requested")),
    ).toHaveLength(0);
  });

  it("a dress code change keeps it approved, marks the field and notifies assigned staff (AC1)", async () => {
    const event = await seed();
    await approved(event);
    await edit(event, { dressCode: "Cocktail" });
    const beo = await getBeo(sam, event);
    expect(beo.status).toBe("approved");
    expect(beo.changedFields.map((field) => field.key)).toEqual(["dress_code"]);
    expect(beo.changes[0]).toMatchObject({
      fieldKey: "dress_code",
      from: "Black tie",
      to: "Cocktail",
      changedBy: { id: people.sam },
      marked: true,
    });
    expect(beo.changes[0].changedAt).toBeTruthy();
    await drain();
    expect(await notificationsOf("jamie")).toHaveLength(1);
    expect(await notificationsOf("casey")).toHaveLength(1);
    expect(await notificationsOf("kit")).toHaveLength(1);
    expect(await notificationsOf("nora")).toHaveLength(0);
    expect(await notificationsOf("sam")).toHaveLength(0);
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:beo.changed_after_approval"))).toHaveLength(1);
  });

  it("a guest count change sends it back to working on until the next approval (AC2)", async () => {
    const event = await seed();
    await approved(event);
    await edit(event, { guestCount: 120 });
    let beo = await getBeo(sam, event);
    expect(beo.status).toBe("working_on");
    expect(beo.changedFields.map((field) => field.key)).toContain("guest_count");
    await drain();
    expect(await notificationsOf("jamie")).toHaveLength(1);
    // Approving again clears the marks and keeps the log.
    beo = await manager.send<BeoView>("POST", `/api/events/${event.id}/beo/approve`, {}, 200);
    expect(beo.status).toBe("approved");
    expect(beo.changedFields).toEqual([]);
    expect(beo.changes.map((change) => change.fieldKey)).toContain("guest_count");
  });

  it("does not log edits made before the first approval", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    await edit(event, { dressCode: "Cocktail" });
    const beo = await getBeo(sam, event);
    expect(beo.changes).toEqual([]);
    await drain();
    expect(await notificationsOf("jamie")).toHaveLength(0);
  });

  it("logs edits to the BEO's own notes and tells staff", async () => {
    const event = await seed();
    await approved(event);
    await sam.send("PUT", `/api/events/${event.id}/beo/cleanup`, {
      sections: [{ section: "Load-out", items: ["Strip linens", "Sweep floor"] }],
    });
    const beo = await sam.send<BeoView>(
      "PATCH",
      `/api/events/${event.id}/beo`,
      { additionalNotes: "Loading dock closes at 5." },
      200,
    );
    expect(beo.status).toBe("approved");
    expect(beo.changes.map((change) => change.fieldKey).sort()).toEqual(["additional_notes", "cleanup_checklist"]);
  });

  it("queues an SMS for opted-in staff when the change is within 48 hours (AC3)", async () => {
    const event = await seed(soon);
    await approved(event);
    await edit(event, { dressCode: "Cocktail" });
    await drain();
    const texts = await db.select().from(schema.smsOutbox);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ userId: people.jamie, status: "recorded", provider: "stub" });
    expect(texts[0].body).toContain("BEO changed");
  });

  it("sends no SMS when the event is further away", async () => {
    const event = await seed(later);
    await approved(event);
    await edit(event, { dressCode: "Cocktail" });
    await drain();
    expect(await db.select().from(schema.smsOutbox)).toHaveLength(0);
    expect(await notificationsOf("jamie")).toHaveLength(1);
  });

  it("is rejected back to working on with a reason", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    await sam.send("POST", `/api/events/${event.id}/beo/request-approval`, {}, 200);
    const [request] = await manager.send<ApprovalRequest[]>("GET", "/api/approvals?queue=true");
    await manager.send("POST", `/api/approvals/${request.id}/reject`, { comment: "Menu is incomplete" }, 200);
    expect((await getBeo(sam, event)).status).toBe("working_on");
  });
});

describe("FLOW-148: who sees the BEO and what", () => {
  it("shows a part-time server names and roles only (AC1)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const beo = await getBeo(jamie, event);
    expect(beo.content.event.contactHidden).toBe(true);
    for (const contact of [
      beo.content.event.pointOfContact!,
      ...beo.content.event.clientContacts,
      ...beo.content.event.venueContacts,
    ]) {
      expect(contact.name).not.toBe("");
      expect(contact.phone).toBe("");
      expect(contact.email).toBe("");
    }
    expect(JSON.stringify(beo)).not.toContain("2025550100");
    expect(JSON.stringify(beo)).not.toContain("juniper.example");
    expect(JSON.stringify(beo)).not.toContain("atrium.example");
  });

  it("shows full-time staff and managers the client and venue phones and emails", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    for (const who of [casey, sam, manager, admin]) {
      const beo = await getBeo(who, event);
      expect(beo.content.event.pointOfContact).toMatchObject({ phone: "2025550100", email: "pat@juniper.example" });
      expect(beo.content.event.venueContacts[0]).toMatchObject({ phone: "2025550111", email: "vic@atrium.example" });
    }
  });

  it("opens for everyone assigned, kitchen staff included, and is 404 for unassigned staff (AC2)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    for (const who of [admin, manager, sam, jamie, casey, kit])
      expect((await who.call("GET", `/api/events/${event.id}/beo`)).status).toBe(200);
    expect((await nora.call("GET", `/api/events/${event.id}/beo`)).status).toBe(404);
  });

  it("serves the same content the policy projection gives each role (AC3)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const full = await getBeo(admin, event);
    const limited = await getBeo(jamie, event);
    expect({ ...limited.content.event, contactHidden: false, pointOfContact: null, clientContacts: [], venueContacts: [] }).toEqual({
      ...full.content.event,
      pointOfContact: null,
      clientContacts: [],
      venueContacts: [],
    });
    expect(limited.content.summary).toEqual(full.content.summary);
  });
});

describe("FLOW-145: the run of show", () => {
  const base = `/beo/run-of-show`;
  it("follows the guest threshold when automatic and the manual setting otherwise (AC1)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    // 80 guests against the default threshold of 150.
    expect((await getBeo(sam, event)).content.runOfShow).toMatchObject({ mode: "auto", enabled: false, threshold: 150 });
    await edit(event, { guestCount: 200 });
    expect((await getBeo(sam, event)).content.runOfShow.enabled).toBe(true);
    const off = await sam.send<BeoView>("PUT", `/api/events/${event.id}${base}`, { mode: "off", rows: [] });
    expect(off.content.runOfShow).toMatchObject({ mode: "off", enabled: false });
    const on = await sam.send<BeoView>("PUT", `/api/events/${event.id}${base}`, {
      mode: "on",
      rows: [
        { time: "18:00", cue: "Doors open", owner: "Casey" },
        { time: "18:30", cue: "Salad out" },
      ],
    });
    expect(on.content.runOfShow.enabled).toBe(true);
    expect(on.content.runOfShow.rows.map((row) => row.cue)).toEqual(["Doors open", "Salad out"]);
  });

  it("is read only for part-time staff", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    expect((await jamie.call("PUT", `/api/events/${event.id}${base}`, { mode: "on", rows: [] })).status).toBeGreaterThanOrEqual(403);
  });
});

describe("FLOW-146: setup areas and the cleanup checklist", () => {
  it("starts a BEO with the settings template and never changes the template (AC2)", async () => {
    const event = await seed();
    const beo = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo`, {});
    expect(beo.content.setupCleanup.cleanup.map((section) => section.section)).toContain("Kitchen");
    await sam.send("PUT", `/api/events/${event.id}/beo/cleanup`, {
      sections: [{ section: "Kitchen", items: ["Only this"] }],
    });
    const other = await sam.send<FlowEvent>("POST", "/api/events", {
      title: "Spring lunch",
      date: later,
      startTime: "12:00",
      endTime: "15:00",
      clientId: event.client.id,
      guestCount: 40,
      assignedSalespersonId: people.sam,
    });
    const second = await sam.send<BeoView>("POST", `/api/events/${other.id}/beo`, {});
    expect(second.content.setupCleanup.cleanup.find((section) => section.section === "Kitchen")!.items.length).toBeGreaterThan(1);
  });

  it("records who checked an item and when, for anyone who can open the event (AC3)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const set = await sam.send<BeoView>("PUT", `/api/events/${event.id}/beo/cleanup`, {
      sections: [{ section: "Load-out", items: ["Strip linens"] }],
    });
    const item = set.content.setupCleanup.cleanup[0].items[0];
    const checked = await jamie.send<BeoView>("PATCH", `/api/events/${event.id}/beo/cleanup/${item.id}`, { checked: true });
    const done = checked.content.setupCleanup.cleanup[0].items[0];
    expect(done.checkedAt).not.toBeNull();
    expect(done.checkedBy).toBeTruthy();
    // Replacing the list keeps the check-off of an unchanged item.
    const again = await sam.send<BeoView>("PUT", `/api/events/${event.id}/beo/cleanup`, {
      sections: [{ section: "Load-out", items: ["Strip linens", "Sweep floor"] }],
    });
    expect(again.content.setupCleanup.cleanup[0].items[0].checkedAt).not.toBeNull();
    expect(again.content.setupCleanup.cleanup[0].items[1].checkedAt).toBeNull();
  });

  it("adds, renames and removes setup areas", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const added = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo/areas`, { kind: "setup", name: "Cocktail hour" });
    const area = added.content.setupCleanup.areas.find((a) => a.name === "Cocktail hour")!;
    const renamed = await sam.send<BeoView>("PATCH", `/api/events/${event.id}/beo/areas/${area.id}`, { notes: "Bar left" });
    expect(renamed.content.setupCleanup.areas.find((a) => a.id === area.id)!.notes).toBe("Bar left");
    const removed = await sam.send<BeoView>("DELETE", `/api/events/${event.id}/beo/areas/${area.id}`);
    expect(removed.content.setupCleanup.areas.find((a) => a.id === area.id)).toBeUndefined();
  });
});

describe("FLOW-147: layouts and annotations", () => {
  it("stores and returns an annotation scene for a layout area (AC1)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const added = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo/areas`, { kind: "layout", name: "Ballroom" });
    const area = added.content.layout.areas.find((a) => a.name === "Ballroom")!;
    expect(area.hasScene).toBe(false);
    const saved = await sam.send<BeoView>("PUT", `/api/events/${event.id}/beo/areas/${area.id}/scene`, {
      scene: { elements: [{ id: "a", type: "rectangle" }] },
    });
    expect(saved.content.layout.areas.find((a) => a.id === area.id)!.hasScene).toBe(true);
    const scene = await sam.send<{ scene: { elements: unknown[] } }>("GET", `/api/events/${event.id}/beo/areas/${area.id}/scene`);
    expect(scene.scene.elements).toHaveLength(1);
  });

  it("copies the venue's areas as layout areas without duplicating names (AC2)", async () => {
    const event = await seed();
    await sam.send("POST", `/api/events/${event.id}/beo`, {});
    const first = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo/layout/copy`, { from: "venue" }, 200);
    const second = await sam.send<BeoView>("POST", `/api/events/${event.id}/beo/layout/copy`, { from: "venue" }, 200);
    expect(second.content.layout.areas.map((a) => a.name).sort()).toEqual(first.content.layout.areas.map((a) => a.name).sort());
  });
});
