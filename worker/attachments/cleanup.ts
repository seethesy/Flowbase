import { and, asc, inArray, isNotNull, lt, eq, or } from "drizzle-orm";
import type { Bindings } from "../bindings";
import type { Db } from "../db/client";
import { attachments } from "../db/schema";

// Removes files nobody can reach any more (FLOW-188), so R2's 10 GB of free storage
// doesn't fill with orphans:
//  - uploads that were started but never completed (status stays "pending");
//  - archived attachments, kept for a year so a mistaken archive can be undone
//    (Q1 answer).
// Objects are deleted before their rows, so a failed run leaves rows to retry.
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60_000;
export const ARCHIVED_RETENTION_MS = 365 * 24 * 60 * 60_000;
// Small batches keep a cron run inside its subrequest and CPU budget; the next
// run continues.
export const ATTACHMENT_CLEANUP_BATCH = 25;

export type AttachmentCleanupSummary = {
  abandonedUploadsRemoved: number;
  archivedAttachmentsRemoved: number;
};

export async function cleanupAttachments(
  db: Db,
  env: Partial<Bindings>,
  now = new Date(),
): Promise<AttachmentCleanupSummary> {
  const summary = { abandonedUploadsRemoved: 0, archivedAttachmentsRemoved: 0 };
  // Without the R2 binding (every environment except production) there are no
  // objects to delete, and deleting rows alone would orphan them.
  if (!env.FILES) return summary;
  const abandonedBefore = new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS);
  const archivedBefore = new Date(now.getTime() - ARCHIVED_RETENTION_MS);
  const rows = await db
    .select({
      id: attachments.id,
      status: attachments.status,
      variants: attachments.variants,
    })
    .from(attachments)
    .where(
      or(
        and(eq(attachments.status, "pending"), lt(attachments.createdAt, abandonedBefore)),
        and(isNotNull(attachments.archivedAt), lt(attachments.archivedAt, archivedBefore)),
      ),
    )
    .orderBy(asc(attachments.createdAt))
    .limit(ATTACHMENT_CLEANUP_BATCH);
  if (!rows.length) return summary;
  await env.FILES.delete(rows.flatMap((row) => row.variants.map((variant) => variant.key)));
  await db.delete(attachments).where(
    inArray(
      attachments.id,
      rows.map((row) => row.id),
    ),
  );
  for (const row of rows)
    if (row.status === "pending") summary.abandonedUploadsRemoved += 1;
    else summary.archivedAttachmentsRemoved += 1;
  return summary;
}
