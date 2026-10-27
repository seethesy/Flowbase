import { z } from "zod";
import { email, id, text, timestamp } from "./schema-primitives";

// Vendor and distributor directory (FLOW-84): the businesses Flowbase deals with.
// Contacts and the business's account number are FT+ only (F-01-04). Portal
// passwords are never stored: there is no field for one, and the API rejects any
// field named like a password.
export const vendorTypes = [
  "food_distributor",
  "beverage_distributor",
  "rental_vendor",
  // e.g. a DJ or videographer who appears on a BEO timeline.
  "event_partner",
] as const;
export const vendorTypeSchema = z.enum(vendorTypes);
export type VendorType = z.infer<typeof vendorTypeSchema>;
export const vendorTypeLabels: Record<VendorType, string> = {
  food_distributor: "Food distributor",
  beverage_distributor: "Beverage distributor",
  rental_vendor: "Rental vendor",
  event_partner: "Event partner",
};

export const weekdaySchema = z.enum([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);
export type Weekday = z.infer<typeof weekdaySchema>;
export const weekdayLabels: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

// Key names that look like a password, a passcode or another secret (FLOW-84 AC1).
const passwordKey = /pass(word|wd|code|phrase)?|pwd|secret/i;
// The path of the first key in the value named like a password, or null.
export function passwordFieldPath(value: unknown, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = passwordFieldPath(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (passwordKey.test(key)) return [...path, key].join(".");
    const found = passwordFieldPath(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

const portalUrl = text(500).refine(
  (value) => value === "" || /^https?:\/\/\S+$/i.test(value),
  "Enter the portal address, starting with https://.",
);

export const vendorContactInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, "Contact name is required.").max(200),
  // Free text: sales rep, account manager, dispatch…
  role: text(100).default(""),
  email: email.default(""),
  phone: text(40).default(""),
});
export type VendorContactInput = z.input<typeof vendorContactInputSchema>;

export const vendorFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  type: vendorTypeSchema,
  portalUrl: portalUrl.default(""),
  // FT+ only; omitted keeps the stored value.
  accountNumber: text(100).optional(),
  // FT+ only; omitted keeps the stored contacts.
  contacts: z.array(vendorContactInputSchema).max(20).optional(),
  // e.g. "Tuesday 2 pm for Thursday delivery".
  orderCutoff: text(200).default(""),
  deliveryDays: z
    .array(weekdaySchema)
    .max(7)
    .default([])
    .refine(
      (days) => new Set(days).size === days.length,
      "Pick each delivery day once.",
    ),
  minimumOrderCents: z.number().int().min(0).max(100_000_000).nullable().default(null),
  // Days' notice the vendor needs before a delivery or rental.
  leadTimeDays: z.number().int().min(0).max(365).nullable().default(null),
  orderingInstructions: text(5000).default(""),
  notes: text(5000).default(""),
});
export type VendorInput = z.input<typeof vendorFieldsSchema>;
// What the API accepts: the vendor fields, after refusing anything named like a
// password anywhere in the body.
export const vendorInputSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const path = passwordFieldPath(value);
    if (path)
      ctx.addIssue({
        code: "custom",
        message: `Flowbase never stores portal passwords. Remove the "${path}" field.`,
      });
  })
  .pipe(vendorFieldsSchema);

// What the vendor supplies (AC2): consumables they're the preferred vendor for,
// and rentals sub-rented from them (FLOW-75).
export const vendorItemSchema = z.object({
  id,
  name: z.string(),
  code: z.string(),
  kind: z.enum(["rental", "consumable", "service"]),
  subtype: z.string().nullable(),
  relation: z.enum(["supplies", "sub_rental"]),
});
export type VendorItem = z.infer<typeof vendorItemSchema>;

export const vendorContactSchema = z.object({
  id,
  name: z.string(),
  role: z.string(),
  email: z.string(),
  phone: z.string(),
});
export const vendorSchema = z.object({
  id,
  name: z.string(),
  type: vendorTypeSchema,
  portalUrl: z.string(),
  // null when the caller isn't FT+.
  accountNumber: z.string().nullable(),
  contacts: z.array(vendorContactSchema).nullable(),
  orderCutoff: z.string(),
  deliveryDays: z.array(weekdaySchema),
  minimumOrderCents: z.number().int().nullable(),
  leadTimeDays: z.number().int().nullable(),
  orderingInstructions: z.string(),
  notes: z.string(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Vendor = z.infer<typeof vendorSchema>;
// The vendor page: the vendor and the items they supply.
export const vendorDetailSchema = vendorSchema.extend({
  items: z.array(vendorItemSchema),
});
export type VendorDetail = z.infer<typeof vendorDetailSchema>;
