import { z } from "zod";
import { salesClientSchema, salesDataSchema, salesReportSchema, salesViewSchema, type SalesFilter } from "../../shared/sales";
import { query, request } from "./core";

export const salesApi = {
  list: () => request(salesDataSchema, "/api/sales"),
  client: (clientId: string) => request(salesClientSchema, `/api/sales/clients/${encodeURIComponent(clientId)}`),
  report: (range: { from?: string; to?: string }) => request(salesReportSchema, `/api/sales/reports${query(range)}`),
  views: () => request(salesViewSchema.array(), "/api/sales/views"),
  saveView: (name: string, filter: SalesFilter) => request(salesViewSchema, "/api/sales/views", "POST", { name, filter }),
  deleteView: (viewId: string) => request(z.null(), `/api/sales/views/${encodeURIComponent(viewId)}`, "DELETE"),
};
