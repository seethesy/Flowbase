import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../../worker/db/schema";
import {
  addListValue,
  assertListLabels,
  getSettings,
  orderListValues,
  renameListValue,
  setListValueArchived,
  settingsHistory,
  updateSetting,
} from "../../worker/records/settings";
import {
  defaultBusinessDefaults,
  defaultCompanyProfile,
  defaultListValues,
  listKeys,
  listOptions,
} from "../../shared/settings";
import type { Actor } from "../../shared/access";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL must point to disposable CI Postgres.");
const connection = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(connection, { schema });
const admin: Actor = {
  userId: "41000000-0000-4000-8000-000000000001",
  role: "admin",
  employmentType: "full_time",
};
// recipe_category starts empty, so this file owns every value in it; seeded lists
// are only read, which keeps the other DB test files independent of this one.
const scratch = "recipe_category" as const;

const cleanUp = async () => {
  await db.delete(schema.listValues).where(eq(schema.listValues.listKey, scratch));
  await db.delete(schema.settings);
  await db
    .delete(schema.auditLog)
    .where(inArray(schema.auditLog.entityType, ["setting", "list_value"]));
};
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(cleanUp);
afterAll(async () => {
  await cleanUp();
  await connection.end();
});

it("starts with the seeded lists and the built-in defaults", async () => {
  const settings = await getSettings(db);
  expect(settings.company).toEqual(defaultCompanyProfile);
  expect(settings.defaults).toEqual(defaultBusinessDefaults);
  expect(settings.defaults.idleCutoffMinutes).toBe(5);
  for (const key of listKeys)
    expect(
      settings.lists[key].map((value) => value.label),
      key,
    ).toEqual(defaultListValues[key]);
  expect(settings.lists.staff_position).toHaveLength(10);
  expect(settings.lists.vehicle.map((v) => v.label)).toEqual([
    "Truck 1",
    "Truck 2",
    "Truck 3",
  ]);
});

it("makes an added value available at once and keeps archived values off new choices", async () => {
  const gala = await addListValue(db, admin, scratch, "Gala");
  const brunch = await addListValue(db, admin, scratch, "Brunch");
  expect([gala.sortOrder, brunch.sortOrder]).toEqual([0, 1]);
  // AC1: available to forms on the next read, no deploy.
  expect((await getSettings(db)).lists[scratch].map((v) => v.label)).toEqual([
    "Gala",
    "Brunch",
  ]);
  await expect(addListValue(db, admin, scratch, "gala")).rejects.toMatchObject({
    status: 409,
    code: "ALREADY_EXISTS",
  });
  const archived = await setListValueArchived(db, admin, gala.id, true);
  expect(archived.archived).toBe(true);
  // AC2: an old record keeps its archived value; new picks can't use it.
  const lists = (await getSettings(db)).lists[scratch];
  expect(listOptions(lists, "Gala")).toEqual([
    { label: "Brunch", archived: false },
    { label: "Gala", archived: true },
  ]);
  expect(listOptions(lists).map((o) => o.label)).toEqual(["Brunch"]);
  await expect(
    assertListLabels(db, scratch, ["Gala"]),
  ).rejects.toMatchObject({ status: 400, code: "INVALID_VALUE" });
  await expect(assertListLabels(db, scratch, ["Gala"], ["Gala"])).resolves.toBeUndefined();
  await expect(assertListLabels(db, scratch, ["Brunch"])).resolves.toBeUndefined();
  // An archived label can be added again; restoring the old one then conflicts.
  await addListValue(db, admin, scratch, "Gala");
  await expect(setListValueArchived(db, admin, gala.id, false)).rejects.toMatchObject({
    status: 409,
  });
});

it("renames and reorders values, refusing values from another list", async () => {
  const a = await addListValue(db, admin, scratch, "Apps");
  const b = await addListValue(db, admin, scratch, "Mains");
  const c = await addListValue(db, admin, scratch, "Desserts");
  expect((await renameListValue(db, admin, a.id, "Appetizers")).label).toBe("Appetizers");
  await expect(renameListValue(db, admin, b.id, "appetizers")).rejects.toMatchObject({
    status: 409,
  });
  const ordered = await orderListValues(db, admin, scratch, [c.id, a.id]);
  expect(ordered.map((v) => v.label)).toEqual(["Desserts", "Appetizers", "Mains"]);
  const [truck] = (await getSettings(db)).lists.vehicle;
  await expect(
    orderListValues(db, admin, scratch, [truck.id]),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    orderListValues(db, admin, scratch, [a.id, a.id]),
  ).rejects.toMatchObject({ status: 400 });
});

it("saves the company profile and defaults and audits every change", async () => {
  const logo = `data:image/png;base64,${"A".repeat(400)}`;
  await updateSetting(db, admin, "company", {
    ...defaultCompanyProfile,
    name: "Acme Catering",
    logo,
  });
  await updateSetting(db, admin, "defaults", {
    ...defaultBusinessDefaults,
    rentalBufferDaysAfter: 2,
    idleCutoffMinutes: 3,
  });
  // Saving the same values again writes no audit row.
  await updateSetting(db, admin, "defaults", {
    ...defaultBusinessDefaults,
    rentalBufferDaysAfter: 2,
    idleCutoffMinutes: 3,
  });
  const settings = await getSettings(db);
  expect(settings.company).toMatchObject({ name: "Acme Catering", logo });
  expect(settings.defaults).toMatchObject({ rentalBufferDaysAfter: 2, idleCutoffMinutes: 3 });
  const value = await addListValue(db, admin, scratch, "Soups");
  await setListValueArchived(db, admin, value.id, true);
  const history = await settingsHistory(db);
  expect(history.map((entry) => [entry.subject, entry.action])).toEqual([
    ["Recipe categories: Soups", "archive"],
    ["Recipe categories: Soups", "create"],
    ["Defaults", "create"],
    ["Company profile", "create"],
  ]);
  const company = history.at(-1)!;
  expect(company.actorId).toBe(admin.userId);
  expect(company.changes.name).toEqual({
    before: defaultCompanyProfile.name,
    after: "Acme Catering",
  });
  // The audit notes the logo changed without storing the image.
  expect(String(company.changes.logo.after)).toMatch(/^image \(422 characters/);
  expect(history[2].changes).toMatchObject({
    rentalBufferDaysAfter: { before: 1, after: 2 },
    idleCutoffMinutes: { before: 5, after: 3 },
  });
});

it("falls back to the defaults for a stored value the schema no longer accepts", async () => {
  await db.insert(schema.settings).values({ key: "defaults", value: { idleCutoffMinutes: "soon" } });
  expect((await getSettings(db)).defaults).toEqual(defaultBusinessDefaults);
  await db.delete(schema.settings);
  await db.insert(schema.settings).values({ key: "defaults", value: { monthlySmsCap: 50 } });
  // Fields added later take their defaults.
  expect((await getSettings(db)).defaults).toEqual({ ...defaultBusinessDefaults, monthlySmsCap: 50 });
  const rows = await db
    .select()
    .from(schema.settings)
    .where(and(eq(schema.settings.key, "defaults")));
  expect(rows).toHaveLength(1);
});
