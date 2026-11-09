import { kitchenMenuSchema, type KitchenLineInput, type KitchenLineUpdate } from "../../shared/kitchen-menu";
import { planningProgressSchema, regeneratePreviewSchema } from "../../shared/planning";
import {
  pullListSchema,
  type PullLineInput,
  type PullLineUpdate,
  type PullScheduleInput,
  type PullStatus,
} from "../../shared/pull-list";
import { at, request } from "./core";

// Start planning, the pull list and the kitchen menu (FLOW-133/134/137). Every
// change answers with the whole list or menu.
const pull = (eventId: string, rest = "") => at("events", eventId, `pull-list${rest}`);
const kitchen = (eventId: string, rest = "") => at("events", eventId, `kitchen-menu${rest}`);

export const preparationApi = {
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
