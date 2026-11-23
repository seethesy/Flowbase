import { z } from "zod";
import {
  payExceptionSchema,
  payrollSchema,
  staffPaySchema,
  type PayExceptionInput,
  type PayExceptionUpdate,
  type StaffPayInput,
} from "../../shared/staff-pay";
import { request } from "./core";

// Staff pay and the Payroll tab (FLOW-270): Admin and Technical.
const base = "/api/staff-pay";
export const staffPayApi = {
  get: (from: string, to: string) =>
    request(payrollSchema, `${base}?${new URLSearchParams({ from, to }).toString()}`),
  save: (input: StaffPayInput) => request(staffPaySchema, base, "PUT", input),
  addException: (input: PayExceptionInput) =>
    request(payExceptionSchema, `${base}/exceptions`, "POST", input),
  updateException: (id: string, input: PayExceptionUpdate) =>
    request(payExceptionSchema, `${base}/exceptions/${encodeURIComponent(id)}`, "PATCH", input),
  removeException: (id: string) =>
    request(z.object({ archived: z.string() }), `${base}/exceptions/${encodeURIComponent(id)}`, "DELETE"),
};
