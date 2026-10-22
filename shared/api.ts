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

export const jobStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
]);
export const jobSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: jobStatusSchema,
  attempts: z.number().int(),
  runAt: z.string().datetime(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Job = z.infer<typeof jobSchema>;
export const ingestReceiptSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  sourceRecordId: z.string(),
  jobId: z.string().uuid().nullable(),
  jobStatus: jobStatusSchema.nullable(),
  lastError: z.string().nullable(),
  processedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type IngestReceipt = z.infer<typeof ingestReceiptSchema>;
