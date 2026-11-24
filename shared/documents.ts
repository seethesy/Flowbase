import { z } from "zod";
import { recordTypeSchema } from "./attachments";
import { id, text, timestamp } from "./schema-primitives";

export const documentTypes = ["proposal", "contract", "beo", "invoice", "menu", "photo", "sop", "template", "other"] as const;
export const documentTypeSchema = z.enum(documentTypes);
export type DocumentType = z.infer<typeof documentTypeSchema>;
export const documentTypeLabels: Record<DocumentType, string> = {
  proposal: "Proposals", contract: "Contracts", beo: "BEOs", invoice: "Invoices & receipts",
  menu: "Menus", photo: "Photos", sop: "SOPs", template: "Templates", other: "Other",
};
export const documentVersionSchema = z.object({
  id,
  number: z.number().int().positive(),
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  contentType: z.string(),
  url: z.string().url().nullable(),
  createdAt: timestamp,
  uploadedBy: id.nullable(),
  uploaderName: z.string().nullable(),
});
export const documentSchema = z.object({
  id,
  name: z.string(),
  docType: documentTypeSchema,
  recordType: recordTypeSchema,
  recordId: id,
  // The file's group: "recipe_book" for a stored client recipe book (FLOW-301).
  group: z.string().default(""),
  protected: z.boolean(),
  updatedAt: timestamp,
  versions: documentVersionSchema.array(),
});
export type Document = z.infer<typeof documentSchema>;
export const documentChangeSchema = z.object({
  name: text(200).min(1).optional(),
  docType: documentTypeSchema.optional(),
  recordType: recordTypeSchema.optional(),
  recordId: id.optional(),
}).strict();
export const documentUploadSchema = z.object({
  name: text(200).min(1),
  docType: documentTypeSchema,
  recordType: recordTypeSchema,
  recordId: id.optional(),
  fileName: text(200).min(1),
  contentType: z.string(),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  documentId: id.optional(),
});
export const documentUploadTicketSchema = z.object({
  id,
  url: z.string().url(),
  headers: z.record(z.string(), z.string()),
});
