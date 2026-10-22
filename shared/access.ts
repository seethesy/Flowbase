import { z } from "zod";

// Roles and employment type from the architecture terms. FLOW-38 owns the full
// permission matrix; until sign-in (FLOW-36) exists, no request carries an actor.
export const roleSchema = z.enum([
  "admin",
  "technical",
  "sales_manager",
  "salesperson",
  "kitchen_lead",
  "kitchen_staff",
  "staff",
]);
export type Role = z.infer<typeof roleSchema>;
export const employmentTypeSchema = z.enum(["full_time", "part_time"]);
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
