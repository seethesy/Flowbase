import { z } from "zod";
import { id, text } from "./schema-primitives";
import { ingredientCategories, ratioBasisSchema } from "./inventory";
import { defaultLeadSources } from "./leads";

// Business settings and configurable lists (FLOW-45). Admin changes them on the
// Settings screen without a deploy; every change is audited. Records keep the
// label they were saved with, so archiving a value never changes an old record.

export const listKeys = [
  "staff_position",
  "event_type",
  "service_type",
  "food_service_style",
  "dress_code",
  "lead_source",
  "vehicle",
  "recipe_category",
  "rental_category",
  "decor_category",
  "kitchen_equipment_category",
  "ingredient_category",
  "supply_category",
] as const;
export const listKeySchema = z.enum(listKeys);
export type ListKey = z.infer<typeof listKeySchema>;
export const listLabels: Record<ListKey, string> = {
  staff_position: "Staff positions",
  event_type: "Event types",
  service_type: "Service types",
  food_service_style: "Food service styles",
  dress_code: "Dress code presets",
  lead_source: "Lead sources",
  vehicle: "Vehicles",
  recipe_category: "Recipe categories",
  rental_category: "Rental categories",
  decor_category: "Decor categories",
  kitchen_equipment_category: "Kitchen equipment categories",
  ingredient_category: "Ingredient categories",
  supply_category: "Supply categories",
};

// The values a fresh database starts with (the seed migration inserts the same
// lists). The app falls back to these while the settings can't be loaded.
export const defaultListValues: Record<ListKey, readonly string[]> = {
  staff_position: [
    "Event Coordinator",
    "Catering Lead/Captain",
    "Chef on site",
    "Sous Chef",
    "Server",
    "Bartender",
    "Bathroom Attendant",
    "Driver",
    "Pull/Load crew",
    "Decor/Setup crew",
  ],
  event_type: ["Corporate", "Wedding"],
  service_type: ["Full Service"],
  food_service_style: ["Stationed", "Buffet", "Plated"],
  dress_code: [],
  lead_source: defaultLeadSources,
  vehicle: ["Truck 1", "Truck 2", "Truck 3"],
  recipe_category: [],
  rental_category: [],
  decor_category: [],
  kitchen_equipment_category: [],
  ingredient_category: ingredientCategories,
  supply_category: [],
};

// Which category list an inventory item's category comes from. Bar categories stay
// built in (shared/inventory.ts): count rounding and bar validation depend on them.
// Services have no category list.
export function inventoryCategoryList(item: {
  kind: string;
  subtype: string | null;
}): ListKey | null {
  if (item.kind === "consumable")
    return item.subtype === "ingredient"
      ? "ingredient_category"
      : item.subtype === "supply"
        ? "supply_category"
        : null;
  if (item.kind !== "rental") return null;
  if (item.subtype === "decor") return "decor_category";
  if (item.subtype === "equipment") return "kitchen_equipment_category";
  return "rental_category";
}

export const listValueSchema = z.object({
  id,
  listKey: listKeySchema,
  label: z.string(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
});
export type ListValue = z.infer<typeof listValueSchema>;
const label = text(100).min(1, "Enter a value.");
export const listValueInputSchema = z.object({ label });
// Renames a value; records saved earlier keep the old label.
export const listValueUpdateSchema = z.object({ label });

// Printed documents' header (FLOW-49). The logo is a small image the browser
// resizes and re-encodes before saving, kept inline with the profile.
export const MAX_LOGO_LENGTH = 200_000;
export const logoSchema = z
  .string()
  .max(MAX_LOGO_LENGTH, "Use a smaller logo image.")
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
    "Upload a PNG, JPEG or WebP image.",
  );
export const companyProfileSchema = z.object({
  name: text(200).min(1, "Company name is required."),
  website: text(200).default(""),
  salesContact: text(500).default(""),
  logo: logoSchema.nullable().default(null),
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

const keyList = z.array(text(100).min(1)).max(100);
const days = z.number().int().min(0).max(30);
export const businessDefaultsSchema = z.object({
  // Days a rental stays reserved before and after its event.
  rentalBufferDaysBefore: days.default(1),
  rentalBufferDaysAfter: days.default(1),
  // Suggested per-guest/table/event quantity for a new item in a category.
  ratioDefaults: z
    .array(
      z.object({
        category: text(100).min(1, "Pick a category."),
        quantity: z
          .number()
          .finite()
          .positive("Enter a quantity above 0.")
          .max(10_000),
        basis: ratioBasisSchema,
      }),
    )
    .max(200)
    .default([])
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.category.toLowerCase())).size ===
        rows.length,
      "Each category can have one ratio default.",
    ),
  paymentTerms: text(2000).default(""),
  // Notification types sent by SMS as well as in the app and by email.
  urgentNotificationTypes: keyList.default([]),
  // SMS messages the app may send in a calendar month; 0 sends none.
  monthlySmsCap: z.number().int().min(0).max(100_000).default(0),
  // Minutes without typing or clicking before time tracking stops (FLOW-119's
  // answer: 5).
  idleCutoffMinutes: z.number().int().min(1).max(60).default(5),
  // BEO fields whose change sends an approved BEO back for approval.
  beoKeyFields: keyList.default([]),
});
export type BusinessDefaults = z.infer<typeof businessDefaultsSchema>;

export const settingKeys = ["company", "defaults"] as const;
export type SettingKey = (typeof settingKeys)[number];
export const settingSchemas = {
  company: companyProfileSchema,
  defaults: businessDefaultsSchema,
} as const;
export const defaultCompanyProfile: CompanyProfile = {
  name: "Flowbase Catering & Events",
  website: "www.example.com",
  salesContact: "Sales · sales@example.com · (555) 010-0100",
  logo: null,
};
export const defaultBusinessDefaults: BusinessDefaults =
  businessDefaultsSchema.parse({});

export const businessSettingsSchema = z.object({
  company: companyProfileSchema,
  defaults: businessDefaultsSchema,
  // Every list, archived values included (flagged), in display order.
  lists: z.record(listKeySchema, listValueSchema.array()),
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

// Built-in settings for when the API can't be reached (demo, first load errors).
export const fallbackSettings: BusinessSettings = {
  company: defaultCompanyProfile,
  defaults: defaultBusinessDefaults,
  lists: Object.fromEntries(
    listKeys.map((key) => [
      key,
      defaultListValues[key].map((label, index) => ({
        id: `00000000-0000-4000-8000-${String(listKeys.indexOf(key) * 1000 + index).padStart(12, "0")}`,
        listKey: key,
        label,
        sortOrder: index,
        archived: false,
      })),
    ]),
  ) as Record<ListKey, ListValue[]>,
};

// The options a form offers: active values, plus the record's current value when
// it is archived or was entered before the list existed, so saving an old record
// never drops its value.
export function listOptions(
  values: readonly ListValue[] | undefined,
  current: string | readonly string[] = [],
): { label: string; archived: boolean }[] {
  const active = (values ?? []).filter((value) => !value.archived);
  const known = new Set(active.map((value) => value.label));
  const kept = (typeof current === "string" ? [current] : current).filter(
    (value) => value && !known.has(value),
  );
  return [
    ...active.map((value) => ({ label: value.label, archived: false })),
    ...[...new Set(kept)].map((value) => ({ label: value, archived: true })),
  ];
}
