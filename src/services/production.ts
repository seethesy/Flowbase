import { productionListSchema, productionOverviewSchema, type ProductionWindow } from "../../shared/production";
import { request } from "./core";
import { readinessCheckSchema, type ReadinessCheck } from "../../shared/readiness";

export const productionApi = {
  event: (eventId: string) => request(productionListSchema, `/api/production/events/${encodeURIComponent(eventId)}`),
  overview: (days: ProductionWindow) => request(productionOverviewSchema, `/api/production/overview?days=${days}`),
  readiness: (eventId: string) => request(readinessCheckSchema.array(), `/api/production/events/${encodeURIComponent(eventId)}/readiness`),
  respond: (eventId: string, check: ReadinessCheck, state: "answered" | "dismissed", response: string) =>
    request(readinessCheckSchema.array(), `/api/production/events/${encodeURIComponent(eventId)}/readiness/${encodeURIComponent(check.key)}`,
      "POST", { signature: check.signature, state, response }),
};
