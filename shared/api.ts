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
