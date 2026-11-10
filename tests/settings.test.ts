import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  businessDefaultsSchema,
  defaultCleanupTemplate,
  businessSettingsSchema,
  companyProfileSchema,
  defaultListValues,
  fallbackSettings,
  inventoryCategoryList,
  listKeys,
  listOptions,
  MAX_LOGO_LENGTH,
  type ListValue,
} from "../shared/settings";
import { staffUpdateSchema } from "../shared/staff";

it("validates the company profile, accepting only small inline raster logos", () => {
  const profile = { name: " Acme Catering ", website: "acme.example" };
  expect(companyProfileSchema.parse(profile)).toEqual({
    name: "Acme Catering",
    website: "acme.example",
    salesContact: "",
    logo: null,
  });
  expect(companyProfileSchema.safeParse({ name: "" }).success).toBe(false);
  for (const logo of [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
    "data:image/webp;base64,UklGRg==",
  ])
    expect(companyProfileSchema.safeParse({ ...profile, logo }).success).toBe(true);
  for (const logo of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "javascript:alert(1)",
    "https://example.com/logo.png",
    `data:image/png;base64,${"A".repeat(MAX_LOGO_LENGTH)}`,
  ])
    expect(companyProfileSchema.safeParse({ ...profile, logo }).success, logo).toBe(false);
});

it("fills defaults and bounds every business default", () => {
  expect(businessDefaultsSchema.parse({})).toEqual({
    rentalBufferDaysBefore: 1,
    rentalBufferDaysAfter: 1,
    ratioDefaults: [],
    paymentTerms: "",
    addendumReminderDays: 3,
    paymentReminderDays: 3,
    urgentNotificationTypes: ["staff_assigned", "event_day_change", "collector_failure", "beo_changed"],
    monthlySmsCap: 1000,
    freeTierLimits: { workerRequests: 100_000, dbQueries: 100_000,
      r2Bytes: 10 * 1024 ** 3, supabaseBytes: 500 * 1024 ** 2,
      githubMinutes: 2_000 },
    idleCutoffMinutes: 5,
    beoKeyFields: ["date_time", "location", "guest_count", "menu"],
    runOfShowGuestThreshold: 150,
    cleanupTemplate: defaultCleanupTemplate,
  });
  for (const input of [
    { rentalBufferDaysBefore: 31 },
    { rentalBufferDaysAfter: 0.5 },
    { monthlySmsCap: -1 },
    { idleCutoffMinutes: 61 },
    { addendumReminderDays: 0 },
    { paymentReminderDays: 31 },
    { paymentReminderDays: -1 },
    { runOfShowGuestThreshold: 0 },
    { ratioDefaults: [{ category: "Linen", quantity: 0, basis: "per_guest" }] },
    { ratioDefaults: [{ category: "Linen", quantity: 1, basis: "per_hour" }] },
    { urgentNotificationTypes: [""] },
    // No tax rates in the MVP.
    { taxRate: 6 },
  ])
    expect(
      businessDefaultsSchema.strict().safeParse(input).success,
      JSON.stringify(input),
    ).toBe(false);
});

it("offers active values plus a record's archived or older value", () => {
  const values: ListValue[] = [
    { id: "1", listKey: "event_type", label: "Corporate", sortOrder: 0, archived: false },
    { id: "2", listKey: "event_type", label: "Gala", sortOrder: 1, archived: true },
    { id: "3", listKey: "event_type", label: "Wedding", sortOrder: 2, archived: false },
  ];
  expect(listOptions(values).map((o) => o.label)).toEqual(["Corporate", "Wedding"]);
  expect(listOptions(values, "Gala")).toEqual([
    { label: "Corporate", archived: false },
    { label: "Wedding", archived: false },
    { label: "Gala", archived: true },
  ]);
  // A value typed before the list existed (or copied from a lead) stays selectable.
  expect(listOptions(values, "Wedding Catering").at(-1)).toEqual({
    label: "Wedding Catering",
    archived: true,
  });
  expect(listOptions(values, ["Corporate", "Gala"]).map((o) => o.label)).toEqual([
    "Corporate",
    "Wedding",
    "Gala",
  ]);
  expect(listOptions(undefined, "")).toEqual([]);
});

it("picks the category list for each kind of inventory item", () => {
  expect(inventoryCategoryList({ kind: "consumable", subtype: "ingredient" })).toBe(
    "ingredient_category",
  );
  expect(inventoryCategoryList({ kind: "consumable", subtype: "supply" })).toBe(
    "supply_category",
  );
  expect(inventoryCategoryList({ kind: "consumable", subtype: "bar" })).toBeNull();
  expect(inventoryCategoryList({ kind: "rental", subtype: "decor" })).toBe("decor_category");
  expect(inventoryCategoryList({ kind: "rental", subtype: "equipment" })).toBe(
    "kitchen_equipment_category",
  );
  expect(inventoryCategoryList({ kind: "rental", subtype: "linen" })).toBe("rental_category");
  expect(inventoryCategoryList({ kind: "service", subtype: null })).toBeNull();
});

it("keeps the built-in fallback valid and the seed migrations in step with it", () => {
  expect(businessSettingsSchema.parse(fallbackSettings)).toEqual(fallbackSettings);
  const rows = ["0021_seed_settings_lists.sql", "0040_recipe_settings_lists.sql"]
    .flatMap((file) => [
      ...readFileSync(`drizzle/${file}`, "utf8").matchAll(/\('([a-z_]+)', '((?:[^']|'')*)', (\d+)\)/g),
    ].map(([, key, label, order]) => [key, label.replaceAll("''", "'"), Number(order)] as const))
    .sort((a, b) => listKeys.findIndex((key) => key === a[0]) - listKeys.findIndex((key) => key === b[0]) || a[2] - b[2]);
  expect(rows).toEqual(
    listKeys.flatMap((key) => defaultListValues[key].map((label, index) => [key, label, index])),
  );
});

it("accepts only known staff profile fields", () => {
  expect(staffUpdateSchema.parse({ mobile: " 202 555 0101 ", smsConsent: true })).toEqual({
    mobile: "202 555 0101",
    smsConsent: true,
  });
  for (const input of [
    { email: "new@gmail.com" },
    { mobile: "" },
    { positions: ["Server", "Server"] },
    { status: "active" },
  ])
    expect(staffUpdateSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
});
