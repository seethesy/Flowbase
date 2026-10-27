import {
  staffMemberSchema,
  type StaffUpdate,
} from "../../shared/staff";
import { request } from "./core";

// Staff directory (FLOW-40).
const path = (id: string) => `/api/staff/${encodeURIComponent(id)}`;
export const staffApi = {
  list: () => request(staffMemberSchema.array(), "/api/staff"),
  get: (id: string) => request(staffMemberSchema, path(id)),
  update: (id: string, input: StaffUpdate) =>
    request(staffMemberSchema, path(id), "PATCH", input),
};
