import { roles, employmentTypes } from "../../shared/access";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { events, inventoryItems, venues } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createLead } from "../../worker/records/leads";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { Client, ClientInput } from "../../shared/core-records";
import type { SearchResult } from "../../shared/search";

// Global search (FLOW-46) against the CI Postgres service: typo tolerance, ranking,
// and the caller's record scoping and field visibility.
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
  staff: "a0000000-0000-4000-8000-000000000005",
};
const signedInAs = (
  userId: string,
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = { userId, role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return {
    search: async (q: string) => {
      const response = await app.request(
        `/api/search?q=${encodeURIComponent(q)}`,
        {},
        env,
      );
      expect(response.status).toBe(200);
      return (await response.json()) as SearchResult[];
    },
    createClient: async (input: ClientInput) => {
      const response = await app.request(
        "/api/clients",
        {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );
      expect(response.status).toBe(201);
      return (await response.json()) as Client;
    },
  };
};
const admin = signedInAs(people.admin, "admin");
const manager = signedInAs(people.manager, "sales_manager");
const sam = signedInAs(people.sam, "salesperson");
const sue = signedInAs(people.sue, "salesperson");
const partTimeSam = signedInAs(people.sam, "salesperson", "part_time");
const staff = signedInAs(people.staff, "staff");

const titles = (results: SearchResult[]) => results.map((r) => r.title);
const ofType = (results: SearchResult[], type: SearchResult["type"]) =>
  titles(results.filter((r) => r.type === type));
const newClient = (
  name: string,
  email: string,
  phone: string,
): ClientInput => ({
  name,
  kind: "person",
  contacts: [{ name, role: "primary_poc", email, phone }],
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table recipe_lines, recipes, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_service_details, inventory_rental_details, inventory_items, lead_duplicates, leads, audit_log, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("global search (FLOW-46)", () => {
  it("finds a client whose name is misspelled by one letter (AC1)", async () => {
    await admin.createClient(
      newClient("Katherine Gonzalez", "kg@example.com", "202-555-0111"),
    );
    await admin.createClient(
      newClient("Unrelated Person", "up@example.com", "202-555-0112"),
    );
    for (const typo of ["Katherine Gonzales", "Gonzlez", "Katharine"])
      expect(ofType(await admin.search(typo), "client")).toEqual([
        "Katherine Gonzalez",
      ]);
  });

  it("ranks an exact match above a fuzzy one", async () => {
    await admin.createClient(
      newClient("Maya Ortiz", "maya@example.com", "202-555-0121"),
    );
    await admin.createClient(
      newClient("Mayo Ortez", "mayo@example.com", "202-555-0122"),
    );
    const results = await admin.search("Maya Ortiz");
    expect(titles(results)[0]).toBe("Maya Ortiz");
    expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("finds leads, events, venues and items by name, email, phone and code", async () => {
    const owner = await admin.createClient(
      newClient("Juniper Hall", "events@juniper.example", "(202) 555-0131"),
    );
    await createLead(db, {
      channel: "webhook",
      source: "Bark",
      sourceLeadId: "bark-1",
      name: "Priya Raman",
      email: "priya@example.com",
      phone: "703-555-0199",
    });
    await db.insert(events).values({
      title: "Raman Anniversary Dinner",
      startsAt: new Date("2026-12-01T23:00:00Z"),
      clientId: owner.id,
    });
    await db.insert(venues).values({ name: "The Glasshouse", address: "Arlington, VA" });
    await db
      .insert(inventoryItems)
      .values({
        kind: "rental",
        subtype: "tableware",
        name: "Gold Charger Plate",
        code: "CHG-01",
      });

    expect(ofType(await admin.search("Priya Raman"), "lead")).toEqual([
      "Priya Raman",
    ]);
    expect(ofType(await admin.search("priya@example"), "lead")).toEqual([
      "Priya Raman",
    ]);
    expect(ofType(await admin.search("555-0199"), "lead")).toEqual([
      "Priya Raman",
    ]);
    expect(ofType(await admin.search("events@juniper"), "client")).toEqual([
      "Juniper Hall",
    ]);
    expect(ofType(await admin.search("2025550131"), "client")).toEqual([
      "Juniper Hall",
    ]);
    expect(ofType(await admin.search("anniversary"), "event")).toEqual([
      "Raman Anniversary Dinner",
    ]);
    expect(ofType(await admin.search("glashouse"), "venue")).toEqual([
      "The Glasshouse",
    ]);
    expect(ofType(await admin.search("CHG-01"), "item")).toEqual([
      "Gold Charger Plate",
    ]);
    expect(ofType(await admin.search("charger"), "item")).toEqual([
      "Gold Charger Plate",
    ]);
    const [lead] = (await admin.search("Priya Raman")).filter(
      (r) => r.type === "lead",
    );
    expect(lead.path).toBe(`/leads/${lead.id}`);
  });

  it("never shows a salesperson another salesperson's leads or clients (AC2)", async () => {
    await sam.createClient(
      newClient("Harper Lane", "harper@example.com", "202-555-0141"),
    );
    await sue.createClient(
      newClient("Harper Lang", "lang@example.com", "202-555-0142"),
    );
    const samLead = await createLead(
      db,
      {
        channel: "webhook",
        source: "Bark",
        sourceLeadId: "b-1",
        name: "Harper Wedding",
      },
      { assignedSalespersonId: people.sam },
    );
    await createLead(
      db,
      {
        channel: "webhook",
        source: "Bark",
        sourceLeadId: "b-2",
        name: "Harper Gala",
      },
      { assignedSalespersonId: people.sue },
    );
    await createLead(db, {
      channel: "webhook",
      source: "Bark",
      sourceLeadId: "b-3",
      name: "Harper Unassigned",
    });

    const samResults = await sam.search("Harper");
    expect(ofType(samResults, "client")).toEqual(["Harper Lane"]);
    expect(ofType(samResults, "lead")).toEqual(["Harper Wedding"]);
    expect(samResults.find((r) => r.type === "lead")?.id).toBe(samLead.id);
    expect(ofType(await sue.search("Harper"), "client")).toEqual([
      "Harper Lang",
    ]);
    expect(ofType(await sue.search("Harper"), "lead")).toEqual(["Harper Gala"]);
    expect(ofType(await manager.search("Harper"), "lead").sort()).toEqual([
      "Harper Gala",
      "Harper Unassigned",
      "Harper Wedding",
    ]);
    // Staff have no access to leads or clients at all.
    expect(await staff.search("Harper")).toEqual([]);
  });

  it("matches contact email and phone only for users who may see them", async () => {
    await sam.createClient(
      newClient("Quinn Avery", "quinn@example.com", "202-555-0151"),
    );
    expect(ofType(await sam.search("quinn@example.com"), "client")).toEqual([
      "Quinn Avery",
    ]);
    expect(
      ofType(await partTimeSam.search("quinn@example.com"), "client"),
    ).toEqual([]);
    expect(ofType(await partTimeSam.search("2025550151"), "client")).toEqual(
      [],
    );
    expect(ofType(await partTimeSam.search("Quinn"), "client")).toEqual([
      "Quinn Avery",
    ]);
  });

  it("shows events only to the salesperson they are assigned to", async () => {
    const owner = await admin.createClient(
      newClient("Event Owner", "eo@example.com", "202-555-0161"),
    );
    await db.insert(events).values([
      {
        title: "Sam's Tasting",
        startsAt: new Date("2026-12-01T23:00:00Z"),
        clientId: owner.id,
        assignedSalespersonId: people.sam,
      },
      {
        title: "Sue's Tasting",
        startsAt: new Date("2026-12-02T23:00:00Z"),
        clientId: owner.id,
        assignedSalespersonId: people.sue,
      },
    ]);
    expect(ofType(await sam.search("tasting"), "event")).toEqual([
      "Sam's Tasting",
    ]);
    expect(ofType(await admin.search("tasting"), "event")).toHaveLength(2);
  });

  it("leaves out archived records and ignores one-letter queries", async () => {
    const archived = await admin.createClient(
      newClient("Archived Client", "ac@example.com", "202-555-0171"),
    );
    await db.execute(
      sql`update clients set archived_at = now() where id = ${archived.id}`,
    );
    expect(await admin.search("Archived Client")).toEqual([]);
    await admin.createClient(newClient("A", "a@example.com", "202-555-0172"));
    expect(await admin.search("A")).toEqual([]);
    expect(await admin.search("%")).toEqual([]);
  });
});

it("uses the field-group policy for search matching across every role and employment type", async () => {
  await sam.createClient(
    newClient("Visible client", "privateclient@secret.example", "2025550187"),
  );
  await createLead(
    db,
    {
      channel: "webhook",
      source: "Bark",
      sourceLeadId: "group-matrix",
      name: "Visible lead",
      email: "reachablelead@inquiry.example",
      phone: "7035550188",
    },
    { assignedSalespersonId: people.sam },
  );
  for (const role of roles)
    for (const employmentType of employmentTypes) {
      const who = signedInAs(people.sam, role, employmentType);
      const privileged = ["admin", "technical", "sales_manager"].includes(role);
      const seesRecords = privileged || role === "salesperson";
      const seesClientContact =
        seesRecords && (privileged || employmentType === "full_time");
      for (const query of ["privateclient@secret.example", "2025550187"])
        expect(ofType(await who.search(query), "client")).toEqual(
          seesClientContact ? ["Visible client"] : [],
        );
      for (const query of ["reachablelead@inquiry.example", "7035550188"])
        expect(ofType(await who.search(query), "lead")).toEqual(
          seesRecords ? ["Visible lead"] : [],
        );
    }
});
