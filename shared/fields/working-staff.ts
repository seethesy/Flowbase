import { type SourceDef } from "./types";

export const workingStaffFields: SourceDef = {
  key: "working-staff", label: "Working Staff", readAction: "tasks.read",
  listPath: "/api/home/working-staff",
  detailPath: (id) => `/api/home/working-staff/${encodeURIComponent(id)}`,
  recordRoute: (row) => typeof row.id === "string" ? `/staff/${row.id}` : null,
  titleField: "name",
  fields: [
    { key: "name", label: "Name", type: "text", sortable: true, filterable: true, required: true },
    { key: "position", label: "Position", type: "text", sortable: true, filterable: true },
    { key: "since", label: "Since", type: "datetime", sortable: true, filterable: true },
  ],
};
