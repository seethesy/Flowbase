import {
  eventTimelineSchema,
  type TimelineEntryInput,
} from "../../shared/event-timeline";
import { at, request } from "./core";

// Event timeline and production schedule (FLOW-126). Every call answers with the
// whole timeline.
const entry = (eventId: string, entryId: string, action = "") =>
  `${at("events", eventId, "timeline")}/${encodeURIComponent(entryId)}${action && `/${action}`}`;
export const eventTimelineApi = {
  get: (eventId: string) =>
    request(eventTimelineSchema, at("events", eventId, "timeline")),
  add: (eventId: string, input: TimelineEntryInput) =>
    request(eventTimelineSchema, at("events", eventId, "timeline"), "POST", input),
  update: (eventId: string, entryId: string, input: TimelineEntryInput) =>
    request(eventTimelineSchema, entry(eventId, entryId), "PUT", input),
  archive: (eventId: string, entryId: string) =>
    request(eventTimelineSchema, entry(eventId, entryId, "archive"), "POST", {}),
};
