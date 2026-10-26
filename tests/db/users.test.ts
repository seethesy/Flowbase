import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../worker/db/schema";
import {
  changeUser,
  inviteUser,
  listUsers,
  resolveUser,
} from "../../worker/records/users";
import { listHistory, writeAudit } from "../../worker/audit/log";
import { recordSessions, timeReport } from "../../worker/records/time-tracking";
import type { Actor } from "../../shared/access";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must point to disposable CI Postgres.");
const connection = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(connection, { schema });
const admin: Actor = {
  userId: "36000000-0000-4000-8000-000000000001",
  role: "admin",
  employmentType: "full_time",
};
const input = {
  email: "invited@gmail.com",
  role: "staff",
  employmentType: "part_time",
  mobile: "2025550101",
} as const;
const identity = {
  sub: "36000000-0000-4000-8000-000000000002",
  email: input.email,
  name: "Invited Person",
};
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.delete(schema.users);
});
afterAll(async () => {
  await db.delete(schema.users);
  await connection.end();
});

it("adds the allowlist entry, links first Google identity atomically, and preserves staff identity", async () => {
  const invited = await inviteUser(db, admin, input);
  expect(invited.status).toBe("pending");
  expect(invited.activatedAt).toBeNull();
  const actor = await resolveUser(db, identity);
  expect(actor).toEqual({
    userId: invited.id,
    role: "staff",
    employmentType: "part_time",
  });
  expect(await resolveUser(db, identity)).toEqual(actor);
  await db
    .update(schema.users)
    .set({ role: "salesperson", employmentType: "full_time" })
    .where(eq(schema.users.id, invited.id));
  expect(await resolveUser(db, identity)).toMatchObject({
    role: "salesperson",
    employmentType: "full_time",
  });
  expect((await listUsers(db))[0]).toMatchObject({
    id: invited.id,
    name: "Invited Person",
    status: "active",
  });
  expect(await resolveUser(db, { ...identity, sub: admin.userId })).toBeNull();
  await expect(
    inviteUser(db, admin, { ...input, email: input.email.toUpperCase() }),
  ).rejects.toMatchObject({ code: "USER_EXISTS" });
});
it("doesn't create an app user for an uninvited identity", async () => {
  expect(await resolveUser(db, identity)).toBeNull();
  expect(await listUsers(db)).toEqual([]);
});
it("supports resend, revoke, re-invite and deactivation/reactivation without losing name or history", async () => {
  const user = await inviteUser(db, admin, input);
  expect((await changeUser(db, admin, user.id, "resend")).status).toBe(
    "pending",
  );
  await changeUser(db, admin, user.id, "revoke");
  expect(await resolveUser(db, identity)).toBeNull();
  const reissued = await inviteUser(db, admin, input);
  expect(reissued.id).toBe(user.id);
  const actor = (await resolveUser(db, identity))!;
  const entityId = crypto.randomUUID();
  await writeAudit(db, actor, {
    entityType: "client",
    entityId,
    action: "create",
    before: null,
    after: { name: "History fixture" },
  });
  await recordSessions(db, actor, [
    {
      id: crypto.randomUUID(),
      startedAt: "2026-10-20T15:00:00.000Z",
      endedAt: "2026-10-20T15:01:00.000Z",
      activity: "general",
    },
  ]);
  try {
    await changeUser(db, admin, user.id, "deactivate");
    expect(await resolveUser(db, identity)).toBeNull();
    expect((await listUsers(db))[0]).toMatchObject({
      name: identity.name,
      status: "deactivated",
    });
    expect(
      (await listHistory(db, "client", entityId, (v) => v))[0],
    ).toMatchObject({ actorId: user.id, actorName: identity.name });
    const report = await timeReport(db, admin, {
      from: "2026-10-20",
      to: "2026-10-20",
      userId: user.id,
    });
    expect(report.workload).toEqual([
      {
        userId: user.id,
        userName: identity.name,
        activity: "general",
        seconds: 60,
      },
    ]);
    await changeUser(db, admin, user.id, "reactivate");
    expect(await resolveUser(db, identity)).toEqual(actor);
    await expect(
      changeUser(db, admin, user.id, "resend"),
    ).rejects.toMatchObject({ code: "INVALID_USER_STATE" });
    await expect(
      changeUser(db, actor, user.id, "deactivate"),
    ).rejects.toMatchObject({ code: "SELF_DEACTIVATION" });
  } finally {
    await db
      .delete(schema.activitySessions)
      .where(eq(schema.activitySessions.userId, user.id));
    await db
      .delete(schema.auditLog)
      .where(eq(schema.auditLog.entityId, entityId));
  }
});
it("the Auth hook refuses uninvited, revoked, deactivated and non-supported providers before creation", async () => {
  const check = async (email: string, provider = "google") =>
    (
      await connection`select public.flowbase_before_user_created(${JSON.stringify({ user: { email, app_metadata: { provider } } })}::jsonb) as result`
    )[0].result;
  expect(await check(input.email)).toHaveProperty("error");
  const user = await inviteUser(db, admin, input);
  expect(await check(input.email.toUpperCase())).toEqual({});
  // Supabase's Admin invite creates the pending Auth record with provider=email;
  // public email sign-in/sign-up must be disabled in the Supabase configuration.
  expect(await check(input.email, "email")).toEqual({});
  expect(await check(input.email, "github")).toHaveProperty("error");
  await changeUser(db, admin, user.id, "revoke");
  expect(await check(input.email)).toHaveProperty("error");
  await inviteUser(db, admin, input);
  await resolveUser(db, identity);
  await changeUser(db, admin, user.id, "deactivate");
  expect(await check(input.email)).toHaveProperty("error");
});
