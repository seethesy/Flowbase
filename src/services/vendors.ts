import {
  vendorDetailSchema,
  vendorSchema,
  type VendorInput,
  type VendorType,
} from "../../shared/vendors";
import { at, query, request, requestPage } from "./core";

// Vendor and distributor directory (FLOW-84).
export const vendorsApi = {
  list: (
    filter: { archived?: boolean; search?: string; type?: VendorType } = {},
    cursor?: string,
  ) => requestPage(vendorSchema, `/api/vendors${query({ ...filter, cursor })}`),
  get: (id: string) => request(vendorDetailSchema, at("vendors", id)),
  create: (input: VendorInput) =>
    request(vendorDetailSchema, "/api/vendors", "POST", input),
  update: (id: string, input: VendorInput) =>
    request(vendorDetailSchema, at("vendors", id), "PUT", input),
  setArchived: (id: string, archived: boolean) =>
    request(
      vendorDetailSchema,
      at("vendors", id, archived ? "archive" : "restore"),
      "POST",
      {},
    ),
};
