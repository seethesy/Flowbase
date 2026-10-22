import { z } from "zod";
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().uuid(),
  }),
});
export const healthSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  database: z.enum(["reachable", "unreachable", "not_configured"]),
});
export type DatabaseStatus = z.infer<typeof healthSchema>["database"];
export const connectionCheckInputSchema = z.object({
  note: z.string().trim().min(1).max(200),
});
export const connectionCheckSchema = z.object({
  id: z.string().uuid(),
  note: z.string(),
  createdAt: z.string().datetime(),
});
export type ConnectionCheck = z.infer<typeof connectionCheckSchema>;
