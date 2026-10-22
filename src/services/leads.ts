import {
  leadConversionSchema,
  leadSchema,
  type LeadConvertInput,
  type LeadStatusChange,
} from "../../shared/leads";
import { at, query, request } from "./core";

// Client for the leads API (FLOW-100/111/112).
export type LeadFilter = {
  status?: string;
  source?: string;
  channel?: string;
  needsReview?: boolean;
  triage?: boolean;
};

export const leadsApi = {
  list: (filter: LeadFilter = {}) =>
    request(leadSchema.array(), `/api/leads${query(filter)}`),
  get: (id: string) => request(leadSchema, at("leads", id)),
  assign: (id: string, assignedSalespersonId: string) =>
    request(leadSchema, at("leads", id, "assign"), "POST", {
      assignedSalespersonId,
    }),
  bulkAssign: (leadIds: string[], assignedSalespersonId: string) =>
    request(leadSchema.array(), "/api/leads/assign", "POST", {
      leadIds,
      assignedSalespersonId,
    }),
  setStatus: (id: string, change: LeadStatusChange) =>
    request(leadSchema, at("leads", id, "status"), "POST", change),
  convert: (id: string, input: LeadConvertInput) =>
    request(leadConversionSchema, at("leads", id, "convert"), "POST", input),
};
