import {
  importBatchResultSchema,
  importLogSchema,
  importModuleSchema,
  importRowPlanSchema,
  type ImportRow,
} from "../../shared/imports";
import { at, query, request } from "./core";

// Client for the data import API (FLOW-47).
export const importsApi = {
  modules: () => request(importModuleSchema.array(), "/api/imports/modules"),
  module: (key: string) =>
    request(importModuleSchema, at("imports/modules", key)),
  list: (module?: string) =>
    request(importLogSchema.array(), `/api/imports${query({ module })}`),
  dryRun: (module: string, rows: ImportRow[]) =>
    request(importRowPlanSchema.array(), "/api/imports/dry-run", "POST", {
      module,
      rows,
    }),
  start: (input: { module: string; fileName: string; rowCount: number }) =>
    request(importLogSchema, "/api/imports", "POST", input),
  batch: (id: string, rows: ImportRow[]) =>
    request(importBatchResultSchema, at("imports", id, "rows"), "POST", {
      rows,
    }),
  complete: (id: string) =>
    request(importLogSchema, at("imports", id, "complete"), "POST"),
};
