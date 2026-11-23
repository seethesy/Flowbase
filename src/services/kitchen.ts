import { z } from "zod";
import { kitchenOverviewSchema, type KitchenInChargeInput } from "../../shared/kitchen-overview";
import { at, request } from "./core";

// Kitchen › Overview (FLOW-293): the next 14 days' menu items and who is in charge.
export const kitchenApi = {
  overview: () => request(kitchenOverviewSchema, "/api/kitchen/overview"),
  setInCharge: (lineId: string, input: KitchenInChargeInput) =>
    request(z.object({ lineId: z.string(), inChargeStaffId: z.string().nullable() }), at("kitchen/lines", lineId, "in-charge"), "PATCH", input),
};
