import { canSeeField } from "../visibility";
import { vendorTypeLabels } from "../vendors";
import { type SourceDef } from "./types";

export const vendorFields: SourceDef = {
  key: "vendors",
  label: "Vendors",
  readAction: "inventory.read",
  listPath: "/api/vendors",
  detailPath: (id) => `/api/vendors/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/vendors/${row.id}` : null),
  titleField: "name",
  relations: [{ key: "items", label: "Items they supply", source: "inventory", path: (id) => `/api/vendors/${encodeURIComponent(id)}/items` }],
  fields: [
    { key: "name", label: "Vendor", type: "text", required: true, sortable: true, filterable: true },
    {
      key: "type",
      label: "Type",
      type: "status",
      options: { labels: vendorTypeLabels, copyId: "labels.vendor-type" },
      sortable: true,
      filterable: true,
    },
    { key: "portalUrl", label: "Portal", type: "text" },
    {
      key: "accountNumber",
      label: "Account number",
      type: "text",
      read: (actor) => canSeeField(actor, "vendor_contact"),
    },
    { key: "orderCutoff", label: "Order cutoff", type: "text", sortable: true },
    { key: "deliveryDays", label: "Delivery days", type: "text", filterable: true },
    { key: "minimumOrderCents", label: "Minimum order", type: "money", sortable: true },
    { key: "leadTimeDays", label: "Lead time (days)", type: "number", sortable: true, filterable: true },
    { key: "orderingInstructions", label: "Ordering instructions", type: "text" },
    { key: "notes", label: "Notes", type: "text" },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
