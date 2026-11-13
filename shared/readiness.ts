import { z } from "zod";
import { id } from "./schema-primitives";

export const readinessKindSchema = z.enum(["responsibility", "schedule", "resource", "quantity", "data_gap"]);
export type ReadinessKind = z.infer<typeof readinessKindSchema>;
export const readinessCheckSchema = z.object({
  key: z.string(), kind: readinessKindSchema, question: z.string(), signature: z.string(),
  state: z.enum(["open", "answered", "dismissed"]), response: z.string().nullable(),
  respondedBy: id.nullable(), respondedAt: z.string().nullable(),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export const readinessResponseSchema = z.object({
  signature: z.string(), state: z.enum(["answered", "dismissed"]),
  response: z.string().trim().max(2000).default(""),
});
