import { z } from "zod";
import {
  documentSchema, documentUploadCancelSchema, documentUploadTicketSchema,
  type DocumentType,
} from "../../shared/documents";
import type { AttachmentRecordType } from "../../shared/attachments";
import { query, request } from "./core";
import { putToStorage } from "./attachments";

export const documentsApi = {
  list: (filter: { search?: string; docType?: DocumentType; recordType?: string; uploadedBy?: string; updated?: string } = {}) =>
    request(documentSchema.array(), `/api/documents${query(filter)}`),
  get: (id: string) => request(documentSchema, `/api/documents/${id}`),
  update: (id: string, change: { name?: string; docType?: DocumentType; recordType?: AttachmentRecordType; recordId?: string }) =>
    request(documentSchema, `/api/documents/${id}`, "PATCH", change),
  start: (input: { name: string; docType: DocumentType; recordType: AttachmentRecordType; recordId?: string;
    fileName: string; contentType: string; size: number; documentId?: string }) =>
    request(documentUploadTicketSchema, "/api/documents", "POST", input),
  complete: (id: string) => request(documentSchema, `/api/documents/${id}/complete`, "POST", {}),
  // Removes an upload whose file never reached storage (FLOW-331).
  cancel: (id: string) => request(documentUploadCancelSchema, `/api/documents/${id}/cancel`, "POST", {}),
  archive: (id: string) => request(z.object({ id: z.string(), restored: z.boolean() }), `/api/documents/${id}/archive`, "POST", {}),
  restore: (id: string) => request(z.object({ id: z.string(), restored: z.boolean() }), `/api/documents/${id}/restore`, "POST", {}),
};

export async function uploadDocument(file: File, input: {
  name: string; docType: DocumentType; recordType: AttachmentRecordType; recordId?: string; documentId?: string;
}) {
  const byExtension: Record<string, string> = {
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic",
  };
  const contentType = byExtension[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ?? file.type;
  const ticket = await documentsApi.start({ ...input, fileName: file.name,
    contentType, size: file.size });
  try {
    await putToStorage(ticket.url, ticket.headers, file);
  } catch (error) {
    // No half-created document: the pending upload goes, and the user can retry.
    await documentsApi.cancel(ticket.id).catch(() => undefined);
    throw error;
  }
  return documentsApi.complete(ticket.id);
}
