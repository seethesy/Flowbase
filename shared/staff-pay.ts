import { z } from "zod";
import { id, text } from "./schema-primitives";

// Staff pay and the Payroll tab (FLOW-270). Pay lives in its own tables, never on
// users, so it never rides along on other queries. It is linked to the staff
// member by full name (A4, Ash 2026-11-23): renaming someone in the directory
// renames their pay rows too, and two listed staff can't share a name.
// Admin and Technical read and edit it by default (the Staff pay area, FLOW-269).

export const payTypes = ["hourly", "per_event", "salary"] as const;
export const payTypeSchema = z.enum(payTypes);
export type PayType = z.infer<typeof payTypeSchema>;
export const payTypeLabels: Record<PayType, string> = {
  hourly: "Hourly",
  per_event: "Per event",
  salary: "Salary",
};
// The unit a rate is quoted in, from the pay type.
export const rateUnits = { hourly: "hour", per_event: "event", salary: "year" } as const satisfies Record<PayType, string>;
export type RateUnit = (typeof rateUnits)[PayType];
export const rateUnitValues = ["hour", "event", "year"] as const;
const unitSuffix: Record<RateUnit, string> = { hour: "/ hr", event: "/ event", year: "/ yr" };

const cents = z.number().int().min(0).max(100_000_000);

// "$28.00 / hr" or "$28.00 / hr (bartender)".
export const dollars = (value: number) =>
  `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function rateLabel(rateCents: number | null, unit: RateUnit | null, label = "") {
  if (rateCents === null || !unit) return "";
  return `${dollars(rateCents)} ${unitSuffix[unit]}${label ? ` (${label})` : ""}`;
}

// One person's normal pay. A person with no row yet has every pay field null.
export const staffPaySchema = z.object({
  staffFullName: z.string(),
  payType: payTypeSchema.nullable(),
  rateCents: cents.nullable(),
  rateUnit: z.enum(rateUnitValues).nullable(),
  secondRateCents: cents.nullable(),
  secondRateLabel: z.string(),
});
export type StaffPay = z.infer<typeof staffPaySchema>;

export const staffPayInputSchema = z
  .object({
    staffFullName: text(200).min(1, "Name is required."),
    payType: payTypeSchema.nullable(),
    rateCents: cents.nullable(),
    secondRateCents: cents.nullable(),
    secondRateLabel: text(100).default(""),
  })
  .strict();
export type StaffPayInput = z.input<typeof staffPayInputSchema>;

// Pay for one event or one project that differs from the person's normal rate.
export const payExceptionSchema = z.object({
  id,
  staffFullName: z.string(),
  eventId: id.nullable(),
  eventTitle: z.string().nullable(),
  project: z.string().nullable(),
  amountCents: cents,
  note: z.string(),
});
export type PayException = z.infer<typeof payExceptionSchema>;

const exceptionFields = {
  staffFullName: text(200).min(1, "Name is required."),
  eventId: id.nullable().default(null),
  project: text(200).nullable().default(null),
  amountCents: cents,
  note: text(1000).default(""),
};
const oneTarget = (value: { eventId?: string | null; project?: string | null }) =>
  Boolean(value.eventId) !== Boolean(value.project?.trim());
export const payExceptionInputSchema = z
  .object(exceptionFields)
  .strict()
  .refine(oneTarget, "Choose an event or name a project.");
export type PayExceptionInput = z.input<typeof payExceptionInputSchema>;
export const payExceptionUpdateSchema = z
  .object({
    eventId: id.nullable().optional(),
    project: text(200).nullable().optional(),
    amountCents: cents.optional(),
    note: text(1000).optional(),
  })
  .strict();
export type PayExceptionUpdate = z.infer<typeof payExceptionUpdateSchema>;

// One row of the Payroll tab: a listed staff member (or a pay row whose name no
// longer matches anyone), their normal pay and the hours time tracking recorded
// in the chosen dates (FLOW-167/202).
export const payrollRowSchema = staffPaySchema.extend({
  staffId: id.nullable(),
  status: z.string().nullable(),
  hasAccount: z.boolean(),
  workedSeconds: z.number().int().min(0),
});
export type PayrollRow = z.infer<typeof payrollRowSchema>;

export const payrollSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(payrollRowSchema),
  exceptions: z.array(payExceptionSchema),
});
export type Payroll = z.infer<typeof payrollSchema>;

export const hoursLabel = (seconds: number) => `${(seconds / 3600).toFixed(1)} h`;
