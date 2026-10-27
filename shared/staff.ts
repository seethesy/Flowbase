import { z } from "zod";
import { employmentTypeSchema, roleSchema } from "./access";
import { id, text } from "./schema-primitives";
import { userStatuses } from "./users";

// Staff directory and profiles (FLOW-40): one list of staff with the positions they
// can work, used by tasks, staffing, the truck log and the day-of board. A staff
// member is a user (shared/users.ts); revoked invitations aren't listed.
export const staffMemberSchema = z.object({
  id,
  name: z.string(),
  email: z.string(),
  // Visible to FT+ and to the person themselves (staff_contact); null otherwise.
  mobile: z.string().nullable(),
  role: roleSchema,
  employmentType: employmentTypeSchema,
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
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

const mobile = text(40).min(1, "Mobile number is required.");
export const staffUpdateSchema = z
  .object({
    name: text(200).min(1, "Name is required.").optional(),
    mobile: mobile.optional(),
    role: roleSchema.optional(),
    employmentType: employmentTypeSchema.optional(),
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
  })
  .strict();
export type StaffUpdate = z.infer<typeof staffUpdateSchema>;
// What anyone may change on their own profile; everything else is Admin's.
export const selfEditableStaffFields = ["mobile", "smsConsent"] as const;

