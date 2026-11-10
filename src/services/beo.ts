import { beoViewSchema, type BeoNotesInput } from "../../shared/beo";
import { at, request } from "./core";

// The banquet event order (FLOW-143, 144, 148). Every call answers with the whole
// BEO as the signed-in role may see it.
const beo = (eventId: string, rest = "") => at("events", eventId, `beo${rest}`);

export const beoApi = {
  get: (eventId: string) => request(beoViewSchema, beo(eventId)),
  generate: (eventId: string) => request(beoViewSchema, beo(eventId), "POST", {}),
  saveNotes: (eventId: string, input: BeoNotesInput) =>
    request(beoViewSchema, beo(eventId), "PATCH", input),
  requestApproval: (eventId: string) =>
    request(beoViewSchema, beo(eventId, "/request-approval"), "POST", {}),
  approve: (eventId: string) => request(beoViewSchema, beo(eventId, "/approve"), "POST", {}),
};
