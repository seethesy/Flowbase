import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";

export const recordContractSchema = z.object({
  signedAt: timestamp,
  clientSigner: text(200).min(1),
  salespersonSigner: text(200).min(1),
  cardOnFile: z.boolean(),
  cardLast4: z.string().regex(/^\d{4}$/, "Enter exactly four digits.").nullable(),
  attachmentId: id.nullable(),
  noFullCardNumberConfirmed: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.attachmentId && !value.noFullCardNumberConfirmed)
    ctx.addIssue({ code: "custom", path: ["noFullCardNumberConfirmed"], message: "Confirm the PDF shows no full card number." });
  if (!value.cardOnFile && value.cardLast4)
    ctx.addIssue({ code: "custom", path: ["cardLast4"], message: "Last four requires a card on file." });
});
export type RecordContractInput = z.input<typeof recordContractSchema>;

export const contractSchema = z.object({
  id, eventId: id, proposalId: id, versionId: id, signedAt: timestamp,
  clientSigner: z.string(), salespersonSigner: z.string(), cardOnFile: z.boolean(),
  cardLast4: z.string().nullable(), attachmentId: id.nullable(),
});

export const recordAddendumSchema = z.object({
  proposalVersionId: id, changeIds: z.array(id).min(1), sentAt: timestamp,
});
export const signAddendumSchema = z.object({ signedAt: timestamp });
export const addendumSchema = z.object({
  id, eventId: id, proposalId: id, proposalVersionId: id, changeIds: z.array(id), sentAt: timestamp,
  signedAt: timestamp.nullable(), reminderSentAt: timestamp.nullable(),
});
export const openAddendumSchema = addendumSchema.extend({ eventTitle: z.string() });
