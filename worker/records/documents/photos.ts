import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import { DOWNLOAD_URL_SECONDS, type AttachmentRecordType } from "../../../shared/attachments";
import {
  isPhotoArea,
  photoAreaActions,
  type Photo,
  type PhotoArea,
  type PhotoChange,
} from "../../../shared/photos";
import { utcToBusinessTime } from "../../../shared/time";
import type { Bindings } from "../../bindings";
import type { Db, DbLike } from "../../db/client";
import { attachments, beoAreas, events, listValues, users } from "../../db/schema";
import { ApiError, forbidden, notFound } from "../../hono";
import { can } from "../../policy";
import { requireParent } from "../../attachments/records";
import { fileStorage } from "../../attachments/storage";

// Photo galleries (FLOW-271, FLOW-298): every Document of type Photo, read from
// the attachment rows the Documents library and record pages already use.
type Row = typeof attachments.$inferSelect;
const documentIdOf = (row: Row) => row.documentId ?? row.id;

// The gallery a photo's label, date and deletion belong to: an unlinked photo
// uploaded to Kitchen or Inventory follows that area; every other photo
// (Marketing uploads, event, BEO area and item photos) follows Marketing.
const galleryOf = (row: Row): PhotoArea =>
  row.recordType === "document" && isPhotoArea(row.group) ? row.group : "marketing";

const assertCan = (actor: Actor, action: Parameters<typeof can>[1]) => {
  if (!can(actor, action)) throw forbidden();
};

// Whether the actor can see the record a photo belongs to; one check per record.
function visibility(db: DbLike, actor: Actor) {
  const seen = new Map<string, Promise<boolean>>();
  return (row: Row) => {
    const key = `${row.recordType}:${row.recordId}:${row.group}`;
    if (!seen.has(key))
      seen.set(
        key,
        requireParent(db, actor, row.recordType as AttachmentRecordType, row.recordId, false, row.group).then(
          () => true,
          (error) => {
            if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false;
            throw error;
          },
        ),
      );
    return seen.get(key)!;
  };
}

// The latest version of each photo document.
function latestVersions(rows: Row[]) {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const current = latest.get(documentIdOf(row));
    if (!current || row.versionNumber > current.versionNumber) latest.set(documentIdOf(row), row);
  }
  return [...latest.values()];
}

async function toPhotos(db: DbLike, env: Partial<Bindings>, rows: Row[], now = new Date()): Promise<Photo[]> {
  if (!rows.length) return [];
  const areaIds = [...new Set(rows.filter((row) => row.recordType === "beo_area").map((row) => row.recordId))];
  const areas = areaIds.length
    ? await db.select({ id: beoAreas.id, eventId: beoAreas.eventId }).from(beoAreas).where(inArray(beoAreas.id, areaIds))
    : [];
  const areaEvent = new Map(areas.map((area) => [area.id, area.eventId]));
  const eventOf = (row: Row) =>
    row.recordType === "event" ? row.recordId : row.recordType === "beo_area" ? areaEvent.get(row.recordId) ?? null : null;
  const eventIds = [...new Set(rows.map(eventOf).filter((id): id is string => Boolean(id)))];
  const titles = new Map(
    (eventIds.length
      ? await db.select({ id: events.id, title: events.title }).from(events).where(inArray(events.id, eventIds))
      : []
    ).map((event) => [event.id, event.title]),
  );
  const uploaderIds = [...new Set(rows.map((row) => row.createdBy).filter((id): id is string => Boolean(id)))];
  const names = new Map(
    (uploaderIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uploaderIds))
      : []
    ).map((person) => [person.id, person.name]),
  );
  let storage: ReturnType<typeof fileStorage> | undefined;
  try {
    storage = fileStorage(env);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "STORAGE_NOT_CONFIGURED")) throw error;
  }
  return Promise.all(
    rows.map(async (row): Promise<Photo> => {
      const eventId = eventOf(row);
      // Photos attached to records carry a thumbnail and a display size; a photo
      // uploaded through Documents has only its original, used for both.
      const variant = (name: "thumb" | "display") =>
        row.variants.find((entry) => entry.name === name) ??
        row.variants.find((entry) => entry.name === "original") ??
        row.variants[0];
      const thumb = variant("thumb");
      const display = variant("display");
      return {
        id: documentIdOf(row),
        attachmentId: row.id,
        title: row.caption || row.displayName || row.fileName,
        label: row.caption,
        fileName: row.fileName,
        recordType: row.recordType as AttachmentRecordType,
        recordId: row.recordId,
        area: row.recordType === "document" && isPhotoArea(row.group) ? row.group : null,
        eventId,
        eventTitle: eventId ? titles.get(eventId) ?? null : null,
        tags: row.tags,
        approvedForMarketing: row.approvedForMarketing,
        date: row.photoDate ?? utcToBusinessTime(row.createdAt).date,
        uploadedBy: row.createdBy,
        uploaderName: row.createdBy ? names.get(row.createdBy) ?? null : null,
        createdAt: row.createdAt.toISOString(),
        urls:
          storage && thumb && display
            ? {
                thumb: await storage.downloadUrl(thumb.key, DOWNLOAD_URL_SECONDS, now),
                display: await storage.downloadUrl(display.key, DOWNLOAD_URL_SECONDS, now),
              }
            : null,
        urlsExpireAt: storage ? new Date(now.getTime() + DOWNLOAD_URL_SECONDS * 1000).toISOString() : null,
      };
    }),
  );
}

const newestFirst = (a: Photo, b: Photo) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

// GET /api/photos?area=: Marketing lists every photo the actor can see; Kitchen
// and Inventory list only the photos uploaded to them.
export async function listPhotos(db: Db, actor: Actor, env: Partial<Bindings>, area: PhotoArea) {
  assertCan(actor, photoAreaActions[area].read);
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.status, "ready"),
        isNull(attachments.archivedAt),
        eq(attachments.docType, "photo"),
        ...(area === "marketing"
          ? []
          : [eq(attachments.recordType, "document"), eq(attachments.group, area)]),
      ),
    )
    .orderBy(desc(attachments.createdAt));
  const visible = visibility(db, actor);
  const shown: Row[] = [];
  for (const row of latestVersions(rows)) if (await visible(row)) shown.push(row);
  return (await toPhotos(db, env, shown)).sort(newestFirst);
}

async function findPhoto(db: DbLike, actor: Actor, id: string, archived = false) {
  const rows = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.documentId, id), eq(attachments.docType, "photo"), eq(attachments.status, "ready")));
  const live = rows.filter((row) => (archived ? row.archivedAt !== null : row.archivedAt === null));
  const [latest] = latestVersions(live);
  if (!latest || !(await visibility(db, actor)(latest))) throw notFound("Photo");
  return latest;
}

// Tags come from the Admin's list; a tag the photo already has stays allowed
// after it is archived from the list.
async function checkTags(db: DbLike, tags: string[], current: string[]) {
  const rows = await db
    .select({ label: listValues.label })
    .from(listValues)
    .where(and(eq(listValues.listKey, "photo_tag"), isNull(listValues.archivedAt)));
  const allowed = new Set([...rows.map((row) => row.label), ...current]);
  const unknown = tags.filter((tag) => !allowed.has(tag));
  if (unknown.length) throw new ApiError(400, "INVALID_VALUE", `Unknown photo tag: ${unknown.join(", ")}.`);
  return [...new Set(tags)];
}

export async function changePhoto(db: Db, actor: Actor, env: Partial<Bindings>, id: string, change: PhotoChange) {
  const row = await findPhoto(db, actor, id);
  if (change.approvedForMarketing !== undefined || change.tags !== undefined) assertCan(actor, "marketing.write");
  if (change.label !== undefined || change.date !== undefined) assertCan(actor, photoAreaActions[galleryOf(row)].write);
  const tags = change.tags === undefined ? undefined : await checkTags(db, change.tags, row.tags);
  await db
    .update(attachments)
    .set({
      ...(change.approvedForMarketing !== undefined && { approvedForMarketing: change.approvedForMarketing }),
      ...(tags !== undefined && { tags }),
      ...(change.label !== undefined && { caption: change.label }),
      ...(change.date !== undefined && { photoDate: change.date }),
      updatedBy: actor.userId,
    })
    .where(eq(attachments.documentId, id));
  const [photo] = await toPhotos(db, env, [await findPhoto(db, actor, id)]);
  return photo;
}

// Delete archives every version, like the Documents library; restore is Undo.
export async function archivePhoto(db: Db, actor: Actor, id: string, restore = false) {
  const row = await findPhoto(db, actor, id, restore);
  assertCan(actor, photoAreaActions[galleryOf(row)].write);
  if (row.protected) throw new ApiError(409, "PROTECTED_DOCUMENT", "Approved BEO documents are kept permanently.");
  await db
    .update(attachments)
    .set({ archivedAt: restore ? null : new Date(), updatedBy: actor.userId })
    .where(eq(attachments.documentId, id));
  return { id, restored: restore };
}
