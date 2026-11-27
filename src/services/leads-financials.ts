import { contractListSchema } from "../../shared/contracts";
import { paymentListRowSchema } from "../../shared/payments";
import { request } from "./core";

export const leadsFinancialsApi = {
  contracts: () => request(contractListSchema.array(), "/api/proposals/contracts/all"),
  payments: () => request(paymentListRowSchema.array(), "/api/events/payments/all"),
};
