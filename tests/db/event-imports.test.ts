import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { clientContacts, clients, eventStatusHistory, events, importKeys, leads } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";
import { eventImportFields } from "../../shared/import-events";
import {
  autoMap,
  headingIndex,
  mapRows,
  type ImportBatchResult,
  type ImportLog,
  type ImportRow,
  type ImportRowPlan,
} from "../../shared/imports";
import { utcToBusinessTime } from "../../shared/time";
import { parseCsv } from "../../src/services/import-files";
import { eventsCsv } from "../fixtures/events-sheet";

// The Events importer (FLOW-299) through the import framework, against the CI
// Postgres service, on a synthetic sheet (ADR-27). Q1: a lead at the row's
// status plus its event, and the client at Closing or later.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const signedInAs = (actor: Actor) => {
  const app = createApp({ withDb, resolveActor: async () => actor });
  return async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await app.request(
      path,
      {
        method,
        ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      },
      env,
    );
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(status);
    return json as T;
  };
};
const admin = signedInAs({ userId: "c3000000-0000-4000-8000-000000000001", role: "admin" });

const sheetRows = (csv = eventsCsv): ImportRow[] => {
  const sheet = parseCsv(csv);
  return mapRows(sheet, autoMap(sheet[headingIndex(sheet)], eventImportFields)).map(({ rowNumber, values }) => ({ rowNumber, values }));
};
const goodRows = () => sheetRows().filter((row) => row.rowNumber !== 7);
const dryRun = (rows: ImportRow[]) => admin<ImportRowPlan[]>("POST", "/api/imports/dry-run", { module: "events", rows });
async function runImport(rows: ImportRow[], fileName = "Events - Sheet1.csv") {
  const log = await admin<ImportLog>("POST", "/api/imports", { module: "events", fileName, rowCount: rows.length }, 201);
  const results = (await admin<ImportBatchResult>("POST", `/api/imports/${log.id}/rows`, { rows })).results;
  return { log: await admin<ImportLog>("POST", `/api/imports/${log.id}/complete`), results };
}
const eventNamed = async (title: string) => {
  const [event] = await db.select().from(events).where(eq(events.title, title));
  expect(event, title).toBeDefined();
  return event;
};
const leadOf = async (title: string) => {
  const event = await eventNamed(title);
  const [lead] = await db.select().from(leads).where(eq(leads.id, event.leadId!));
  return { event, lead };
};
const snapshot = async () => ({
  leads: await db.select().from(leads),
  events: await db.select().from(events),
  clients: await db.select().from(clients),
  history: await db.select().from(eventStatusHistory),
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table closeout_lines, event_closeouts, truck_assignments, event_planning_outputs, pull_list_lines, pull_lists, beo_checklist_items, beo_run_of_show, beo_areas, beo_changes, beos, kitchen_menu_lines, kitchen_menus, event_planning_steps, event_planning, consumable_allocations, event_requirements, event_bar_tiers, reservation_conflicts, reservations, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, proposal_mappings, proposal_change_log, proposal_version_mappings, contracts, addendums, proposal_versions, proposal_stage_history, proposals, event_areas, event_timeline_entries, payment_schedule_items, payments, events, client_contacts, clients, import_keys, import_logs, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("Events importer (FLOW-299)", () => {
  it("AC1: a dry run reports every row as created or flagged, without writing", async () => {
    const rows = sheetRows();
    const plans = await dryRun(rows);
    expect(plans.map((plan) => [plan.rowNumber, plan.action])).toEqual([
      [2, "create"], [3, "create"], [4, "create"], [5, "create"], [6, "create"], [7, "error"],
    ]);
    expect(plans.find((plan) => plan.rowNumber === 3)?.summary).toBe(
      "Sample Gala · 2027-05-22 18:00 · Closing · Sample Org · 1200 guests · lead, event and client",
    );
    expect(plans.find((plan) => plan.rowNumber === 4)?.notes).toEqual(["No start time; set to 12:00 PM."]);
    expect(await db.select().from(leads)).toEqual([]);
    expect(await db.select().from(events)).toEqual([]);
  });

  it("AC1: a row repeated in the file merges into the first, and a same-day event of that name is a possible duplicate", async () => {
    const rows = goodRows();
    await runImport(rows.filter((row) => row.rowNumber === 2));
    const again = [...rows, { ...rows[1], rowNumber: 8 }];
    const plans = await dryRun(again);
    expect(plans.find((plan) => plan.rowNumber === 2)?.action).toBe("skip");
    expect(plans.filter((plan) => plan.externalKey === plans[1].externalKey).map((plan) => plan.rowNumber)).toEqual([3, 8]);
    const renamed = { ...rows[0], values: { ...rows[0].values, contact: "Sample Someone Else" } };
    expect((await dryRun([renamed]))[0].duplicates.map((match) => match.label)).toEqual(["Sample Spring Social on 2027-04-10"]);
  });

  it("Q1: creates a lead at the row's status and its event, and the client at Closing or later", async () => {
    const { log } = await runImport(sheetRows());
    expect(log).toMatchObject({ created: 5, updated: 0, skipped: 0, failed: 1 });

    const social = await leadOf("Sample Spring Social");
    expect(social.lead).toMatchObject({
      channel: "import",
      source: "Events import",
      status: "pitching",
      name: "Sample Person One",
      email: "one@example.com",
      eventDate: "2027-04-10",
      guestCount: 80,
      convertedClientId: null,
    });
    expect(social.event).toMatchObject({ status: "pitching", guestCount: 80, address: "Sample Hall", eventType: "Social", internalNotes: "Wants a taco bar", clientId: null });
    expect(utcToBusinessTime(social.event.startsAt)).toEqual({ date: "2027-04-10", time: "18:30" });

    const gala = await leadOf("Sample Gala");
    expect(gala.lead.status).toBe("closing");
    expect(gala.lead.convertedEventId).toBe(gala.event.id);
    const [org] = await db.select().from(clients).where(eq(clients.id, gala.lead.convertedClientId!));
    expect(org).toMatchObject({ name: "Sample Org", kind: "organization" });
    expect(gala.event.clientId).toBe(org.id);
    expect(await db.select({ name: clientContacts.name, email: clientContacts.email, role: clientContacts.role }).from(clientContacts).where(eq(clientContacts.clientId, org.id)))
      .toEqual([{ name: "Sample Person Two", email: "two@example.com", role: "primary_poc" }]);

    const wedding = await leadOf("Sample Wedding");
    expect(wedding.lead.status).toBe("closed");
    const [person] = await db.select().from(clients).where(eq(clients.id, wedding.lead.convertedClientId!));
    expect(person).toMatchObject({ name: "Sample Person Three", kind: "person" });
    expect(utcToBusinessTime(wedding.event.startsAt).time).toBe("12:00");

    const picnic = await leadOf("Sample Picnic");
    expect(picnic.lead).toMatchObject({ status: "lost", lostReason: "Imported as Lost.", convertedClientId: null });
    expect((await leadOf("Sample Lunch")).lead.status).toBe("inquiry");
    expect(await db.select().from(clients)).toHaveLength(2);
    expect(await db.select().from(importKeys)).toHaveLength(5);
  });

  it("AC2: re-running the import changes nothing", async () => {
    const rows = sheetRows();
    await runImport(rows);
    const before = await snapshot();
    expect((await dryRun(rows)).map((plan) => plan.action)).toEqual(["skip", "skip", "skip", "skip", "skip", "error"]);
    const { log } = await runImport(rows);
    expect(log).toMatchObject({ created: 0, updated: 0, skipped: 5, failed: 1 });
    expect(await snapshot()).toEqual(before);
  });

  it("updates the same lead and event when a row changes, and adds the client once it reaches Closing", async () => {
    const rows = goodRows();
    await runImport(rows);
    const { lead, event } = await leadOf("Sample Spring Social");
    const changed = rows.map((row) =>
      row.rowNumber === 2 ? { ...row, values: { ...row.values, status: "Closing", guests: "95", start_time: "7pm" } } : row,
    );
    const { log } = await runImport(changed);
    expect(log).toMatchObject({ created: 0, updated: 1, skipped: 4 });
    const after = await leadOf("Sample Spring Social");
    expect(after.lead.id).toBe(lead.id);
    expect(after.event.id).toBe(event.id);
    expect(after.lead).toMatchObject({ status: "closing", guestCount: 95 });
    expect(after.event).toMatchObject({ status: "closing", guestCount: 95 });
    expect(utcToBusinessTime(after.event.startsAt).time).toBe("19:00");
    expect(after.event.clientId).toBe(after.lead.convertedClientId);
    expect(await db.select().from(clients)).toHaveLength(3);
    expect((await dryRun(changed)).every((plan) => plan.action === "skip")).toBe(true);
  });
});
