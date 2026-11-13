import Dexie, { type EntityTable } from "dexie";
import type { Attachment } from "../../shared/attachments";
import type { BeoView } from "../../shared/beo";
import type { FlowEvent } from "../../shared/core-records";
import type { User } from "../../shared/users";

// The read-only offline copy of a person's upcoming BEOs (FLOW-150, ADR-18),
// kept in IndexedDB. It holds only what the signed-in person's role may see (the
// API already projects it), is replaced each time Flowbase opens online, and is
// removed on sign-out.

export type CachedBeo = { eventId: string; event: FlowEvent; beo: BeoView; syncedAt: string };
export type CachedAttachments = { key: string; items: Attachment[] };
export type CachedImage = { key: string; blob: Blob };
export type CachedMeta = { key: string; value: string };
export type CachedProfile = { key: string; user: User };

type OfflineDb = Dexie & {
  beos: EntityTable<CachedBeo, "eventId">;
  attachmentLists: EntityTable<CachedAttachments, "key">;
  images: EntityTable<CachedImage, "key">;
  meta: EntityTable<CachedMeta, "key">;
  profile: EntityTable<CachedProfile, "key">;
};

let instance: OfflineDb | undefined;
export function offlineDb(): OfflineDb {
  if (!instance) {
    const db = new Dexie("flowbase-offline") as OfflineDb;
    db.version(1).stores({
      beos: "eventId",
      attachmentLists: "key",
      images: "key",
      meta: "key",
      profile: "key",
    });
    instance = db;
  }
  return instance;
}

// Storage can be missing or refused (private windows, blocked site data): the app
// then simply has no offline copy.
export async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

// A request that never reached the server (no signal), as opposed to one the
// server answered with an error.
export const isNetworkError = (error: unknown) =>
  error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);

export const attachmentsKey = (recordType: string, recordId: string) => `${recordType}:${recordId}`;
export const imageKey = (attachmentId: string, variant: string) => `${attachmentId}:${variant}`;

export const cachedBeo = (eventId: string) => safely(() => offlineDb().beos.get(eventId), undefined);
export const cachedBeos = () => safely(() => offlineDb().beos.orderBy("eventId").toArray(), []);

// Signing out (or changing user) removes every cached BEO, photo and the profile.
export const clearOfflineData = () =>
  safely(async () => {
    const db = offlineDb();
    await Promise.all([db.beos.clear(), db.attachmentLists.clear(), db.images.clear(), db.meta.clear(), db.profile.clear()]);
  }, undefined);

export const rememberProfile = (user: User) =>
  safely(() => offlineDb().profile.put({ key: "user", user }), undefined);
export const cachedProfile = () =>
  safely(async () => (await offlineDb().profile.get("user"))?.user ?? null, null);
