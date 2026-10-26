import { z } from "zod";

// Roles and employment type from the architecture terms. shared/policy.ts owns
// the role/action matrix. The Worker loads both from the stored user on every request.
export const roles = [
  "admin",
  "technical",
  "sales_manager",
  "salesperson",
  "kitchen_lead",
  "kitchen_staff",
  "staff",
] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;
export const employmentTypes = ["full_time", "part_time"] as const;
export const employmentTypeSchema = z.enum(employmentTypes);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;
export const actorSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
  employmentType: employmentTypeSchema,
});
export type Actor = z.infer<typeof actorSchema>;

// "FT+" = any full-time user plus Admin, Technical and Sales Manager.
export const isFtPlus = (actor: Actor) =>
  actor.employmentType === "full_time" ||
  actor.role === "admin" ||
  actor.role === "technical" ||
  actor.role === "sales_manager";
