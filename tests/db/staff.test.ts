import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "../../worker/db/schema";
import {
  getStaffMember,
  listStaff,
  updateStaffMember,
} from "../../worker/records/staff";
import { changeUser, inviteUser, resolveUser } from "../../worker/records/users";
import type { Actor } from "../../shared/access";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must point to disposable CI Postgres.");
const connection = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(connection, { schema });
const system: Actor = {
  userId: "42000000-0000-4000-8000-000000000000",
  role: "admin",
  employmentType: "full_time",
};

let invited = 0;
const invite = async (
  email: string,
  role: Actor["role"],
  employmentType: Actor["employmentType"],
): Promise<Actor> => {
  const user = await inviteUser(db, system, {
    email,
    role,
    employmentType,
    mobile: `20255501${String(++invited).padStart(2, "0")}`,
  });
  await db
    .update(schema.users)
    .set({ status: "active", name: email.split("@")[0] })
    .where(eq(schema.users.id, user.id));
  return { userId: user.id, role, employmentType };
};
let admin: Actor;
let partTime: Actor;
let fullTime: Actor;
const cleanUp = async () => {
  await db.delete(schema.auditLog).where(eq(schema.auditLog.entityType, "user"));
  await db.delete(schema.users);
};
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await cleanUp();
  admin = await invite("admin@gmail.com", "admin", "full_time");
  partTime = await invite("server@gmail.com", "staff", "part_time");
  fullTime = await invite("lead@gmail.com", "kitchen_lead", "full_time");
});
afterAll(async () => {
  await cleanUp();
  await connection.end();
});

it("lists staff for everyone, showing phone numbers to FT+ and to the person only", async () => {
  await updateStaffMember(db, admin, fullTime.userId, { notes: "Drives the box truck" });
  const pending = await inviteUser(db, system, {
    email: "new@gmail.com",
    role: "staff",
    employmentType: "part_time",
    mobile: "2025550000",
  });
  const revoked = await inviteUser(db, system, {
    email: "gone@gmail.com",
    role: "staff",
    employmentType: "part_time",
    mobile: "2025550001",
  });
  await changeUser(db, system, revoked.id, "revoke");
  const seenByPartTime = await listStaff(db, partTime);
  expect(seenByPartTime.map((m) => m.email).sort()).toEqual([
    "admin@gmail.com",
    "lead@gmail.com",
    "new@gmail.com",
    "server@gmail.com",
  ]);
  const byId = new Map(seenByPartTime.map((m) => [m.id, m]));
  // AC3: own number visible, everyone else's hidden; notes hidden.
  expect(byId.get(partTime.userId)!.mobile).toMatch(/^202555/);
  expect(byId.get(fullTime.userId)).toMatchObject({ mobile: null, notes: null });
  expect(byId.get(pending.id)).toMatchObject({ active: false, status: "pending" });
  const seenByFullTime = await getStaffMember(db, fullTime, partTime.userId);
  expect(seenByFullTime.mobile).toMatch(/^202555/);
  expect((await getStaffMember(db, fullTime, fullTime.userId)).notes).toBe(
    "Drives the box truck",
  );
  await expect(getStaffMember(db, partTime, revoked.id)).rejects.toMatchObject({
    status: 404,
  });
});

it("lets a user change only their own phone number and SMS consent", async () => {
  const saved = await updateStaffMember(db, partTime, partTime.userId, {
    mobile: "2025550188",
    smsConsent: true,
  });
  expect(saved).toMatchObject({ mobile: "2025550188", smsConsent: true });
  const consentedAt = saved.smsConsentAt;
  expect(consentedAt).not.toBeNull();
  // Consent again keeps the original opt-in date; opting out clears it.
  expect(
    (await updateStaffMember(db, partTime, partTime.userId, { smsConsent: true }))
      .smsConsentAt,
  ).toBe(consentedAt);
  expect(
    await updateStaffMember(db, partTime, partTime.userId, { smsConsent: false }),
  ).toMatchObject({ smsConsent: false, smsConsentAt: null });
  for (const input of [{ positions: ["Server"] }, { name: "New name" }, { role: "admin" as const }])
    await expect(
      updateStaffMember(db, partTime, partTime.userId, input),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    updateStaffMember(db, partTime, fullTime.userId, { mobile: "2025550111" }),
  ).rejects.toMatchObject({ status: 403 });
  const [row] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, fullTime.userId));
  expect(row.mobile).not.toBe("2025550111");
});

it("lets Admin edit everything, with positions from the configurable list, and audits it", async () => {
  const saved = await updateStaffMember(db, admin, partTime.userId, {
    name: "Sam Server",
    employmentType: "full_time",
    role: "kitchen_staff",
    positions: ["Server", "Bartender"],
    notes: "Prefers weekends",
  });
  expect(saved).toMatchObject({
    name: "Sam Server",
    employmentType: "full_time",
    role: "kitchen_staff",
    positions: ["Server", "Bartender"],
    notes: "Prefers weekends",
  });
  // The sign-in actor picks up the new role on the next request.
  const [row] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, partTime.userId));
  expect(row.role).toBe("kitchen_staff");
  await expect(
    updateStaffMember(db, admin, partTime.userId, { positions: ["Juggler"] }),
  ).rejects.toMatchObject({ status: 400, code: "INVALID_VALUE" });
  // A position archived after it was given stays on the profile.
  const [bartender] = await db
    .select()
    .from(schema.listValues)
    .where(
      and(
        eq(schema.listValues.listKey, "staff_position"),
        eq(schema.listValues.label, "Bartender"),
      ),
    );
  await db
    .update(schema.listValues)
    .set({ archivedAt: new Date() })
    .where(eq(schema.listValues.id, bartender.id));
  try {
    await expect(
      updateStaffMember(db, admin, partTime.userId, {
        positions: ["Bartender", "Driver"],
      }),
    ).resolves.toMatchObject({ positions: ["Bartender", "Driver"] });
    await expect(
      updateStaffMember(db, admin, fullTime.userId, { positions: ["Bartender"] }),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
  } finally {
    await db
      .update(schema.listValues)
      .set({ archivedAt: null })
      .where(eq(schema.listValues.id, bartender.id));
  }
  await expect(
    updateStaffMember(db, admin, admin.userId, { role: "staff" }),
  ).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE" });
  const audit = await db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.entityType, "user"),
        eq(schema.auditLog.entityId, partTime.userId),
      ),
    );
  expect(audit).toHaveLength(2);
  expect(audit.every((entry) => entry.createdBy === admin.userId)).toBe(true);
  expect(audit.map((entry) => entry.changes.positions?.after)).toContainEqual([
    "Server",
    "Bartender",
  ]);
});

it("keeps a name Admin set before the first Google sign-in", async () => {
  const named = await inviteUser(db, system, {
    email: "named@gmail.com",
    role: "staff",
    employmentType: "part_time",
    mobile: "2025550123",
  });
  await updateStaffMember(db, admin, named.id, { name: "Pat Named" });
  await resolveUser(db, {
    sub: "42000000-0000-4000-8000-000000000009",
    email: "named@gmail.com",
    name: "Google Name",
  });
  expect((await getStaffMember(db, admin, named.id)).name).toBe("Pat Named");
});
