import {
  beoSceneSchema,
  beoViewSchema,
  type BeoAreaInput,
  type BeoAreaUpdate,
  type BeoNotesInput,
  type CleanupInput,
  type LayoutCopyInput,
  type RunOfShowInput,
} from "../../shared/beo";
import { cachedBeo, isNetworkError } from "../offline/db";
import { at, request } from "./core";

// The banquet event order (FLOW-143, 144, 148). Every call answers with the whole
// BEO as the signed-in role may see it.
const beo = (eventId: string, rest = "") => at("events", eventId, `beo${rest}`);
const view = (path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) =>
  request(beoViewSchema, path, method, body ?? {});

export const beoApi = {
  // With no signal, the copy kept for offline use (FLOW-150): read-only, whatever
  // the person could do online.
  get: async (eventId: string) => {
    try {
      return await request(beoViewSchema, beo(eventId));
    } catch (error) {
      const cached = isNetworkError(error) ? await cachedBeo(eventId) : undefined;
      if (!cached) throw error;
      return { ...cached.beo, canEdit: false, canApprove: false, canRequestApproval: false, canCheckOff: false };
    }
  },
  generate: (eventId: string) => view(beo(eventId), "POST"),
  saveNotes: (eventId: string, input: BeoNotesInput) => view(beo(eventId), "PATCH", input),
  requestApproval: (eventId: string) => view(beo(eventId, "/request-approval"), "POST"),
  approve: (eventId: string) => view(beo(eventId, "/approve"), "POST"),
  // Run of show (FLOW-145).
  saveRunOfShow: (eventId: string, input: RunOfShowInput) => view(beo(eventId, "/run-of-show"), "PUT", input),
  // Setup and layout areas (FLOW-146, 147).
  createArea: (eventId: string, input: BeoAreaInput) => view(beo(eventId, "/areas"), "POST", input),
  updateArea: (eventId: string, areaId: string, input: BeoAreaUpdate) =>
    view(beo(eventId, `/areas/${areaId}`), "PATCH", input),
  archiveArea: (eventId: string, areaId: string) => view(beo(eventId, `/areas/${areaId}`), "DELETE"),
  scene: (eventId: string, areaId: string) =>
    request(beoSceneSchema, beo(eventId, `/areas/${areaId}/scene`)),
  saveScene: (eventId: string, areaId: string, scene: Record<string, unknown> | null) =>
    view(beo(eventId, `/areas/${areaId}/scene`), "PUT", { scene }),
  copyLayout: (eventId: string, input: LayoutCopyInput) => view(beo(eventId, "/layout/copy"), "POST", input),
  // Cleanup checklist (FLOW-146).
  saveCleanup: (eventId: string, input: CleanupInput) => view(beo(eventId, "/cleanup"), "PUT", input),
  checkItem: (eventId: string, itemId: string, checked: boolean) =>
    view(beo(eventId, `/cleanup/${itemId}`), "PATCH", { checked }),
};
