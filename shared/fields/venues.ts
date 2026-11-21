import { type SourceDef } from "./types";

export const venueFields: SourceDef = {
  key: "venues",
  label: "Venues",
  readAction: "venues.read",
  listPath: "/api/venues",
  detailPath: (id) => `/api/venues/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/venues/${row.id}` : null),
  titleField: "name",
  relations: [
    {
      key: "events",
      label: "Events",
      source: "events",
      path: (id) => `/api/events?venueId=${encodeURIComponent(id)}`,
    },
  ],
  fields: [
    { key: "name", label: "Venue", type: "text", required: true, sortable: true, filterable: true },
    { key: "address", label: "Address", type: "text", sortable: true, filterable: true },
    {
      key: "jurisdiction",
      label: "Jurisdiction",
      type: "status",
      options: { labels: { DC: "DC", MD: "MD", VA: "VA" }, copyId: "labels.jurisdiction" },
      sortable: true,
      filterable: true,
    },
    { key: "loadInNotes", label: "Load-in notes", type: "text" },
    { key: "parkingNotes", label: "Parking notes", type: "text" },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
