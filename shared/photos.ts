import { z } from "zod";
import { recordTypeSchema } from "./attachments";
import type { Action } from "./policy";
import { id, localDate, text, timestamp } from "./schema-primitives";

// Photo galleries (FLOW-271, FLOW-298). Every photo is a Document of type Photo
// (FLOW-263): the same attachment rows the Documents library lists, never a copy.
// Marketing › Photos shows every photo; the Kitchen and Inventory Photos tabs
// show only the photos uploaded to that area.

export const photoAreas = ["marketing", "kitchen", "inventory"] as const;
export const photoAreaSchema = z.enum(photoAreas);
export type PhotoArea = z.infer<typeof photoAreaSchema>;

// Who reads and writes each gallery. Marketing photos are their own area of the
// roles editor (FLOW-269); Kitchen and Inventory photos follow their area.
export const photoAreaActions: Record<PhotoArea, { read: Action; write: Action }> = {
  marketing: { read: "marketing.read", write: "marketing.write" },
  kitchen: { read: "recipes.read", write: "recipes.write" },
  inventory: { read: "inventory.read", write: "inventory.write" },
};

// A photo uploaded straight to a gallery, not linked to a record, is an unlinked
// document whose group names its gallery.
export const isPhotoArea = (group: string): group is PhotoArea =>
  (photoAreas as readonly string[]).includes(group);

// The Marketing tag list (Settings › Lists, "photo_tag"); Admins edit it.
export const defaultPhotoTags = ["Food", "Venue", "Decor", "Setup", "Bar", "Team"];

export const photoSchema = z.object({
  // The document id (FLOW-263); the latest version's attachment id is attachmentId.
  id,
  attachmentId: id,
  title: z.string(),
  // The optional label people type; title falls back to the file name.
  label: z.string(),
  fileName: z.string(),
  recordType: recordTypeSchema,
  recordId: id,
  // The gallery an unlinked photo was uploaded to.
  area: photoAreaSchema.nullable(),
  eventId: id.nullable(),
  eventTitle: z.string().nullable(),
  tags: z.string().array(),
  approvedForMarketing: z.boolean(),
  // The photo's date: the upload date unless someone changed it.
  date: localDate,
  uploadedBy: id.nullable(),
  uploaderName: z.string().nullable(),
  createdAt: timestamp,
  urls: z.object({ thumb: z.string().url(), display: z.string().url() }).nullable(),
  urlsExpireAt: timestamp.nullable(),
});
export type Photo = z.infer<typeof photoSchema>;

export const photoChangeSchema = z
  .object({
    approvedForMarketing: z.boolean().optional(),
    tags: z.array(text(40).min(1)).max(20).optional(),
    label: text(500).optional(),
    date: localDate.optional(),
  })
  .strict();
export type PhotoChange = z.infer<typeof photoChangeSchema>;

// The Marketing gallery filters (AC2), applied in the browser.
export type PhotoFilter = {
  eventId?: string;
  tag?: string;
  uploadedBy?: string;
  approvedOnly?: boolean;
};
export function filterPhotos(photos: readonly Photo[], filter: PhotoFilter) {
  return photos.filter(
    (photo) =>
      (!filter.eventId || photo.eventId === filter.eventId) &&
      (!filter.tag || photo.tags.includes(filter.tag)) &&
      (!filter.uploadedBy || photo.uploadedBy === filter.uploadedBy) &&
      (!filter.approvedOnly || photo.approvedForMarketing),
  );
}

// "event · tag · uploader, date" under each tile.
export function photoCaption(photo: Photo) {
  const date = new Date(`${photo.date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const who = [photo.uploaderName, date].filter(Boolean).join(", ");
  return [photo.eventTitle, photo.tags[0], who].filter(Boolean).join(" · ");
}

// The lightbox's previous/next, wrapping at either end.
export const stepIndex = (index: number, count: number, step: 1 | -1) =>
  count ? (index + step + count) % count : 0;

// Unique names inside the download .zip: two "IMG_0001.jpg" become
// "IMG_0001.jpg" and "IMG_0001 (2).jpg".
export function zipNames(names: readonly string[]) {
  const used = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/:*?"<>|]/g, "_") || "photo.jpg";
    const key = name.toLowerCase();
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}
