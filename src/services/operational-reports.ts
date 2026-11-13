import { operationalReportSchema } from "../../shared/operational-reports";
import { query, request } from "./core";

export const operationalReportsApi = {
  get: (range: { from: string; to: string }) =>
    request(operationalReportSchema, `/api/operational-reports${query(range)}`),
};
