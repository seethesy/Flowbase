import { areaNoteSchema, type AreaNoteKey } from "../../shared/area-notes";
import { request } from "./core";

// Shared area notes (FLOW-341 A2).
export const areaNotesApi = {
  get: (key: AreaNoteKey) => request(areaNoteSchema, `/api/area-notes/${encodeURIComponent(key)}`),
  save: (key: AreaNoteKey, body: string) =>
    request(areaNoteSchema, `/api/area-notes/${encodeURIComponent(key)}`, "PUT", { body }),
};
