import { z } from "zod";
import type { JSONContent } from "@tiptap/core";
import { id, text, timestamp } from "./schema-primitives";

export const sopContentSchema = z.custom<JSONContent>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as { type?: unknown }).type !== "doc" ||
    !Array.isArray((value as { content?: unknown }).content)) return false;
  const serialized = JSON.stringify(value);
  return serialized !== undefined && serialized.length <= 100_000;
}, "Enter a valid SOP document under 100 KB.");

export const sopInputSchema = z.object({
  title: text(200).min(1, "Enter an SOP title."),
  category: text(100).min(1, "Enter a category."),
  content: sopContentSchema,
});
export type SopInput = z.infer<typeof sopInputSchema>;
export const sopUpdateSchema = sopInputSchema.extend({ version: z.number().int().positive() });
export type SopUpdate = z.infer<typeof sopUpdateSchema>;
export const sopSummarySchema = z.object({
  id, title: z.string(), category: z.string(), version: z.number().int().positive(),
  updatedAt: timestamp,
});
export type SopSummary = z.infer<typeof sopSummarySchema>;
export const sopVersionSchema = z.object({
  id, version: z.number().int().positive(), title: z.string(), category: z.string(),
  content: sopContentSchema, editedBy: id.nullable(), editorName: z.string().nullable(),
  editedAt: timestamp,
});
export type SopVersion = z.infer<typeof sopVersionSchema>;
export const sopSchema = sopSummarySchema.extend({
  content: sopContentSchema,
  history: z.array(sopVersionSchema),
});
export type Sop = z.infer<typeof sopSchema>;
