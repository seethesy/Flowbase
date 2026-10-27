import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";

// Proposals (FLOW-122): an event has one or more proposals, each written in Google
// Docs outside Flowbase and tracked here through its stages. These stages are the
// proposal's own, separate from the event's statuses (FLOW-56).
export const proposalStages = [
  "client_communication",
  "menu_curation",
  "revisions",
  // A .docx export was uploaded (FLOW-123).
  "finalized",
  // Admin approved the current version (F-11-06).
  "approved",
  // Recorded as sent to the client.
  "sent",
  // The booking was recorded (F-12-01).
  "signed",
  "lost",
] as const;
export const proposalStageSchema = z.enum(proposalStages);
export type ProposalStage = z.infer<typeof proposalStageSchema>;
export const proposalStageLabels: Record<ProposalStage, string> = {
  client_communication: "Client communication",
  menu_curation: "Menu curation",
  revisions: "Revisions",
  finalized: "Finalized",
  approved: "Approved",
  sent: "Sent",
  signed: "Signed",
  lost: "Lost",
};

// The salesperson moves these by hand; every later stage is set by its action
// (upload, approval, sending, booking), never by hand (AC1).
export const manualProposalStages = [
  "client_communication",
  "menu_curation",
  "revisions",
] as const satisfies readonly ProposalStage[];
// Signed and Lost end a proposal; everything else is open.
export const closedProposalStages = [
  "signed",
  "lost",
] as const satisfies readonly ProposalStage[];
export const isOpenProposal = (stage: ProposalStage) =>
  !(closedProposalStages as readonly ProposalStage[]).includes(stage);

// Where a person may move a proposal by hand: any manual stage, or Lost, from any
// open stage. A finalized, approved or sent proposal can go back to Revisions when
// the client asks for changes. Signed and Lost are final.
export function manualProposalTargets(from: ProposalStage): ProposalStage[] {
  if (!isOpenProposal(from)) return [];
  return [...manualProposalStages, "lost"].filter(
    (stage): stage is ProposalStage => stage !== from,
  );
}

// Uploading a version finalizes the proposal (FLOW-123) from a manual stage, or
// from Finalized or Approved (the new version needs approving again). A sent
// proposal goes back to Revisions first; a signed or lost one takes no uploads.
export const uploadableProposalStages = [
  ...manualProposalStages,
  "finalized",
  "approved",
] as const satisfies readonly ProposalStage[];

export const lostReasonRequired = "Enter why the proposal was lost.";
const manualTargets = [
  "client_communication",
  "menu_curation",
  "revisions",
  "lost",
] as const satisfies readonly ProposalStage[];
export const proposalStageChangeSchema = z
  .object({
    stage: z.enum(manualTargets, {
      error:
        "Finalized, Approved, Sent and Signed are set by uploading, approving, sending and booking the proposal, not by hand.",
    }),
    reason: text(1000).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.stage === "lost" && value.reason === "")
      ctx.addIssue({ code: "custom", path: ["reason"], message: lostReasonRequired });
  });
export type ProposalStageChangeInput = z.input<typeof proposalStageChangeSchema>;

export const proposalInputSchema = z.object({
  title: text(200).min(1, "Title is required."),
  // Defaults to the event's salesperson; only Admin, Technical and the Sales
  // Manager may pick someone else.
  assignedSalespersonId: id.nullable().optional(),
  notes: text(5000).default(""),
});
export type ProposalInput = z.input<typeof proposalInputSchema>;
export const proposalCreateSchema = proposalInputSchema.extend({ eventId: id });
export type ProposalCreateInput = z.input<typeof proposalCreateSchema>;

// Proposal files (FLOW-123). The finalized proposal is uploaded as the Word export
// from Google Docs, which is the file that gets parsed; a PDF of the same version
// may come with it for reference and sharing.
export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_TYPE = "application/pdf";
export const MAX_PROPOSAL_FILE_BYTES = 20 * 1024 * 1024;
export const docxExportHint =
  "Upload the proposal as a Word file (.docx): in Google Docs, choose File → Download → Microsoft Word (.docx). A PDF can be added alongside it.";

const isDocx = (file: { fileName: string; contentType: string }) =>
  file.contentType === DOCX_TYPE && /\.docx$/i.test(file.fileName);
const isPdf = (file: { fileName: string; contentType: string }) =>
  file.contentType === PDF_TYPE && /\.pdf$/i.test(file.fileName);

const fileInput = z.object({
  fileName: text(200).min(1),
  contentType: z.string(),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_PROPOSAL_FILE_BYTES, "Proposal files can be at most 20 MB."),
});
export const proposalUploadSchema = z
  .object({
    // Missing when only a PDF was picked; rejected below with the export hint.
    docx: fileInput.optional(),
    pdf: fileInput.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.docx || !isDocx(value.docx))
      ctx.addIssue({ code: "custom", path: ["docx"], message: docxExportHint });
    if (value.pdf && !isPdf(value.pdf))
      ctx.addIssue({
        code: "custom",
        path: ["pdf"],
        message: "The reference copy must be a PDF.",
      });
  });
export type ProposalUploadInput = z.input<typeof proposalUploadSchema>;

// The browser's check before anything uploads (AC3): a message when the picked
// files can't be a version.
export function checkProposalFiles(files: { name: string; type: string; size: number }[]) {
  const named = files.map((file) => ({
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  }));
  const docx = named.filter(isDocx);
  const pdf = named.filter(isPdf);
  if (docx.length !== 1) return docxExportHint;
  if (named.length !== docx.length + pdf.length || pdf.length > 1)
    return "Pick one .docx and, optionally, one PDF of the same version.";
  if (named.some((file) => file.size > MAX_PROPOSAL_FILE_BYTES))
    return "Proposal files can be at most 20 MB.";
  return undefined;
}

const proposalFileSchema = z.object({
  fileName: z.string(),
  size: z.number(),
  // Short-lived signed download link.
  url: z.string().url(),
});
export const proposalVersionSchema = z.object({
  id,
  number: z.number().int().positive(),
  docx: proposalFileSchema,
  pdf: proposalFileSchema.nullable(),
  uploadedBy: z.object({ id, name: z.string() }).nullable(),
  uploadedAt: timestamp,
  current: z.boolean(),
});
export type ProposalVersion = z.infer<typeof proposalVersionSchema>;

export const proposalStageChangeEntrySchema = z.object({
  id,
  from: proposalStageSchema.nullable(),
  to: proposalStageSchema,
  reason: z.string(),
  // false when an action (upload, approval, sending, booking) set the stage.
  manual: z.boolean(),
  actor: z.object({ id, name: z.string() }).nullable(),
  at: timestamp,
});
export type ProposalStageChangeEntry = z.infer<
  typeof proposalStageChangeEntrySchema
>;

export const proposalSchema = z.object({
  id,
  eventId: id,
  clientId: id,
  title: z.string(),
  assignedSalesperson: z.object({ id, name: z.string() }).nullable(),
  notes: z.string(),
  stage: proposalStageSchema,
  lostReason: z.string(),
  // The number of the current version; null before the first upload.
  currentVersion: z.number().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Proposal = z.infer<typeof proposalSchema>;
// One proposal with its versions (newest first) and stage history (newest first).
export const proposalDetailSchema = proposalSchema.extend({
  versions: z.array(proposalVersionSchema),
  history: z.array(proposalStageChangeEntrySchema),
  // Download links expire; the screen reloads after this.
  urlsExpireAt: timestamp.nullable(),
});
export type ProposalDetail = z.infer<typeof proposalDetailSchema>;

export const proposalUploadTicketSchema = z.object({
  versionId: id,
  uploads: z.array(
    z.object({
      name: z.enum(["docx", "pdf"]),
      url: z.string().url(),
      headers: z.record(z.string(), z.string()),
    }),
  ),
  expiresAt: timestamp,
});
export type ProposalUploadTicket = z.infer<typeof proposalUploadTicketSchema>;
