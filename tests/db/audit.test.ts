import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { auditLog } from "../../worker/db/schema";
import type { Db } from "../../worker/db/client";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import { updateClient } from "../../worker/records/clients";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { HistoryEntry } from "../../shared/audit";
import type { Client, ClientInput, Venue, VenueInput } from "../../shared/core-records";

// Audit log and record history (FLOW-41).
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
  admin: "b0000000-0000-4000-8000-000000000001",
  sam: "b0000000-0000-4000-8000-000000000002",
  sue: "b0000000-0000-4000-8000-000000000003",
};
const as = (
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
  const expectJson = async <T>(response: Response, status: number) => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };
  return {
    actor,
    call,
    get: async <T>(path: string) => expectJson<T>(await call("GET", path), 200),
    post: async <T>(path: string, body: unknown, status = 201) =>
      expectJson<T>(await call("POST", path, body), status),
    put: async <T>(path: string, body: unknown) =>
      expectJson<T>(await call("PUT", path, body), 200),
  };
};
const admin = as(people.admin, "admin");
const sam = as(people.sam, "salesperson");
const sue = as(people.sue, "salesperson");
const partTimeSam = as(people.sam, "salesperson", "part_time");
const partTimeStaff = as("b0000000-0000-4000-8000-000000000004", "staff", "part_time");

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
const asInput = (saved: Client): ClientInput => ({
  name: saved.name,
  kind: saved.kind,
  notes: saved.notes,
  tags: saved.tags,
  contacts: saved.contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    role: contact.role,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    notes: contact.notes,
  })),
});
const rowsFor = (entityId: string) =>
  db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(auditLog.createdAt);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table audit_log, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("audit rows", () => {
  it("records the create with the actor", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    const [row] = await rowsFor(created.id);
    expect(row).toMatchObject({
      entityType: "client",
      action: "create",
      createdBy: people.sam,
    });
    expect(row.changes.name).toEqual({ before: null, after: "Juniper & Co." });
  });

  it("writes one row with only the changed fields on update", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    await sam.put(`/api/clients/${created.id}`, {
      ...asInput(created),
      name: "Juniper Events",
    });
    const rows = await rowsFor(created.id);
    expect(rows.map((row) => row.action)).toEqual(["create", "update"]);
    expect(rows[1].changes).toEqual({
      name: { before: "Juniper & Co.", after: "Juniper Events" },
    });
  });

  it("writes no row for an update that changes nothing", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    await sam.put(`/api/clients/${created.id}`, asInput(created));
    expect((await rowsFor(created.id)).map((row) => row.action)).toEqual([
      "create",
    ]);
  });

  it("records contact changes inside the client's row", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    const input = asInput(created);
    input.contacts[0].email = "olivia@new.example";
    await sam.put(`/api/clients/${created.id}`, input);
    const [, update] = await rowsFor(created.id);
    expect(Object.keys(update.changes)).toEqual(["contacts"]);
  });

  it("records archive and restore", async () => {
    const created = await admin.post<Venue>("/api/venues", {
      name: "Glasshouse",
      areas: [],
    } satisfies VenueInput);
    await admin.post(`/api/venues/${created.id}/archive`, {}, 200);
    await admin.post(`/api/venues/${created.id}/restore`, {}, 200);
    const rows = await rowsFor(created.id);
    expect(rows.map((row) => row.action)).toEqual([
      "create",
      "archive",
      "restore",
    ]);
    expect(Object.keys(rows[1].changes)).toEqual(["archivedAt"]);
  });

  it("is written in the change's transaction: a rolled-back update leaves no row", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    await db
      .transaction(async (tx) => {
        await updateClient(tx as unknown as Db, sam.actor, created.id, {
          ...asInput(created),
          name: "Never saved",
          contacts: [],
        } as never);
        tx.rollback();
      })
      .catch(() => undefined);
    expect(await sam.get<Client>(`/api/clients/${created.id}`)).toMatchObject({
      name: "Juniper & Co.",
    });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, created.id), eq(auditLog.action, "update")));
    expect(rows).toEqual([]);
  });
});

describe("history endpoint", () => {
  it("returns the history newest first to anyone who can see the record", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    await sam.put(`/api/clients/${created.id}`, {
      ...asInput(created),
      notes: "Prefers email",
    });
    const history = await sam.get<HistoryEntry[]>(
      `/api/clients/${created.id}/history`,
    );
    expect(history.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(history[0]).toMatchObject({
      actorId: people.sam,
      changes: { notes: { before: "", after: "Prefers email" } },
    });
    expect(Date.parse(history[0].at)).not.toBeNaN();
  });

  it("answers 404 for a record the caller can't see", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    expect(
      (await sue.call("GET", `/api/clients/${created.id}/history`)).status,
    ).toBe(404);
  });

  it("hides contact email and phone from part-time users", async () => {
    const created = await sam.post<Client>("/api/clients", newClient());
    const emailOnly = asInput(created);
    emailOnly.contacts[0].email = "olivia@new.example";
    await sam.put(`/api/clients/${created.id}`, emailOnly);
    const renamed = { ...emailOnly, contacts: [{ ...emailOnly.contacts[0] }] };
    renamed.contacts[0].name = "Olivia B.";
    await sam.put(`/api/clients/${created.id}`, renamed);

    const full = await sam.get<HistoryEntry[]>(
      `/api/clients/${created.id}/history`,
    );
    expect(full.map((entry) => entry.action)).toEqual([
      "update",
      "update",
      "create",
    ]);
    const partTime = await partTimeSam.get<HistoryEntry[]>(
      `/api/clients/${created.id}/history`,
    );
    // The email-only change disappears; the rename shows without contact details.
    expect(partTime.map((entry) => entry.action)).toEqual(["update", "create"]);
    expect(JSON.stringify(partTime)).not.toContain("olivia@");
    expect(JSON.stringify(partTime)).not.toContain("555-0101");
    expect(partTime[0].changes.contacts.after).toEqual([
      expect.objectContaining({ name: "Olivia B.", email: null, phone: null }),
    ]);
  });

  it("hides the possible-duplicate match from salespeople", async () => {
    await sue.post<Client>("/api/clients", newClient());
    const flagged = await sam.post<Client>(
      "/api/clients",
      newClient({ name: "Juniper (Sam)" }),
    );
    const own = await sam.get<HistoryEntry[]>(
      `/api/clients/${flagged.id}/history`,
    );
    expect(own[0].changes).not.toHaveProperty("possibleDuplicateOf");
    const managed = await admin.get<HistoryEntry[]>(
      `/api/clients/${flagged.id}/history`,
    );
    expect(managed[0].changes).toHaveProperty("possibleDuplicateOf");
  });

  it("hides venue contacts from part-time users", async () => {
    const created = await admin.post<Venue>("/api/venues", {
      name: "Glasshouse",
      areas: [{ name: "Lawn" }],
      contacts: [
        { name: "Mara", role: "manager", email: "mara@glass.example", phone: "" },
      ],
    } satisfies VenueInput);
    const history = await partTimeStaff.get<HistoryEntry[]>(
      `/api/venues/${created.id}/history`,
    );
    expect(history).toHaveLength(1);
    expect(history[0].changes).not.toHaveProperty("contacts");
    expect(history[0].changes.areas.after).toEqual([
      expect.objectContaining({ name: "Lawn" }),
    ]);
  });
});
