import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { CopyOverrides } from "../../shared/copy";

// Live text editing (FLOW-240) against Postgres: saving, resetting and who may.
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "c2400000-0000-4000-8000-000000000001",
  manager: "c2400000-0000-4000-8000-000000000002",
  staff: "c2400000-0000-4000-8000-000000000003",
};
const directory: [keyof typeof people, Role, EmploymentType][] = [
  ["admin", "admin", "full_time"],
  ["manager", "sales_manager", "full_time"],
  ["staff", "staff", "part_time"],
];
const signedInAs = (who: keyof typeof people) => {
  const [, role, employmentType] = directory.find(([name]) => name === who)!;
  const actor: Actor = { userId: people[who], role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return async (method: string, path: string, body?: unknown) =>
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
const admin = signedInAs("admin");
const manager = signedInAs("manager");
const staff = signedInAs("staff");
const overrides = async (call = staff) =>
  (await (await call("GET", "/api/copy")).json()) as CopyOverrides;
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { message: string } }).error.message;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table ui_copy`);
  await db
    .insert(schema.users)
    .values(
      directory.map(([name, role, employmentType], i) => ({
        id: people[name],
        email: `${name}@copy.example`,
        name,
        role,
        employmentType,
        mobile: `20255596${i}`,
        status: "active" as const,
      })),
    )
    .onConflictDoNothing({ target: schema.users.id });
});
afterAll(async () => {
  await db.execute(sql`truncate table ui_copy`);
  await db.delete(schema.users).where(inArray(schema.users.id, Object.values(people)));
  await client.end();
});

describe("live text editing", () => {
  it("saves a batch for everyone and records who changed it", async () => {
    expect(await overrides()).toEqual({});
    const saved = await admin("PUT", "/api/copy", [
      { key: "nav.primary.clients", text: "Customers", placeholders: [] },
      { key: "shared.list.empty", text: "Nothing here yet", placeholders: [] },
    ]);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      "nav.primary.clients": "Customers",
      "shared.list.empty": "Nothing here yet",
    });
    // Another user sees the new wording (AC2).
    expect(await overrides(staff)).toEqual({
      "nav.primary.clients": "Customers",
      "shared.list.empty": "Nothing here yet",
    });
    const [row] = await db
      .select()
      .from(schema.uiCopy)
      .where(inArray(schema.uiCopy.key, ["nav.primary.clients"]));
    expect(row.updatedBy).toBe(people.admin);

    // Saving again replaces the text.
    await admin("PUT", "/api/copy", [
      { key: "nav.primary.clients", text: "Accounts", placeholders: [] },
    ]);
    expect((await overrides())["nav.primary.clients"]).toBe("Accounts");
  });

  it("lets only the admin save or reset (AC1)", async () => {
    await admin("PUT", "/api/copy", [
      { key: "nav.primary.clients", text: "Customers", placeholders: [] },
    ]);
    for (const call of [manager, staff]) {
      const put = await call("PUT", "/api/copy", [
        { key: "nav.primary.clients", text: "Mine", placeholders: [] },
      ]);
      expect(put.status).toBe(403);
      expect((await call("DELETE", "/api/copy/nav.primary.clients")).status).toBe(403);
    }
    expect(await overrides()).toEqual({ "nav.primary.clients": "Customers" });
  });

  it("refuses an edit that drops or invents a placeholder, and saves nothing from that batch (AC5)", async () => {
    const dropped = await admin("PUT", "/api/copy", [
      { key: "nav.primary.clients", text: "Customers", placeholders: [] },
      { key: "leads.inbox.count", text: "Some leads", placeholders: ["count"] },
    ]);
    expect(dropped.status).toBe(400);
    expect(await errorOf(dropped)).toBe("Keep {count} in the text.");
    const misspelled = await admin("PUT", "/api/copy", [
      { key: "leads.inbox.count", text: "{cuont} leads", placeholders: ["count"] },
    ]);
    expect(misspelled.status).toBe(400);
    expect(await errorOf(misspelled)).toBe("Keep {count} in the text.");
    const invented = await admin("PUT", "/api/copy", [
      { key: "leads.inbox.count", text: "{count} leads for {name}", placeholders: ["count"] },
    ]);
    expect(invented.status).toBe(400);
    expect(await overrides()).toEqual({});
    // Kept placeholders save, in any order.
    const kept = await admin("PUT", "/api/copy", [
      { key: "leads.inbox.count", text: "Leads: {count}", placeholders: ["count"] },
    ]);
    expect(kept.status).toBe(200);
  });

  it("refuses bad keys, empty text and overlong text", async () => {
    for (const edit of [
      { key: "Not A Key", text: "x", placeholders: [] },
      { key: "single", text: "x", placeholders: [] },
      { key: "nav.primary.clients", text: "   ", placeholders: [] },
      { key: "nav.primary.clients", text: "x".repeat(501), placeholders: [] },
    ])
      expect((await admin("PUT", "/api/copy", [edit])).status, edit.key).toBe(400);
    expect((await admin("PUT", "/api/copy", [])).status).toBe(400);
    expect(await overrides()).toEqual({});
  });

  it("resets a key to its default (AC6)", async () => {
    await admin("PUT", "/api/copy", [
      { key: "nav.primary.clients", text: "Customers", placeholders: [] },
      { key: "shared.list.empty", text: "Nothing here yet", placeholders: [] },
    ]);
    const reset = await admin("DELETE", "/api/copy/nav.primary.clients");
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ "shared.list.empty": "Nothing here yet" });
    // Resetting a key without an override changes nothing.
    expect((await admin("DELETE", "/api/copy/nav.primary.clients")).status).toBe(200);
    expect((await admin("DELETE", "/api/copy/NOT%20A%20KEY")).status).toBe(404);
    // The row is archived, not deleted (ADR-04); saving the key again restores it.
    const [archived] = await db
      .select()
      .from(schema.uiCopy)
      .where(inArray(schema.uiCopy.key, ["nav.primary.clients"]));
    expect(archived.archivedAt).not.toBeNull();
    await admin("PUT", "/api/copy", [
      { key: "nav.primary.clients", text: "Accounts", placeholders: [] },
    ]);
    expect((await overrides())["nav.primary.clients"]).toBe("Accounts");
  });

  it("stores HTML as typed, as text (AC7)", async () => {
    await admin("PUT", "/api/copy", [
      { key: "shared.list.empty", text: "<script>alert(1)</script>", placeholders: [] },
    ]);
    expect((await overrides())["shared.list.empty"]).toBe("<script>alert(1)</script>");
  });
});
