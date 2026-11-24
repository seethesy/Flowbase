import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Bindings } from "../../../worker/bindings";
import type { Actor, Role } from "../../../shared/access";
import type { Lead } from "../../../shared/leads";
import { emptyLayout, type LayoutDoc } from "../../../shared/layout";

// Field boxes and the record's own data (FLOW-255, FLOW-273): hiding a box never
// changes stored data, and a field added as a box can be edited.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } } as Bindings;

const people = {
  admin: "27300000-0000-4000-8000-000000000001",
  sam: "27300000-0000-4000-8000-000000000002",
  kitchen: "27300000-0000-4000-8000-000000000003",
};
const signedInAs = (userId: string, role: Role) => {
  const actor: Actor = { userId, role };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return (method: string, path: string, body?: unknown) =>
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
};
const admin = signedInAs(people.admin, "admin");
const sam = signedInAs(people.sam, "salesperson");
const kitchen = signedInAs(people.kitchen, "kitchen_lead");

const box = (id: string, field: string, index: number) => ({
  id,
  kind: "field" as const,
  field,
  x: (index % 2) * 6,
  y: Math.floor(index / 2) * 2,
  w: 6,
  h: 2,
});
// The lead page's facts without Source.
const withoutSource: LayoutDoc = {
  ...emptyLayout(),
  fieldBoxes: {
    "lead-facts": { boxes: ["name", "email", "phone", "eventDate", "guestCount"].map((field, i) => box(`field-${i + 1}`, field, i)) },
  },
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table ui_layout, leads, audit_log, jobs, users cascade`);
  await db.insert(schema.users).values(
    ([["admin", "admin"], ["sam", "salesperson"], ["kitchen", "kitchen_lead"]] as const).map(([name, role], i) => ({
      id: people[name],
      email: `${name}@page-layout-fields.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role,
      mobile: `20255573${i}`,
      status: "active" as const,
    })),
  );
});
afterAll(async () => {
  await client.end();
});

const newLead = async () => {
  const response = await admin("POST", "/api/leads", {
    source: "Phone",
    name: "Priya Shah",
    phone: "(202) 555-0177",
    eventDate: "2026-12-12",
    guestCount: 40,
    message: "Rehearsal dinner.",
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Lead;
};

it("AC4: saving a layout that hides Source never changes the lead's stored data", async () => {
  const lead = await newLead();
  const saved = await admin("PUT", "/api/layout/leads.detail", withoutSource);
  expect(saved.status).toBe(200);
  const after = (await (await admin("GET", `/api/leads/${lead.id}`)).json()) as Lead;
  expect(after).toEqual(lead);
  expect(after.source).toBe("Phone");
  // Resetting the layout doesn't touch it either.
  expect((await admin("DELETE", "/api/layout/leads.detail")).status).toBe(204);
  expect((await (await admin("GET", `/api/leads/${lead.id}`)).json()) as Lead).toEqual(lead);
});

it("AC4: a field added as a box (Guests) can be changed through the lead update", async () => {
  const lead = await newLead();
  const changed = await admin("PUT", `/api/leads/${lead.id}`, { guestCount: 75 });
  expect(changed.status).toBe(200);
  expect(((await changed.json()) as Lead).guestCount).toBe(75);
  const cleared = await admin("PUT", `/api/leads/${lead.id}`, { guestCount: null });
  expect(((await cleared.json()) as Lead).guestCount).toBeNull();
  // Out-of-range values are refused and nothing changes.
  expect((await admin("PUT", `/api/leads/${lead.id}`, { guestCount: -1 })).status).toBe(400);
  expect(((await (await admin("GET", `/api/leads/${lead.id}`)).json()) as Lead).guestCount).toBeNull();
});

it("only a role with layout.edit saves a layout", async () => {
  expect((await sam("PUT", "/api/layout/leads.detail", withoutSource)).status).toBe(403);
  expect((await kitchen("PUT", "/api/layout/leads.detail", withoutSource)).status).toBe(403);
  expect((await admin("PUT", "/api/layout/leads.detail", withoutSource)).status).toBe(200);
  // Everyone signed in reads the saved layout.
  expect((await sam("GET", "/api/layout/leads.detail")).status).toBe(200);
});
