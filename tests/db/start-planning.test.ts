import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import type { Actor, Role } from "../../shared/access";
import type { KitchenMenu } from "../../shared/kitchen-menu";
import type { PlanningProgress, RegeneratePreview } from "../../shared/planning";
import type { PullList } from "../../shared/pull-list";
import type { ProposalMapping } from "../../shared/proposal-mapping";

// Start planning, the pull list and the kitchen menu (FLOW-133/134/137) against the
// real database.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c0000000-0000-4000-8000-000000000001",
  sam: "c0000000-0000-4000-8000-000000000003",
  sue: "c0000000-0000-4000-8000-000000000004",
  kitchen: "c0000000-0000-4000-8000-000000000006",
};
const as = (userId: string, role: Role, employmentType: Actor["employmentType"] = "full_time") => {
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
    send: async <T>(method: string, path: string, body?: unknown, status = 200) => {
      const response = await call(method, path, body);
      expect(response.status).toBe(status);
      return (await response.json()) as T;
    },
  };
};
const admin = as(people.admin, "admin");
const sam = as(people.sam, "salesperson");
const sue = as(people.sue, "salesperson");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
// Catalog rows this file creates. They are removed by id, so seeded defaults (list
// values, sections) that other test files rely on stay in place.
const made = { items: [] as string[], recipes: [] as string[] };
const clean = async () => {
  await db.execute(
    sql`truncate table pull_list_lines, pull_lists, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
  await db.delete(schema.taskAssignees);
  await db.delete(schema.tasks);
  if (made.items.length) {
    await db.delete(schema.inventoryRentalDetails).where(inArray(schema.inventoryRentalDetails.itemId, made.items));
    await db.delete(schema.inventoryItems).where(inArray(schema.inventoryItems.id, made.items));
  }
  if (made.recipes.length) await db.delete(schema.recipes).where(inArray(schema.recipes.id, made.recipes));
  made.items = [];
  made.recipes = [];
};
beforeEach(clean);
afterAll(async () => {
  await clean();
  await client.end();
});

const rental = async (name: string, subtype: string, components: { itemId: string; quantity: number }[] = []) => {
  const [item] = await db.insert(schema.inventoryItems).values({ kind: "rental", subtype, name }).returning();
  await db.insert(schema.inventoryRentalDetails).values({ itemId: item.id, components });
  made.items.push(item.id);
  return item;
};

async function seed(status: "closed" | "negotiation" = "closed") {
  const [owner] = await db.insert(schema.clients).values({ name: "Juniper & Co.", kind: "organization" }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({
      clientId: owner.id,
      title: "Juniper holiday party",
      guestCount: 80,
      status,
      assignedSalespersonId: people.sam,
      startsAt: new Date("2026-12-12T23:00:00.000Z"),
    })
    .returning();
  const chair = await rental("Gold chair", "furniture");
  const glass = await rental("Coupe glass", "glassware");
  const kit = await rental("Cocktail set", "tableware", [{ itemId: glass.id, quantity: 3 }]);
  const vase = await rental("Vase", "decor");
  const [dish] = await db.insert(schema.recipes).values({ name: "Short rib", category: "Mains" }).returning();
  made.recipes.push(dish.id);
  const [proposal] = await db
    .insert(schema.proposals)
    .values({ eventId: event.id, clientId: owner.id, title: "Holiday", stage: "signed" })
    .returning();
  const [version] = await db
    .insert(schema.proposalVersions)
    .values({
      proposalId: proposal.id,
      number: 1,
      status: "ready",
      completedAt: new Date(),
      docx: { key: "k", fileName: "p.docx", contentType: "application/octet-stream", size: 1 },
    })
    .returning();
  await db.update(schema.proposals).set({ currentVersionId: version.id }).where(eq(schema.proposals.id, proposal.id));
  const line = (id: string, kind: ProposalMapping["lines"][number]["kind"], name: string, extra: Partial<ProposalMapping["lines"][number]> = {}) => ({
    id,
    kind,
    section: "",
    name,
    notes: "",
    quantity: null,
    sourceBlockId: null,
    catalogId: null,
    notTracked: false,
    ...extra,
  });
  const lines = [
    line("L1", "rental", "Gold chair", { quantity: 10, catalogId: chair.id }),
    line("L2", "rental", "Cocktail set", { quantity: 2, catalogId: kit.id }),
    line("L3", "decor", "Vase", { catalogId: vase.id }),
    line("L4", "supply", "Cocktail napkins", { quantity: 100, notTracked: true }),
    line("L5", "menu", "Short rib", { quantity: 50, section: "Mains", catalogId: dish.id }),
  ];
  const data: ProposalMapping = {
    versionId: version.id,
    fields: {},
    lines,
    staffing: [],
    timeline: [],
    charges: [],
    paymentSchedule: [],
    unextractedBlockIds: [],
  };
  await db.insert(schema.proposalMappings).values({ proposalId: proposal.id, versionId: version.id, data });
  return { event, proposal, data, chair, glass, vase, dish };
}

const runJobs = async () => {
  const registry = createJobRegistry();
  await runDueJobs(db, registry, { maxAttempts: 1 });
  await runDueJobs(db, registry, { maxAttempts: 1 });
};
const planned = async () => {
  const world = await seed();
  await sam.send<PlanningProgress>("POST", `/api/events/${world.event.id}/planning/start`);
  await runJobs();
  return world;
};
const pullList = (eventId: string) => admin.send<PullList>("GET", `/api/events/${eventId}/pull-list`);
const kitchen = (eventId: string) => admin.send<KitchenMenu>("GET", `/api/events/${eventId}/kitchen-menu`);
const names = (list: PullList) => list.groups.flatMap((group) => group.lines.map((line) => `${group.group}:${line.name}:${line.quantity}`)).sort();

describe("start planning (FLOW-133)", () => {
  it("moves a Closed event to Preparation and queues one job per runnable step", async () => {
    const { event } = await seed();
    const before = await admin.send<PlanningProgress>("GET", `/api/events/${event.id}/planning`);
    expect(before).toMatchObject({ started: false, canStart: true });
    const progress = await sam.send<PlanningProgress>("POST", `/api/events/${event.id}/planning/start`);
    expect(progress.started).toBe(true);
    expect(progress.steps.map((step) => [step.step, step.status])).toEqual([
      ["holds", "pending"],
      ["pull_list", "pending"],
      ["requirements", "skipped"],
      ["production_tasks", "skipped"],
      ["kitchen_menu", "pending"],
      ["beo_draft", "skipped"],
      ["calendar", "skipped"],
    ]);
    const [row] = await db.select().from(schema.events).where(eq(schema.events.id, event.id));
    expect(row.status).toBe("preparation");
    const queued = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "planning.step"));
    expect(queued).toHaveLength(3);
  });

  it("refuses a second start, an event that isn't Closed, and someone else's event", async () => {
    const { event } = await seed();
    await sue.send("POST", `/api/events/${event.id}/planning/start`, {}, 404);
    await sam.send("POST", `/api/events/${event.id}/planning/start`);
    const again = await sam.call("POST", `/api/events/${event.id}/planning/start`);
    expect(again.status).toBe(409);
    const other = await seed("negotiation");
    const early = await admin.call("POST", `/api/events/${other.event.id}/planning/start`);
    expect(early.status).toBe(409);
  });

  it("generates the pull list and the kitchen menu from the mapped proposal and finishes every step", async () => {
    const { event } = await planned();
    const progress = await admin.send<PlanningProgress>("GET", `/api/events/${event.id}/planning`);
    expect(progress.steps.every((step) => step.status === "done" || step.status === "skipped")).toBe(true);
    expect(progress.complete).toBe(true);
    const list = await pullList(event.id);
    expect(names(list)).toEqual([
      "decor:Vase:null",
      "kitchen_equipment:Coupe glass:6",
      "kitchen_equipment:Gold chair:10",
      "supplies:Cocktail napkins:100",
    ]);
    expect(list.tbdCount).toBe(1);
    expect(list.missingSchedule).toBe(true);
    const menu = await kitchen(event.id);
    expect(menu.courses).toHaveLength(1);
    expect(menu.courses[0]).toMatchObject({ course: "Mains" });
    expect(menu.courses[0].lines[0]).toMatchObject({ name: "Short rib", plannedQuantity: 50 });
  });

  it("is safe to repeat: regenerating an unchanged proposal changes nothing", async () => {
    const { event } = await planned();
    const preview = await admin.send<RegeneratePreview>("POST", `/api/events/${event.id}/pull-list/regenerate/preview`, {});
    expect(preview.upToDate).toBe(true);
    const before = await pullList(event.id);
    await admin.send("POST", `/api/events/${event.id}/pull-list/regenerate`, {});
    expect(names(await pullList(event.id))).toEqual(names(before));
    expect(await db.select().from(schema.pullListLines)).toHaveLength(4);
  });

  it("previews a proposal change, keeps hand edits, and discards them on request", async () => {
    const { event, proposal, data } = await planned();
    const chairLine = (await pullList(event.id)).groups.flatMap((g) => g.lines).find((l) => l.name === "Gold chair")!;
    await admin.send("PATCH", `/api/events/${event.id}/pull-list/lines/${chairLine.id}`, { quantity: 12 });
    // The proposal now says 14 chairs and drops the vase.
    const lines = data.lines.filter((l) => l.id !== "L3").map((l) => (l.id === "L1" ? { ...l, quantity: 14 } : l));
    await db.update(schema.proposalMappings).set({ data: { ...data, lines } }).where(eq(schema.proposalMappings.proposalId, proposal.id));

    const keep = await admin.send<RegeneratePreview>("POST", `/api/events/${event.id}/pull-list/regenerate/preview`, {});
    expect(keep.changes.map((c) => [c.kind, c.label])).toEqual(expect.arrayContaining([["removed", "Vase"], ["kept", "Gold chair"]]));
    await admin.send("POST", `/api/events/${event.id}/pull-list/regenerate`, {});
    let list = await pullList(event.id);
    expect(names(list)).toContain("kitchen_equipment:Gold chair:12");
    expect(names(list).some((n) => n.includes("Vase"))).toBe(false);

    await admin.send("POST", `/api/events/${event.id}/pull-list/regenerate`, { discardEdits: true });
    list = await pullList(event.id);
    expect(names(list)).toContain("kitchen_equipment:Gold chair:14");
  });

  it("does not bring back a generated line someone removed, unless edits are discarded", async () => {
    const { event } = await planned();
    const vase = (await pullList(event.id)).groups.flatMap((g) => g.lines).find((l) => l.name === "Vase")!;
    await admin.send("POST", `/api/events/${event.id}/pull-list/lines/${vase.id}/archive`, {});
    await admin.send("POST", `/api/events/${event.id}/pull-list/regenerate`, {});
    expect(names(await pullList(event.id)).some((n) => n.includes("Vase"))).toBe(false);
    await admin.send("POST", `/api/events/${event.id}/pull-list/regenerate`, { discardEdits: true });
    expect(names(await pullList(event.id)).some((n) => n.includes("Vase"))).toBe(true);
  });
});

describe("pull list (FLOW-134)", () => {
  it("records who moved a line along and when, for anyone on the event", async () => {
    const { event } = await planned();
    const line = (await pullList(event.id)).groups.flatMap((g) => g.lines)[0];
    const updated = await sam.send<PullList>("POST", `/api/events/${event.id}/pull-list/lines/${line.id}/status`, { status: "pulled" });
    const moved = updated.groups.flatMap((g) => g.lines).find((l) => l.id === line.id)!;
    expect(moved.status).toBe("pulled");
    expect(moved.statusAt).not.toBeNull();
    const [row] = await db.select().from(schema.pullListLines).where(eq(schema.pullListLines.id, line.id));
    expect(row.statusBy).toBe(people.sam);
  });

  it("lets only event editors change lines and the schedule", async () => {
    const { event } = await planned();
    const line = (await pullList(event.id)).groups.flatMap((g) => g.lines)[0];
    const kitchenLead = as(people.kitchen, "kitchen_lead", "part_time");
    expect((await kitchenLead.call("PATCH", `/api/events/${event.id}/pull-list/lines/${line.id}`, { quantity: 1 })).status).toBe(403);
    expect((await kitchenLead.call("PUT", `/api/events/${event.id}/pull-list/schedule`, { date: null, time: null, pullerId: null })).status).toBe(403);
  });

  it("stores the pull time in New York time and flags a list with no date, time or puller", async () => {
    const { event } = await planned();
    const set = await admin.send<PullList>("PUT", `/api/events/${event.id}/pull-list/schedule`, { date: "2026-12-10", time: "09:30", pullerId: null });
    expect(set).toMatchObject({ scheduledDate: "2026-12-10", scheduledTime: "09:30", missingSchedule: true });
    expect(set.scheduledAt).toBe("2026-12-10T14:30:00.000Z");
    const cleared = await admin.send<PullList>("PUT", `/api/events/${event.id}/pull-list/schedule`, { date: null, time: null, pullerId: null });
    expect(cleared.scheduledAt).toBeNull();
    expect((await admin.call("PUT", `/api/events/${event.id}/pull-list/schedule`, { date: "2026-12-10", time: null, pullerId: null })).status).toBe(400);
  });

  it("adds a hand-made line that regeneration never touches", async () => {
    const { event } = await planned();
    await admin.send("POST", `/api/events/${event.id}/pull-list/lines`, { group: "decor", name: "Candles", quantity: 24 }, 201);
    await admin.send("POST", `/api/events/${event.id}/pull-list/regenerate`, { discardEdits: true });
    expect(names(await pullList(event.id))).toContain("decor:Candles:24");
  });
});

describe("kitchen menu (FLOW-137)", () => {
  it("edits quantities, sets when food leaves the kitchen, and lists kitchen tasks", async () => {
    const { event } = await planned();
    const line = (await kitchen(event.id)).courses[0].lines[0];
    const edited = await admin.send<KitchenMenu>("PATCH", `/api/events/${event.id}/kitchen-menu/lines/${line.id}`, { plannedQuantity: 60 });
    expect(edited.courses[0].lines[0]).toMatchObject({ plannedQuantity: 60, edited: true });
    const timed = await admin.send<KitchenMenu>("PUT", `/api/events/${event.id}/kitchen-menu/times`, { leavesKitchenTime: "16:00" });
    expect(timed.leavesKitchenTime).toBe("16:00");
    const [task] = await db.insert(schema.tasks).values({ title: "Braise short rib", type: "kitchen", eventId: event.id }).returning();
    await db.insert(schema.taskAssignees).values({ taskId: task.id, userId: people.admin });
    const menu = await kitchen(event.id);
    expect(menu.tasks).toHaveLength(1);
    expect(menu.tasks[0]).toMatchObject({ title: "Braise short rib" });
    expect(menu.canAssign).toBe(true);
  });

  it("keeps an edited quantity when regenerating, and restores it on request", async () => {
    const { event } = await planned();
    const line = (await kitchen(event.id)).courses[0].lines[0];
    await admin.send("PATCH", `/api/events/${event.id}/kitchen-menu/lines/${line.id}`, { plannedQuantity: 60 });
    await admin.send("POST", `/api/events/${event.id}/kitchen-menu/regenerate`, {});
    expect((await kitchen(event.id)).courses[0].lines[0].plannedQuantity).toBe(60);
    await admin.send("POST", `/api/events/${event.id}/kitchen-menu/regenerate`, { discardEdits: true });
    expect((await kitchen(event.id)).courses[0].lines[0].plannedQuantity).toBe(50);
  });
});
