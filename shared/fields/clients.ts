import { type SourceDef } from "./types";

export const clientFields: SourceDef = {
  key: "clients",
  label: "Clients",
  readAction: "clients.read",
  listPath: "/api/clients",
  detailPath: (id) => `/api/clients/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/clients/${row.id}` : null),
  titleField: "name",
  relations: [
    {
      key: "events",
      label: "Events",
      source: "events",
      path: (id) => `/api/events?clientId=${encodeURIComponent(id)}`,
    },
  ],
  fields: [
    { key: "name", label: "Name", type: "text", required: true, sortable: true, filterable: true },
    {
      key: "kind",
      label: "Type",
      type: "status",
      options: { labels: { person: "Person", organization: "Organization" }, copyId: "labels.client-kind" },
      sortable: true,
      filterable: true,
    },
    { key: "assignedSalespersonId", label: "Salesperson", type: "person", sortable: true, filterable: true },
    { key: "notes", label: "Notes", type: "text", filterable: true },
    { key: "createdAt", label: "Created", type: "datetime", sortable: true, filterable: true },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
