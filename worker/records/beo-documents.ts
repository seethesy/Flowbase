import { and, desc, eq, isNull } from "drizzle-orm";
import { beoContentSchema } from "../../shared/beo";
import { attachments } from "../db/schema";
import type { JobRegistry } from "../jobs/queue";
import { renderBeoPdf } from "./beo-pdf";

export function registerBeoDocuments(registry: JobRegistry) {
  registry.register("event:beo.approved", async (job, { db, env }) => {
    const payload = job.payload as Record<string, unknown>;
    const eventId = String(payload.entityId);
    const approvalId = String(payload.approvalId);
    const content = beoContentSchema.parse(payload.content);
    const existing = await db.select({ id: attachments.id }).from(attachments)
      .where(eq(attachments.id, approvalId)).limit(1);
    if (existing.length) return;
    if (!env?.FILES?.put) throw new Error("R2 binding is required to store approved BEO PDFs.");
    const bytes = await renderBeoPdf(content);
    const key = `beo/${eventId}/${approvalId}/beo.pdf`;
    await env.FILES.put(key, Uint8Array.from(bytes).buffer, { httpMetadata: { contentType: "application/pdf" } });
    await db.transaction(async (tx) => {
      const [last] = await tx.select({ versionNumber: attachments.versionNumber }).from(attachments)
        .where(and(eq(attachments.documentId, eventId), isNull(attachments.archivedAt)))
        .orderBy(desc(attachments.versionNumber)).limit(1);
      await tx.insert(attachments).values({
        id: approvalId, documentId: eventId, recordType: "event", recordId: eventId,
        group: "generated", fileName: `BEO-${content.header.eventDate}.pdf`,
        displayName: `BEO - ${content.event.title}`, docType: "beo",
        versionNumber: (last?.versionNumber ?? 0) + 1, protected: true, status: "ready",
        variants: [{ name: "original", key, contentType: "application/pdf", size: bytes.length }],
        createdBy: String(payload.approvedBy), updatedBy: String(payload.approvedBy),
      }).onConflictDoNothing({ target: attachments.id });
    });
  });
}
