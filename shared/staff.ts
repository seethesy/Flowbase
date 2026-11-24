import { z } from "zod";
import { roleSchema } from "./access";
import { id, text } from "./schema-primitives";
import { userStatuses } from "./users";

// Staff directory and profiles (FLOW-40): one list of staff with the positions they
// can work, used by tasks, staffing and the truck log. A staff
// member is a user (shared/users.ts); revoked invitations aren't listed.
//
// Staff without accounts (FLOW-270 A3): an Admin adds them with a name, phone and
// positions. They have no email, no invite and no sign-in, their Role is blank,
// they can be scheduled on event shifts, and they never receive notifications.
export const staffMemberSchema = z.object({
  id,
  name: z.string(),
  // Empty for staff without an account.
  email: z.string(),
  secondaryEmail: z.email().nullable(),
  // Visible to FT+ and to the person themselves (staff_contact); null otherwise.
  mobile: z.string().nullable(),
  // Blank (null) for staff without an account (FLOW-270 A3).
  role: roleSchema.nullable(),
  // False for staff added without a Flowbase account: no sign-in, no notifications.
  hasAccount: z.boolean(),
  status: z.enum(userStatuses),
  // Active staff can sign in and be staffed; pending and deactivated staff can't.
  active: z.boolean(),
  positions: z.array(z.string()),
  // FT+ only (staff_notes); null otherwise.
  notes: z.string().nullable(),
  // The SMS opt-in and when it was given. STOP replies are honored by the SMS
  // channel (FLOW-52).
  smsConsent: z.boolean(),
  smsConsentAt: z.iso.datetime().nullable(),
  // Staff pay (FLOW-270): present only for people who may read pay (Admin and
  // Technical by default, the Staff pay area of FLOW-269). Everyone else's
  // response has no pay keys at all.
  payType: z.enum(["hourly", "per_event", "salary"]).nullable().optional(),
  payRate: z.string().optional(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

const mobile = text(40).min(1, "Mobile number is required.");
export const staffUpdateSchema = z
  .object({
    name: text(200).min(1, "Name is required.").optional(),
    mobile: mobile.optional(),
    secondaryEmail: z.union([z.email(), z.literal("")]).nullable().optional(),
    role: roleSchema.optional(),
    positions: z
      .array(text(100).min(1))
      .max(30)
      .refine(
        (values) => new Set(values).size === values.length,
        "List each position once.",
      )
      .optional(),
    notes: text(5000).optional(),
    smsConsent: z.boolean().optional(),
    // Active or Inactive for staff without an account (FLOW-270 A3); people
    // with an account change status in Settings › Users.
    status: z.enum(["active", "deactivated"]).optional(),
  })
  .strict();
export type StaffUpdate = z.infer<typeof staffUpdateSchema>;

// An Admin adds a staff member who has no Flowbase account (FLOW-270 A3).
export const staffCreateSchema = z
  .object({
    name: text(200).min(1, "Name is required."),
    mobile: text(40).default(""),
    positions: z
      .array(text(100).min(1))
      .max(30)
      .refine((values) => new Set(values).size === values.length, "List each position once.")
      .default([]),
  })
  .strict();
export type StaffCreate = z.input<typeof staffCreateSchema>;
// What anyone may change on their own profile; everything else is Admin's.
export const selfEditableStaffFields = ["mobile", "secondaryEmail", "smsConsent"] as const;

