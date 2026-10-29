import { eventSchema } from "../../shared/core-records";
import {
  eventRosterSchema,
  type ProductionLeadsInput,
  type ShiftInput,
  type SlotInput,
  type SlotUpdate,
} from "../../shared/event-staff";
import { at, request } from "./core";

// Staff roster and Production Leads (FLOW-140). Every roster call answers with the
// whole roster.
const shift = (eventId: string, shiftId: string, action = "") =>
  `${at("events", eventId, "shifts")}/${encodeURIComponent(shiftId)}${action && `/${action}`}`;
const slot = (eventId: string, slotId: string, action = "") =>
  `${at("events", eventId, "slots")}/${encodeURIComponent(slotId)}${action && `/${action}`}`;
export const eventStaffApi = {
  roster: (eventId: string) =>
    request(eventRosterSchema, at("events", eventId, "roster")),
  addShift: (eventId: string, input: ShiftInput) =>
    request(eventRosterSchema, at("events", eventId, "shifts"), "POST", input),
  updateShift: (eventId: string, shiftId: string, input: ShiftInput) =>
    request(eventRosterSchema, shift(eventId, shiftId), "PUT", input),
  archiveShift: (eventId: string, shiftId: string, notifyRemovedStaff = false) =>
    request(eventRosterSchema, shift(eventId, shiftId, "archive"), "POST", { notifyRemovedStaff }),
  addSlots: (eventId: string, input: SlotInput) =>
    request(eventRosterSchema, at("events", eventId, "slots"), "POST", input),
  updateSlot: (eventId: string, slotId: string, input: SlotUpdate) =>
    request(eventRosterSchema, slot(eventId, slotId), "PATCH", input),
  archiveSlot: (eventId: string, slotId: string, notifyRemovedStaff = false) =>
    request(eventRosterSchema, slot(eventId, slotId, "archive"), "POST", { notifyRemovedStaff }),
  setProductionLeads: (eventId: string, input: ProductionLeadsInput) =>
    request(
      eventSchema,
      at("events", eventId, "production-leads"),
      "PUT",
      input,
    ),
};
