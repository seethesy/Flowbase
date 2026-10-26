import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { clients, jobs } from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type {
  Client,
  ClientInput,
  EventInput,
  FlowEvent,
  Venue,
  VenueInput,
} from "../../shared/core-records";

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
  lead: "a0000000-0000-4000-8000-000000000005",
  helper: "a0000000-0000-4000-8000-000000000006",
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
    post: async <T>(path: string, body: unknown, status = 201) => {
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
const lead = signedInAs(people.lead, "kitchen_lead");
const helper = signedInAs(people.helper, "staff", "part_time");

const newClient = (overrides: Partial<ClientInput> = {}): ClientInput => ({
  name: "Juniper & Co.",
  kind: "organization",
  contacts: [
    {
      name: "Olivia Bennett",
      role: "primary_poc",
      email: "olivia@juniper.example",
      phone: "(202) 555-0101",
    },
  ],
  ...overrides,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table lead_duplicates, leads, audit_log, event_status_history, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("clients", () => {
  it("assigns a salesperson's new client to them and lists only their own", async () => {
    const own = await sam.post<Client>("/api/clients", newClient());
    expect(own.assignedSalespersonId).toBe(people.sam);
    await sue.post<Client>(
      "/api/clients",
      newClient({ name: "Glasshouse", contacts: [] }),
    );
    const samList = await sam.get<Client[]>("/api/clients");
    expect(samList.map((c) => c.name)).toEqual(["Juniper & Co."]);
    const all = await manager.get<Client[]>("/api/clients");
    expect(all.map((c) => c.name)).toEqual(["Glasshouse", "Juniper & Co."]);
    expect((await sue.call("GET", `/api/clients/${own.id}`)).status).toBe(404);
  });

  it("warns Admin about a duplicate email and shows the match", async () => {
    const first = await sam.post<Client>("/api/clients", newClient());
    const response = await admin.call(
      "POST",
      "/api/clients",
      newClient({
        name: "Juniper again",
        contacts: [
          { name: "O.", role: "billing", email: "OLIVIA@juniper.example" },
        ],
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("POSSIBLE_DUPLICATE");
    expect(body.duplicates).toEqual([{ id: first.id, name: "Juniper & Co." }]);
    const confirmed = await admin.post<Client>("/api/clients", {
      ...newClient({ name: "Juniper again" }),
      allowDuplicate: true,
    });
    expect(confirmed.name).toBe("Juniper again");
  });

  it("matches phone numbers by their digits", async () => {
    await admin.post<Client>("/api/clients", newClient());
    const response = await manager.call(
      "POST",
      "/api/clients",
      newClient({
        name: "Other",
        contacts: [{ name: "P", role: "billing", phone: "+1 202.555.0101" }],
      }),
    );
    expect(response.status).toBe(409);
  });

  it("tells a salesperson nothing about another salesperson's match and flags it to Admin", async () => {
    const original = await sue.post<Client>("/api/clients", newClient());
    const response = await sam.call(
      "POST",
      "/api/clients",
      newClient({ name: "Juniper (Sam)" }),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as Client;
    expect(JSON.stringify(created)).not.toContain(original.id);
    expect(JSON.stringify(created)).not.toContain("Juniper & Co.");
    expect(created.possibleDuplicateOf).toBeNull();

    const flagged = await admin.get<Client[]>("/api/clients?flagged=true");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      id: created.id,
      possibleDuplicateOf: { id: original.id, name: "Juniper & Co." },
    });
    const events = await db.select().from(jobs);
    expect(events.map((job) => job.type)).toContain(
      "event:client.duplicate_flagged",
    );
  });

  it("warns a salesperson about a duplicate of their own client", async () => {
    await sam.post<Client>("/api/clients", newClient());
    const response = await sam.call(
      "POST",
      "/api/clients",
      newClient({ name: "Again" }),
    );
    expect(response.status).toBe(409);
  });

  it("hides archived clients by default and restores them", async () => {
    const created = await admin.post<Client>("/api/clients", newClient());
    await admin.post(`/api/clients/${created.id}/archive`, {}, 200);
    expect(await admin.get<Client[]>("/api/clients")).toEqual([]);
    const archived = await admin.get<Client[]>("/api/clients?archived=true");
    expect(archived.map((c) => c.id)).toEqual([created.id]);
    const restored = await admin.post<Client>(
      `/api/clients/${created.id}/restore`,
      {},
      200,
    );
    expect(restored.archivedAt).toBeNull();
    expect(await admin.get<Client[]>("/api/clients")).toHaveLength(1);
  });

  it("hides contact phone and email from part-time users and keeps them on update", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    const seen = await partTimeSam.get<Client>(`/api/clients/${created.id}`);
    expect(seen.contacts[0]).toMatchObject({
      name: "Olivia Bennett",
      email: null,
      phone: null,
    });
    const response = await partTimeSam.call(
      "PUT",
      `/api/clients/${created.id}`,
      {
        name: "Juniper & Co. Events",
        kind: "organization",
        contacts: [
          { id: created.contacts[0].id, name: "Olivia B.", role: "primary_poc" },
        ],
      },
    );
    expect(response.status).toBe(200);
    const full = await sam.get<Client>(`/api/clients/${created.id}`);
    expect(full.contacts[0]).toMatchObject({
      name: "Olivia B.",
      email: "olivia@juniper.example",
      phone: "(202) 555-0101",
    });
  });

  it("keeps clients from roles without client access", async () => {
    expect((await lead.call("GET", "/api/clients")).status).toBe(403);
    expect(
      (await lead.call("POST", "/api/clients", newClient())).status,
    ).toBe(403);
  });

  it("archives contacts removed from the list", async () => {
    const created = await admin.post<Client>(
      "/api/clients",
      newClient({
        contacts: [
          { name: "A", role: "primary_poc" },
          { name: "B", role: "billing" },
        ],
      }),
    );
    const response = await admin.call("PUT", `/api/clients/${created.id}`, {
      name: created.name,
      kind: created.kind,
      contacts: [{ id: created.contacts[1].id, name: "B", role: "billing" }],
    });
    const updated = (await response.json()) as Client;
    expect(updated.contacts.map((c) => c.name)).toEqual(["B"]);
  });
});

const newVenue = (overrides: Partial<VenueInput> = {}): VenueInput => ({
  name: "The Glasshouse",
  address: "100 Garden Way, Arlington, VA",
  jurisdiction: "VA",
  loadInNotes: "Loading dock on the north side",
  areas: [{ name: "Inside Tent" }, { name: "Outside Tent" }],
  contacts: [
    {
      name: "Mara Venue",
      role: "manager",
      email: "mara@glasshouse.example",
      phone: "703-555-0199",
    },
  ],
  ...overrides,
});

describe("venues", () => {
  it("hides venue contacts from part-time users", async () => {
    const venue = await admin.post<Venue>("/api/venues", newVenue());
    expect(venue.contacts).toHaveLength(1);
    const partTime = await helper.get<Venue>(`/api/venues/${venue.id}`);
    expect(partTime.contacts).toBeNull();
    expect(JSON.stringify(partTime)).not.toContain("mara@");
    const edit = await helper.call("PUT", `/api/venues/${venue.id}`, {
      ...newVenue(),
    });
    expect(edit.status).toBe(403);
  });

  it("validates the jurisdiction", async () => {
    const response = await admin.call(
      "POST",
      "/api/venues",
      newVenue({ jurisdiction: "NY" as "VA" }),
    );
    expect(response.status).toBe(400);
  });

  it("keeps stored contacts when an update omits them", async () => {
    const venue = await admin.post<Venue>("/api/venues", newVenue());
    const response = await admin.call("PUT", `/api/venues/${venue.id}`, {
      ...newVenue({ name: "Glasshouse" }),
      contacts: undefined,
    });
    expect(((await response.json()) as Venue).contacts).toHaveLength(1);
  });
});

const newEvent = (clientId: string, overrides: Partial<EventInput> = {}) => ({
  title: "Fall gala",
  date: "2026-11-14",
  startTime: "18:00",
  clientId,
  ...overrides,
});

describe("events", () => {
  it("creates an event from just a title, date, time and client", async () => {
    const owner = await sam.post<Client>("/api/clients", newClient());
    const event = await sam.post<FlowEvent>(
      "/api/events",
      newEvent(owner.id),
    );
    expect(event).toMatchObject({
      title: "Fall gala",
      date: "2026-11-14",
      startTime: "18:00",
      endTime: null,
      client: { id: owner.id, name: "Juniper & Co." },
      status: "inquiry",
      assignedSalespersonId: people.sam,
      venue: null,
      areas: [],
    });
    // 6 pm in New York in November is 11 pm UTC (EST).
    expect(event.startsAt).toBe("2026-11-14T23:00:00.000Z");
  });

  it("rejects an event without a title or time", async () => {
    const owner = await admin.post<Client>("/api/clients", newClient());
    for (const body of [
      newEvent(owner.id, { title: "" }),
      { ...newEvent(owner.id), startTime: undefined },
    ])
      expect((await admin.call("POST", "/api/events", body)).status).toBe(400);
  });

  it("carries a picked venue's address and areas over to the event", async () => {
    const owner = await admin.post<Client>("/api/clients", newClient());
    const venue = await admin.post<Venue>("/api/venues", newVenue());
    const event = await admin.post<FlowEvent>(
      "/api/events",
      newEvent(owner.id, { venueId: venue.id, endTime: "23:00" }),
    );
    expect(event.venue).toEqual({ id: venue.id, name: "The Glasshouse" });
    expect(event.address).toBe("100 Garden Way, Arlington, VA");
    expect(event.areas.map((area) => area.name)).toEqual([
      "Inside Tent",
      "Outside Tent",
    ]);
    expect(event.endTime).toBe("23:00");

    // Per-event areas can be added on top of the venue's.
    const response = await admin.call("PUT", `/api/events/${event.id}`, {
      ...newEvent(owner.id, { venueId: venue.id }),
      areas: ["Inside Tent", "Outside Tent", "Bar Patio"],
    });
    const updated = (await response.json()) as FlowEvent;
    expect(updated.areas.map((area) => area.name)).toEqual([
      "Inside Tent",
      "Outside Tent",
      "Bar Patio",
    ]);
    const history = await admin.get<FlowEvent[]>(
      `/api/events?venueId=${venue.id}`,
    );
    expect(history.map((e) => e.id)).toEqual([event.id]);
  });

  it("answers 404, not 403, for another salesperson's event", async () => {
    const owner = await sue.post<Client>("/api/clients", newClient());
    const event = await sue.post<FlowEvent>("/api/events", newEvent(owner.id));
    const response = await sam.call("GET", `/api/events/${event.id}`);
    expect(response.status).toBe(404);
    expect(
      (await sam.call("PUT", `/api/events/${event.id}`, newEvent(owner.id)))
        .status,
    ).toBe(404);
    expect(await sam.get<FlowEvent[]>("/api/events")).toEqual([]);
  });

  it("shows staff only the events they lead or assist", async () => {
    const owner = await admin.post<Client>("/api/clients", newClient());
    const led = await admin.post<FlowEvent>(
      "/api/events",
      newEvent(owner.id, { title: "Led", productionLeadId: people.lead }),
    );
    const assisted = await admin.post<FlowEvent>(
      "/api/events",
      newEvent(owner.id, {
        title: "Assisted",
        assistantLeadIds: [people.helper],
      }),
    );
    await admin.post<FlowEvent>(
      "/api/events",
      newEvent(owner.id, { title: "Other" }),
    );
    expect((await lead.get<FlowEvent[]>("/api/events")).map((e) => e.id)).toEqual(
      [led.id],
    );
    expect(
      (await helper.get<FlowEvent[]>("/api/events")).map((e) => e.id),
    ).toEqual([assisted.id]);
    expect((await lead.call("POST", "/api/events", newEvent(owner.id))).status).toBe(
      403,
    );
  });

  it("doesn't record booked_at when an event reaches Negotiation (FLOW-208)", async () => {
    const owner = await admin.post<Client>("/api/clients", newClient());
    const event = await admin.post<FlowEvent>("/api/events", newEvent(owner.id));
    expect(event.bookedAt).toBeNull();
    const negotiating = await admin.post<FlowEvent>(
      `/api/events/${event.id}/status`,
      { status: "negotiation" },
      200,
    );
    expect(negotiating.bookedAt).toBeNull();
  });

  it("refuses a point of contact from another client", async () => {
    const owner = await admin.post<Client>("/api/clients", newClient());
    const other = await admin.post<Client>("/api/clients", {
      ...newClient({ name: "Other" }),
      allowDuplicate: true,
    });
    const response = await admin.call(
      "POST",
      "/api/events",
      newEvent(owner.id, { pocContactId: other.contacts[0].id }),
    );
    expect(response.status).toBe(400);
  });

  it("filters events by New York date range", async () => {
    const owner = await admin.post<Client>("/api/clients", newClient());
    await admin.post<FlowEvent>(
      "/api/events",
      newEvent(owner.id, { date: "2026-11-14", startTime: "23:30" }),
    );
    expect(
      await admin.get<FlowEvent[]>("/api/events?from=2026-11-14&to=2026-11-14"),
    ).toHaveLength(1);
    expect(
      await admin.get<FlowEvent[]>("/api/events?from=2026-11-15"),
    ).toHaveLength(0);
  });
});

it("writes a domain event in the same transaction as each new client", async () => {
  await admin.post<Client>("/api/clients", newClient());
  const [row] = await db.select().from(clients);
  const queued = await db.select().from(jobs);
  expect(queued.map((job) => job.payload)).toContainEqual({ entityId: row.id });
});
