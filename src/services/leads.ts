import { z } from "zod";
import {
  leadConversionSchema,
  leadDuplicateSchema,
  leadSchema,
  type LeadConvertInput,
  type LeadStatusChange,
} from "../../shared/leads";
import { at, query, request } from "./core";

// Client for the leads API (FLOW-100/111/112, duplicates FLOW-110).
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
  duplicates: () => request(leadDuplicateSchema.array(), "/api/leads/duplicates"),
  // Returns the kept lead.
  merge: (duplicateId: string, keepLeadId: string) =>
    request(leadSchema, at("leads/duplicates", duplicateId, "merge"), "POST", {
      keepLeadId,
    }),
  dismiss: (duplicateId: string) =>
    request(z.null(), at("leads/duplicates", duplicateId, "dismiss"), "POST", {}),
};
