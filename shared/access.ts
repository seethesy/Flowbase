import { z } from "zod";

// Roles from the architecture terms. shared/policy.ts owns
// the role/action matrix. The Worker loads both from the stored user on every request.
export const roles = [
  "admin",
  "technical",
  "sales_manager",
  "salesperson",
  "kitchen_lead",
  "kitchen_staff",
  "staff",
  "part_time_staff",
] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;
export const actorSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
});
// Older test fixtures still pass the former employment category. Authorization
// reads only role; the parsed actor and persisted user no longer contain it.
export type EmploymentType = "full_time" | "part_time";
export const employmentTypes = ["full_time", "part_time"] as const;
export type Actor = z.infer<typeof actorSchema> & { employmentType?: EmploymentType };

// The former part-time Staff permission boundary is now a dedicated role.
export const isFtPlus = (actor: Actor) => actor.role !== "part_time_staff";
