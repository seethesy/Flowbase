import { kitchenMenuSchema, type KitchenLineInput, type KitchenLineUpdate } from "../../shared/kitchen-menu";
import { planningProgressSchema, regeneratePreviewSchema } from "../../shared/planning";
import type { z } from "zod";
import { refreshableOutputSchema } from "../../shared/planning";
import {
  pullListSchema,
  type PullLineInput,
  type PullLineUpdate,
  type PullScheduleInput,
  type PullStatus,
} from "../../shared/pull-list";
import { at, request } from "./core";
import { rentalRequestSchema, type RentalRequestSettings } from "../../shared/rental-requests";
import { truckLogSchema, truckStatuses, type TruckAssignmentInput } from "../../shared/trucks";

// Start planning, the pull list and the kitchen menu (FLOW-133/134/137). Every
// change answers with the whole list or menu.
const pull = (eventId: string, rest = "") => at("events", eventId, `pull-list${rest}`);
const kitchen = (eventId: string, rest = "") => at("events", eventId, `kitchen-menu${rest}`);

export const preparationApi = {
  previewPlanningOutput: (eventId: string, kind: z.infer<typeof refreshableOutputSchema>) =>
    request(regeneratePreviewSchema, at("events", eventId, `planning/outputs/${kind}/preview`), "POST", {}),
  regeneratePlanningOutput: (eventId: string, kind: z.infer<typeof refreshableOutputSchema>, expectedStaleAt: string) =>
    request(regeneratePreviewSchema, at("events", eventId, `planning/outputs/${kind}/regenerate`), "POST", { expectedStaleAt }),
  truckLog: (eventId: string) => request(truckLogSchema, at("events", eventId, "trucks")),
  addTruck: (eventId: string, name: string) => request(truckLogSchema, at("events", eventId, "trucks"), "POST", { name }),
  setTruckStatus: (eventId: string, truckId: string, status: typeof truckStatuses[number]) =>
    request(truckLogSchema, at("events", eventId, `trucks/${truckId}/status`), "PATCH", status),
  assignTruck: (eventId: string, input: TruckAssignmentInput) =>
    request(truckLogSchema, at("events", eventId, "trucks/assignments"), "POST", input),
  removeTruckAssignment: (eventId: string, assignmentId: string) =>
    request(truckLogSchema, at("events", eventId, `trucks/assignments/${assignmentId}/archive`), "POST", {}),
  movePullLineToTruck: (eventId: string, lineId: string, truckId: string | null) =>
    request(truckLogSchema, at("events", eventId, `trucks/lines/${lineId}`), "PUT", { truckId }),
  rentalRequests: (eventId: string) =>
    request(rentalRequestSchema.array(), at("events", eventId, "rental-requests")),
  updateRentalRequest: (eventId: string, vendorId: string, input: Omit<RentalRequestSettings, "vendorId">) =>
    request(rentalRequestSchema.array(), at("events", eventId, `rental-requests/${encodeURIComponent(vendorId)}`), "PUT", input),
  progress: (eventId: string) =>
    request(planningProgressSchema, at("events", eventId, "planning")),
  start: (eventId: string) =>
    request(planningProgressSchema, at("events", eventId, "planning/start"), "POST", {}),

  pullList: (eventId: string) => request(pullListSchema, pull(eventId)),
  addPullLine: (eventId: string, input: PullLineInput) =>
    request(pullListSchema, pull(eventId, "/lines"), "POST", input),
  updatePullLine: (eventId: string, lineId: string, input: PullLineUpdate) =>
    request(pullListSchema, pull(eventId, `/lines/${encodeURIComponent(lineId)}`), "PATCH", input),
  setPullStatus: (eventId: string, lineId: string, status: PullStatus) =>
    request(pullListSchema, pull(eventId, `/lines/${encodeURIComponent(lineId)}/status`), "POST", { status }),
  removePullLine: (eventId: string, lineId: string) =>
    request(pullListSchema, pull(eventId, `/lines/${encodeURIComponent(lineId)}/archive`), "POST", {}),
  schedulePull: (eventId: string, input: PullScheduleInput) =>
    request(pullListSchema, pull(eventId, "/schedule"), "PUT", input),
  previewPull: (eventId: string, discardEdits: boolean) =>
    request(regeneratePreviewSchema, pull(eventId, "/regenerate/preview"), "POST", { discardEdits }),
  regeneratePull: (eventId: string, discardEdits: boolean) =>
    request(pullListSchema, pull(eventId, "/regenerate"), "POST", { discardEdits }),

  kitchenMenu: (eventId: string) => request(kitchenMenuSchema, kitchen(eventId)),
  addKitchenLine: (eventId: string, input: KitchenLineInput) =>
    request(kitchenMenuSchema, kitchen(eventId, "/lines"), "POST", input),
  updateKitchenLine: (eventId: string, lineId: string, input: KitchenLineUpdate) =>
    request(kitchenMenuSchema, kitchen(eventId, `/lines/${encodeURIComponent(lineId)}`), "PATCH", input),
  removeKitchenLine: (eventId: string, lineId: string) =>
    request(kitchenMenuSchema, kitchen(eventId, `/lines/${encodeURIComponent(lineId)}/archive`), "POST", {}),
  setLeavesKitchen: (eventId: string, leavesKitchenTime: string | null) =>
    request(kitchenMenuSchema, kitchen(eventId, "/times"), "PUT", { leavesKitchenTime }),
  previewKitchen: (eventId: string, discardEdits: boolean) =>
    request(regeneratePreviewSchema, kitchen(eventId, "/regenerate/preview"), "POST", { discardEdits }),
  regenerateKitchen: (eventId: string, discardEdits: boolean) =>
    request(kitchenMenuSchema, kitchen(eventId, "/regenerate"), "POST", { discardEdits }),
};
