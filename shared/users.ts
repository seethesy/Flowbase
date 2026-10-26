import { z } from "zod";
import { employmentTypeSchema, roleSchema } from "./access";

export const userStatuses = [
  "pending",
  "active",
  "deactivated",
  "revoked",
] as const;
export const inviteInputSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  role: roleSchema,
  employmentType: employmentTypeSchema,
  mobile: z.string().trim().min(1, "Mobile number is required.").max(40),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;
export const userActionSchema = z.enum([
  "resend",
  "revoke",
  "deactivate",
  "reactivate",
]);
export type UserAction = z.infer<typeof userActionSchema>;
export const userSchema = inviteInputSchema.extend({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(userStatuses),
  invitedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
});
export type User = z.infer<typeof userSchema>;
export const authConfigSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

export function nextUserStatus(
  status: User["status"],
  action: UserAction,
): User["status"] | null {
  if (status === "pending" && action === "resend") return "pending";
  if (status === "pending" && action === "revoke") return "revoked";
  if (status === "active" && action === "deactivate") return "deactivated";
  if (status === "deactivated" && action === "reactivate") return "active";
  return null;
}
