import { proposalStageLabels } from "../proposals";
import { type SourceDef } from "./types";

export const proposalFields: SourceDef = {
  key: "proposals",
  label: "Proposals",
  readAction: "proposals.read",
  // Proposals are listed per event: GET /api/proposals?eventId=<id>. As a main
  // list, cards read the sales tracker's rows instead (see worker/fields.ts).
  listPath: "/api/proposals",
  detailPath: (id) => `/api/proposals/${encodeURIComponent(id)}`,
  recordRoute: (row) =>
    typeof row.eventId === "string" && typeof row.id === "string" ? `/events/${row.eventId}?proposal=${row.id}` : null,
  titleField: "title",
  fields: [
    { key: "title", label: "Proposal", type: "text", required: true, sortable: true, filterable: true },
    {
      key: "stage",
      label: "Status",
      type: "status",
      options: { labels: proposalStageLabels, copyId: "labels.pipeline-status", pill: true },
      sortable: true,
      filterable: true,
    },
    { key: "assignedSalesperson", label: "Salesperson", type: "person", sortable: true, filterable: true },
    { key: "currentVersion", label: "Version", type: "number", sortable: true },
    {
      key: "approvalStatus",
      label: "Approval",
      type: "status",
      options: {
        labels: { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" },
        copyId: "labels.approval-status",
      },
      sortable: true,
      filterable: true,
    },
    { key: "notes", label: "Notes", type: "text" },
    { key: "sentAt", label: "Sent", type: "datetime", sortable: true, filterable: true },
    { key: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
