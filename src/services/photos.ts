import { z } from "zod";
import { zipSync } from "fflate";
import { photoSchema, zipNames, type Photo, type PhotoArea, type PhotoChange } from "../../shared/photos";
import { uploadAttachment } from "./attachments";
import { query, request } from "./core";

const archived = z.object({ id: z.string(), restored: z.boolean() });

// Photo galleries (FLOW-271, FLOW-298).
export const photosApi = {
  list: (area: PhotoArea) => request(photoSchema.array(), `/api/photos${query({ area })}`),
  update: (id: string, change: PhotoChange) => request(photoSchema, `/api/photos/${id}`, "PATCH", change),
  archive: (id: string) => request(archived, `/api/photos/${id}/archive`, "POST", {}),
  restore: (id: string) => request(archived, `/api/photos/${id}/restore`, "POST", {}),
};

// Uploads one photo: resized in the browser to a thumbnail and a display size
// (FLOW-42), linked to an event, or to the gallery itself when none is picked.
export function uploadPhoto(
  file: File,
  target: { area: PhotoArea; eventId?: string; label?: string; date?: string },
) {
  return uploadAttachment(file, {
    ...(target.eventId
      ? { recordType: "event" as const, recordId: target.eventId }
      : { recordType: "document" as const, recordId: crypto.randomUUID(), group: target.area }),
    caption: target.label ?? "",
    photoDate: target.date,
  });
}

// Download (.zip): the display-size copies, fetched with their signed links
// (the bucket's CORS rules allow GET) and stored uncompressed, since JPEGs
// don't shrink.
export async function zipPhotos(photos: readonly Photo[]) {
  const withUrls = photos.filter((photo) => photo.urls);
  const names = zipNames(withUrls.map((photo) => `${photo.fileName.replace(/\.[^.]+$/, "")}.jpg`));
  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    withUrls.map(async (photo, index) => {
      const response = await fetch(photo.urls!.display);
      if (!response.ok) throw new Error(`A photo couldn't be downloaded (${response.status}).`);
      files[names[index]] = new Uint8Array(await response.arrayBuffer());
    }),
  );
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: "application/zip" });
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
