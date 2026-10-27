import { z } from "zod";

// Attachments and photos (FLOW-42, ADR-08). The browser resizes photos to a
// thumbnail and a display size and uploads only those; documents upload as-is.
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
export const DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
// What the user may pick, checked before anything is uploaded.
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
// What may be stored for each resized photo variant.
export const MAX_VARIANT_BYTES = 5 * 1024 * 1024;
export const PHOTO_SIZES = { thumb: 320, display: 1600 } as const;
export const UPLOAD_URL_SECONDS = 300;
export const DOWNLOAD_URL_SECONDS = 300;

export const recordTypeSchema = z.enum([
  "client",
  "venue",
  "event",
  "inventory_item",
  "recipe",
]);
export type AttachmentRecordType = z.infer<typeof recordTypeSchema>;
export const variantNameSchema = z.enum(["thumb", "display", "original"]);
export type VariantName = z.infer<typeof variantNameSchema>;

const variantInput = z.object({
  name: variantNameSchema,
  contentType: z.string(),
  size: z.number().int().positive(),
});
export const uploadRequestSchema = z
  .object({
    recordType: recordTypeSchema,
    recordId: z.string().uuid(),
    // Optional grouping on a record, e.g. a venue's "floor_plan" or "aerial".
    group: z
      .string()
      .trim()
      .max(40)
      .regex(/^[a-z_]*$/)
      .default(""),
    fileName: z.string().trim().min(1).max(200),
    caption: z.string().trim().max(500).default(""),
    variants: z.array(variantInput).min(1).max(2),
  })
  .superRefine((value, ctx) => {
    const names = value.variants.map((variant) => variant.name).sort();
    const photo = names.join() === "display,thumb";
    const document = names.join() === "original";
    if (!photo && !document)
      return ctx.addIssue({
        code: "custom",
        message: "Upload a resized photo (thumb and display) or one document.",
      });
    for (const variant of value.variants) {
      const allowed = photo
        ? ["image/jpeg", "image/webp", "image/png"].includes(variant.contentType)
        : DOCUMENT_TYPES.includes(variant.contentType);
      if (!allowed)
        ctx.addIssue({
          code: "custom",
          message: "This file type isn't supported.",
        });
      if (variant.size > (photo ? MAX_VARIANT_BYTES : MAX_DOCUMENT_BYTES))
        ctx.addIssue({ code: "custom", message: "This file is too large." });
    }
  });
export type UploadRequest = z.input<typeof uploadRequestSchema>;

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  recordType: recordTypeSchema,
  recordId: z.string().uuid(),
  group: z.string(),
  fileName: z.string(),
  caption: z.string(),
  kind: z.enum(["photo", "document"]),
  // Short-lived signed download links, present once the upload is complete.
  urls: z.partialRecord(variantNameSchema, z.string().url()),
  urlsExpireAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const uploadTicketSchema = z.object({
  attachment: attachmentSchema,
  uploads: z.array(
    z.object({
      name: variantNameSchema,
      url: z.string().url(),
      headers: z.record(z.string(), z.string()),
    }),
  ),
  expiresAt: z.string().datetime(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

// Fits width × height inside a max × max box, never enlarging.
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// The pre-upload check (FLOW-42 AC2): a message when the file can't be attached.
export function checkFile(file: { type: string; size: number }) {
  if (IMAGE_TYPES.includes(file.type))
    return file.size > MAX_PHOTO_BYTES
      ? "Photos can be at most 25 MB."
      : undefined;
  if (DOCUMENT_TYPES.includes(file.type))
    return file.size > MAX_DOCUMENT_BYTES
      ? "Documents can be at most 20 MB."
      : undefined;
  return "Only photos (JPEG, PNG, WebP, HEIC), PDFs and Word documents can be attached.";
}
