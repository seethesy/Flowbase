import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import {
  DOWNLOAD_URL_SECONDS,
  UPLOAD_URL_SECONDS,
  type Attachment,
  type AttachmentRecordType,
  type UploadTicket,
  type uploadRequestSchema,
} from "../../shared/attachments";
import type { Bindings } from "../bindings";
import type { Db, DbLike } from "../db/client";
import { attachments, type AttachmentVariant } from "../db/schema";
import { forbidden, notFound } from "../hono";
import { can, attachmentWriteActions, type Action } from "../policy";
import { findVisibleClient } from "../records/clients";
import { findVisibleEvent } from "../records/events";
import { findItem } from "../records/inventory";
import { findVenue } from "../records/venues";
import { fileStorage } from "./storage";

type AttachmentRow = typeof attachments.$inferSelect;
type UploadRequest = z.output<typeof uploadRequestSchema>;

// Each record type an attachment can belong to: who may see the record, and
// which permission edits its files. New record types register here.
const parents: Record<
  AttachmentRecordType,
  {
    find: (db: DbLike, actor: Actor, id: string) => Promise<unknown>;
    write: Action;
  }
> = {
  client: { find: findVisibleClient, write: attachmentWriteActions.client },
  venue: { find: (db, _actor, id) => findVenue(db, id), write: attachmentWriteActions.venue },
  event: { find: findVisibleEvent, write: attachmentWriteActions.event },
  // Item photos (FLOW-69).
  inventory_item: {
    find: (db, _actor, id) => findItem(db, id),
    write: attachmentWriteActions.inventory_item,
  },
};

async function requireParent(
  db: DbLike,
  actor: Actor,
  recordType: AttachmentRecordType,
  recordId: string,
  write: boolean,
) {
  const parent = parents[recordType];
  await parent.find(db, actor, recordId);
  if (write && !can(actor, parent.write)) throw forbidden();
}

async function toAttachment(
  row: AttachmentRow,
  env: Partial<Bindings>,
  now: Date,
): Promise<Attachment> {
  const storage = row.status === "ready" ? fileStorage(env) : undefined;
  const urls: Attachment["urls"] = {};
  if (storage)
    for (const variant of row.variants)
      urls[variant.name] = await storage.downloadUrl(
        variant.key,
        DOWNLOAD_URL_SECONDS,
        now,
      );
  return {
    id: row.id,
    recordType: row.recordType as AttachmentRecordType,
    recordId: row.recordId,
    group: row.group,
    fileName: row.fileName,
    caption: row.caption,
    kind: row.variants.some((variant) => variant.name === "original")
      ? "document"
      : "photo",
    urls,
    urlsExpireAt: storage
      ? new Date(now.getTime() + DOWNLOAD_URL_SECONDS * 1000).toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

// Records the attachment as pending and returns signed PUT URLs for each variant.
// Object keys are generated here; user file names never become storage paths.
export async function startUpload(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  input: UploadRequest,
  now = new Date(),
): Promise<UploadTicket> {
  const storage = fileStorage(env);
  await requireParent(db, actor, input.recordType, input.recordId, true);
  const id = crypto.randomUUID();
  const variants: AttachmentVariant[] = input.variants.map((variant) => ({
    name: variant.name,
    key: `${input.recordType}/${input.recordId}/${id}/${variant.name}.${extensions[variant.contentType] ?? "bin"}`,
    contentType: variant.contentType,
    size: variant.size,
  }));
  const [row] = await db
    .insert(attachments)
    .values({
      id,
      recordType: input.recordType,
      recordId: input.recordId,
      group: input.group,
      fileName: input.fileName,
      caption: input.caption,
      variants,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();
  return {
    attachment: await toAttachment(row, env, now),
    uploads: await Promise.all(
      variants.map(async (variant) => ({
        name: variant.name,
        url: await storage.uploadUrl(
          variant.key,
          variant.contentType,
          variant.size,
          UPLOAD_URL_SECONDS,
          now,
        ),
        headers: { "Content-Type": variant.contentType },
      })),
    ),
    expiresAt: new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000).toISOString(),
  };
}

async function findAttachment(db: DbLike, actor: Actor, id: string, write: boolean) {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), isNull(attachments.archivedAt)));
  if (!row) throw notFound("Attachment");
  await requireParent(
    db,
    actor,
    row.recordType as AttachmentRecordType,
    row.recordId,
    write,
  ).catch((error) => {
    // A record the actor can't see hides its files too.
    throw error instanceof Error && error.message.includes("not found")
      ? notFound("Attachment")
      : error;
  });
  return row;
}

// Marks the upload ready. With the R2 binding, each object must exist at its
// declared size first.
export async function completeUpload(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  now = new Date(),
): Promise<Attachment> {
  const row = await findAttachment(db, actor, id, true);
  if (env.FILES)
    for (const variant of row.variants) {
      const object = await env.FILES.head(variant.key);
      if (object?.size !== variant.size)
        throw notFound(`Uploaded file ${variant.name}`);
    }
  const [ready] = await db
    .update(attachments)
    .set({ status: "ready", updatedBy: actor.userId })
    .where(eq(attachments.id, id))
    .returning();
  return toAttachment(ready, env, now);
}

export async function listAttachments(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  recordType: AttachmentRecordType,
  recordId: string,
  now = new Date(),
): Promise<Attachment[]> {
  await requireParent(db, actor, recordType, recordId, false);
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.recordType, recordType),
        eq(attachments.recordId, recordId),
        eq(attachments.status, "ready"),
        isNull(attachments.archivedAt),
      ),
    )
    .orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
  return Promise.all(rows.map((row) => toAttachment(row, env, now)));
}

export async function updateAttachment(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  change: { caption?: string; sortOrder?: number; archived?: boolean },
  now = new Date(),
): Promise<Attachment> {
  await findAttachment(db, actor, id, true);
  const [row] = await db
    .update(attachments)
    .set({
      ...(change.caption !== undefined && { caption: change.caption }),
      ...(change.sortOrder !== undefined && { sortOrder: change.sortOrder }),
      ...(change.archived && { archivedAt: now }),
      updatedBy: actor.userId,
    })
    .where(eq(attachments.id, id))
    .returning();
  return toAttachment(row, env, now);
}
