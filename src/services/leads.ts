import { z } from "zod";
import {
  leadConversionSchema,
  leadDashboardSchema,
  leadDuplicateSchema,
  leadSchema,
  type LeadConvertInput,
  type LeadStatusChange,
} from "../../shared/leads";
import { at, query, request, requestPage } from "./core";

// Client for the leads API (FLOW-100/111/112, duplicates FLOW-110).
type LeadFilter = {
  status?: string;
  source?: string;
  channel?: string;
  needsReview?: boolean;
  triage?: boolean;
  search?: string;
};

export const leadsApi = {
  list: (filter: LeadFilter = {}, cursor?: string) =>
    requestPage(leadSchema, `/api/leads${query({ ...filter, cursor })}`),
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
  dashboard: (range: { from?: string; to?: string } = {}) =>
    request(leadDashboardSchema, `/api/leads/dashboard${query(range)}`),
  duplicates: (cursor?: string) =>
    requestPage(leadDuplicateSchema, `/api/leads/duplicates${query({ cursor })}`),
  // Returns the kept lead.
  merge: (duplicateId: string, keepLeadId: string) =>
    request(leadSchema, at("leads/duplicates", duplicateId, "merge"), "POST", {
      keepLeadId,
    }),
  dismiss: (duplicateId: string) =>
    request(z.null(), at("leads/duplicates", duplicateId, "dismiss"), "POST", {}),
};
