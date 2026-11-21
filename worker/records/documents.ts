import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { DOCUMENT_TYPES, IMAGE_TYPES } from "../../shared/attachments";
import type { Document, documentChangeSchema, documentUploadSchema } from "../../shared/documents";
import type { z } from "zod";
import type { Bindings } from "../bindings";
import type { Db, DbLike } from "../db/client";
import { attachments, users, type AttachmentVariant } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { can, canChangeProtectedDocumentType } from "../policy";
import { requireParent } from "../attachments/records";
import { fileStorage } from "../attachments/storage";

type Row = typeof attachments.$inferSelect;
const accepted = [...DOCUMENT_TYPES, ...IMAGE_TYPES];

async function rowsFor(db: DbLike, id: string) {
  const rows = await db.select().from(attachments)
    .where(and(eq(attachments.documentId, id), isNull(attachments.archivedAt)))
    .orderBy(desc(attachments.versionNumber));
  if (!rows.length) throw notFound("Document");
  return rows;
}

async function authorize(db: DbLike, actor: Actor, row: Row, write: boolean) {
  try {
    await requireParent(db, actor, row.recordType as Parameters<typeof requireParent>[2], row.recordId, write, row.group);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) throw notFound("Document");
    throw error;
  }
}

async function toDocument(db: DbLike, env: Partial<Bindings>, rows: Row[]): Promise<Document> {
  const latest = rows[0];
  const ids = [...new Set(rows.map((row) => row.createdBy).filter((id): id is string => Boolean(id)))];
  const people = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const names = new Map(people.map((person) => [person.id, person.name]));
  let storage: ReturnType<typeof fileStorage> | undefined;
  try { storage = fileStorage(env); }
  catch (error) { if (!(error instanceof ApiError && error.code === "STORAGE_NOT_CONFIGURED")) throw error; }
  return {
    id: latest.documentId ?? latest.id,
    name: latest.displayName ?? latest.fileName,
    docType: latest.docType as Document["docType"],
    recordType: latest.recordType as Document["recordType"],
    recordId: latest.recordId,
    protected: latest.protected,
    updatedAt: latest.updatedAt.toISOString(),
    versions: await Promise.all(rows.map(async (row) => {
      const variant = row.variants.find((item) => item.name === "original") ?? row.variants.find((item) => item.name === "display") ?? row.variants[0];
      return {
        id: row.id, number: row.versionNumber, fileName: row.fileName,
        size: variant?.size ?? 0, contentType: variant?.contentType ?? "",
        url: storage && variant ? await storage.downloadUrl(variant.key, 300, new Date()) : null,
        createdAt: row.createdAt.toISOString(), uploadedBy: row.createdBy,
        uploaderName: row.createdBy ? names.get(row.createdBy) ?? null : null,
      };
    })),
  };
}

export async function listDocuments(db: Db, actor: Actor, env: Partial<Bindings>, filter: {
  search?: string; docType?: string; recordType?: string; uploadedBy?: string; since?: Date;
} = {}) {
  const rows = await db.select().from(attachments)
    .where(and(eq(attachments.status, "ready"), isNull(attachments.archivedAt)))
    .orderBy(desc(attachments.updatedAt));
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const id = row.documentId ?? row.id;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const result: Document[] = [];
  for (const versions of groups.values()) {
    const latest = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
    try { await authorize(db, actor, latest, false); }
    catch (error) { if (error instanceof ApiError && error.status === 404) continue; throw error; }
    if (filter.docType && latest.docType !== filter.docType) continue;
    if (filter.recordType && latest.recordType !== filter.recordType) continue;
    if (filter.uploadedBy && latest.createdBy !== filter.uploadedBy) continue;
    if (filter.since && latest.updatedAt < filter.since) continue;
    if (filter.search && !`${latest.displayName ?? latest.fileName} ${latest.fileName}`.toLowerCase().includes(filter.search.toLowerCase())) continue;
    result.push(await toDocument(db, env, versions));
  }
  return result;
}

export async function getDocument(db: Db, actor: Actor, env: Partial<Bindings>, id: string) {
  const rows = await rowsFor(db, id);
  await authorize(db, actor, rows[0], false);
  return toDocument(db, env, rows);
}

export async function startDocumentUpload(db: Db, actor: Actor, env: Partial<Bindings>, input: z.output<typeof documentUploadSchema>) {
  if (!accepted.includes(input.contentType)) throw new ApiError(400, "FILE_TYPE", "This file type is not supported.");
  if (input.recordType === "document" && !can(actor, "attachments.write")) throw forbidden();
  const storage = fileStorage(env);
  const documentId = input.documentId ?? crypto.randomUUID();
  const existing = input.documentId ? await rowsFor(db, input.documentId) : [];
  if (existing.length) {
    await authorize(db, actor, existing[0], true);
    if (existing[0].protected) throw new ApiError(409, "PROTECTED_DOCUMENT", "Approved BEO documents are kept permanently.");
  }
  const recordType = existing[0]?.recordType ?? input.recordType;
  const recordId = existing[0]?.recordId ?? (input.recordType === "document" ? documentId : input.recordId);
  if (!recordId) throw new ApiError(400, "LINK_REQUIRED", "Pick a linked record or an unlinked document.");
  if (!existing.length) await requireParent(db, actor, recordType as Parameters<typeof requireParent>[2], recordId, true);
  const versionNumber = existing.length ? Math.max(...existing.map((row) => row.versionNumber)) + 1 : 1;
  const id = crypto.randomUUID();
  const extension = input.fileName.split(".").at(-1)?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const key = `documents/${documentId}/${id}/original.${extension}`;
  const variants: AttachmentVariant[] = [{ name: "original", key, contentType: input.contentType, size: input.size }];
  await db.insert(attachments).values({
    id, documentId, recordType, recordId, group: "", fileName: input.fileName,
    displayName: existing[0]?.displayName ?? input.name, docType: existing[0]?.docType ?? input.docType,
    versionNumber, variants, createdBy: actor.userId, updatedBy: actor.userId,
  });
  return { id, url: await storage.uploadUrl(key, input.contentType, input.size, 300, new Date()),
    headers: { "Content-Type": input.contentType } };
}

export async function completeDocumentUpload(db: Db, actor: Actor, env: Partial<Bindings>, id: string) {
  const [row] = await db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.archivedAt)));
  if (!row || !row.documentId) throw notFound("Document upload");
  await authorize(db, actor, row, true);
  if (row.status !== "pending") throw new ApiError(409, "ALREADY_COMPLETE", "This upload is already complete.");
  if (!env.FILES) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "File storage is not configured.");
  for (const variant of row.variants) {
    const object = await env.FILES.head(variant.key);
    if (object?.size !== variant.size) throw new ApiError(400, "FILE_MISSING", "The uploaded file is missing or has the wrong size.");
  }
  await db.update(attachments).set({ status: "ready", updatedBy: actor.userId }).where(eq(attachments.id, id));
  return getDocument(db, actor, env, row.documentId);
}

export async function changeDocument(db: Db, actor: Actor, env: Partial<Bindings>, id: string, change: z.output<typeof documentChangeSchema>) {
  const rows = await rowsFor(db, id);
  const current = rows[0];
  await authorize(db, actor, current, true);
  if (current.protected && change.docType && !canChangeProtectedDocumentType(actor)) throw forbidden();
  const recordType = change.recordType ?? current.recordType;
  const recordId = change.recordId ?? current.recordId;
  if (recordType !== current.recordType || recordId !== current.recordId)
    await requireParent(db, actor, recordType as Parameters<typeof requireParent>[2], recordId, true);
  await db.update(attachments).set({
    ...(change.name !== undefined && { displayName: change.name }),
    ...(change.docType !== undefined && { docType: change.docType }),
    recordType, recordId, updatedBy: actor.userId,
  }).where(eq(attachments.documentId, id));
  return getDocument(db, actor, env, id);
}

export async function archiveDocument(db: Db, actor: Actor, id: string, restore = false) {
  const rows = restore ? await db.select().from(attachments).where(eq(attachments.documentId, id)) : await rowsFor(db, id);
  if (!rows.length) throw notFound("Document");
  await authorize(db, actor, rows[0], true);
  if (rows[0].protected) throw new ApiError(409, "PROTECTED_DOCUMENT", "Approved BEO documents are kept permanently.");
  await db.update(attachments).set({ archivedAt: restore ? null : new Date(), updatedBy: actor.userId })
    .where(eq(attachments.documentId, id));
  return { id, restored: restore };
}
