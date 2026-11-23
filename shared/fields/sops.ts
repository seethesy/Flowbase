import { type SourceDef } from "./types";

export const sopsFields: SourceDef = {
  key: "sops", label: "SOPs", readAction: "sops.read",
  listPath: "/api/sops",
  detailPath: (id) => `/api/sops/${encodeURIComponent(id)}`,
  recordRoute: (row) => typeof row.id === "string" ? `/sops/${row.id}` : null,
  titleField: "title",
  fields: [
    { key: "title", label: "Title", type: "text", sortable: true, filterable: true, required: true },
    { key: "category", label: "Category", type: "text", sortable: true, filterable: true },
    { key: "version", label: "Version", type: "number", sortable: true, filterable: true },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
