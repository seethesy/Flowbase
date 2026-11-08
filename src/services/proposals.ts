import {
  checkProposalFiles,
  DOCX_TYPE,
  proposalDetailSchema,
  proposalSchema,
  proposalUploadTicketSchema,
  type ProposalCreateInput,
  type ProposalInput,
  type ProposalStageChangeInput,
  type ProposalUploadInput,
} from "../../shared/proposals";
import { at, query, request } from "./core";
import { proposalMappingSchema, type ProposalMapping } from "../../shared/proposal-mapping";
import { z } from "zod";

// Proposals (FLOW-122) and their versions (FLOW-123).
export const proposalsApi = {
  list: (eventId: string) =>
    request(proposalSchema.array(), `/api/proposals${query({ eventId })}`),
  get: (id: string) => request(proposalDetailSchema, at("proposals", id)),
  mapping: (id: string) => request(proposalMappingSchema.nullable(), at("proposals", id, "mapping")),
  catalog: (id: string) => request(z.object({ recipes: z.array(z.object({ id: z.string(), name: z.string() })), items: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), subtype: z.string().nullable() })) }), at("proposals", id, "catalog")),
  saveMapping: (id: string, input: ProposalMapping) => request(proposalMappingSchema, at("proposals", id, "mapping"), "PUT", input),
  create: (input: ProposalCreateInput) =>
    request(proposalDetailSchema, "/api/proposals", "POST", input),
  update: (id: string, input: ProposalInput) =>
    request(proposalDetailSchema, at("proposals", id), "PUT", input),
  changeStage: (id: string, input: ProposalStageChangeInput) =>
    request(proposalDetailSchema, at("proposals", id, "stage"), "POST", input),
  startUpload: (id: string, input: ProposalUploadInput) =>
    request(
      proposalUploadTicketSchema,
      at("proposals", id, "versions"),
      "POST",
      input,
    ),
  completeUpload: (id: string, versionId: string) =>
    request(
      proposalDetailSchema,
      `${at("proposals", id, "versions")}/${encodeURIComponent(versionId)}/complete`,
      "POST",
      {},
    ),
};

// Checks the picked files, uploads the .docx and the optional PDF straight to R2
// with their signed URLs, then completes the version.
export async function uploadProposalVersion(id: string, files: File[]) {
  const problem = checkProposalFiles(files);
  if (problem) throw new Error(problem);
  const docx = files.find((file) => file.type === DOCX_TYPE)!;
  const pdf = files.find((file) => file !== docx);
  const describe = (file: File) => ({
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  });
  const ticket = await proposalsApi.startUpload(id, {
    docx: describe(docx),
    ...(pdf && { pdf: describe(pdf) }),
  });
  for (const upload of ticket.uploads) {
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: upload.name === "docx" ? docx : pdf,
    });
    if (!response.ok)
      throw new Error(`The upload failed (${response.status}). Please retry.`);
  }
  return proposalsApi.completeUpload(id, ticket.versionId);
}
