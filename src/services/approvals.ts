import { approvalRequestSchema } from "../../shared/approvals";
import { request, requestPage } from "./core";

export const approvalsApi = {
  list: (cursor?: string) => requestPage(approvalRequestSchema, `/api/approvals?queue=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  approve: (id: string, comment = "") => request(approvalRequestSchema, `/api/approvals/${id}/approve`, "POST", { comment }),
  reject: (id: string, comment: string) => request(approvalRequestSchema, `/api/approvals/${id}/reject`, "POST", { comment }),
};
