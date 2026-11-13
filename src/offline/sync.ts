import { offlineBeosSchema, type BeoView } from "../../shared/beo";
import type { Attachment } from "../../shared/attachments";
import { request } from "../services/core";
import { attachmentsApi } from "../services/attachments";
import { attachmentsKey, clearOfflineData, imageKey, offlineDb, safely } from "./db";

// Each time Flowbase is opened online: keep the approved BEOs of the person's
// assigned events in the next days, with their layout images and setup photos, in
// IndexedDB for reading with no signal (FLOW-150).

const areaIds = (beo: BeoView) => [
  ...beo.content.layout.areas.map((area) => area.id),
  ...beo.content.setupCleanup.areas.map((area) => area.id),
];

// The photo variant the BEO shows, as a blob; a photo that can't be fetched (the
// storage host refusing the request) is skipped, not fatal.
async function fetchBlob(file: Attachment, variant: keyof Attachment["urls"]) {
  const url = file.urls[variant];
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

export async function syncOfflineBeos(userId: string) {
  const data = await request(offlineBeosSchema, "/api/offline-beos");
  await safely(async () => {
    const db = offlineDb();
    // Another person signed in on this device: their copy must not stay.
    const owner = await db.meta.get("user");
    if (owner && owner.value !== userId) await clearOfflineData();
    await db.meta.put({ key: "user", value: userId });
    const keep = data.beos.map(({ event }) => event.id);
    await db.beos.where("eventId").noneOf(keep).delete();
    const listKeys = new Set<string>();
    const photoKeys = new Set<string>();
    for (const { event, beo } of data.beos) {
      for (const areaId of areaIds(beo)) {
        const files = await attachmentsApi.list("beo_area", areaId);
        listKeys.add(attachmentsKey("beo_area", areaId));
        await db.attachmentLists.put({ key: attachmentsKey("beo_area", areaId), items: files });
        for (const file of files) {
          if (file.kind !== "photo") continue;
          for (const variant of Object.keys(file.urls) as (keyof Attachment["urls"])[]) {
            const key = imageKey(file.id, variant);
            photoKeys.add(key);
            if (await db.images.get(key)) continue;
            const blob = await fetchBlob(file, variant);
            if (blob) await db.images.put({ key, blob });
          }
        }
      }
      await db.beos.put({ eventId: event.id, event, beo, syncedAt: data.syncedAt });
    }
    await db.attachmentLists.where("key").noneOf([...listKeys]).delete();
    await db.images.where("key").noneOf([...photoKeys]).delete();
  }, undefined);
}
