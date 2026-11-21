import { type SourceDef } from "./types";

export const inventoryFields: SourceDef = {
  key: "inventory",
  label: "Inventory",
  readAction: "inventory.read",
  listPath: "/api/inventory/items",
  detailPath: (id) => `/api/inventory/items/${encodeURIComponent(id)}`,
  recordRoute: (row) => (typeof row.id === "string" ? `/inventory/${row.id}` : null),
  titleField: "name",
  fields: [
    { key: "name", label: "Item", type: "text", required: true, sortable: true, filterable: true },
    { key: "code", label: "Code", type: "text", sortable: true, filterable: true },
    {
      key: "kind",
      label: "Kind",
      type: "status",
      options: {
        labels: { rental: "Rental", consumable: "Consumable", service: "Service" },
        copyId: "labels.item-kind",
      },
      sortable: true,
      filterable: true,
    },
    { key: "subtype", label: "Subtype", type: "text", sortable: true, filterable: true },
    { key: "category", label: "Category", type: "text", sortable: true, filterable: true },
    { key: "subcategory", label: "Subcategory", type: "text", sortable: true, filterable: true },
    { key: "group", label: "Group", type: "text", sortable: true, filterable: true },
    { key: "description", label: "Description", type: "text", filterable: true },
    { key: "unit", label: "Unit", type: "text", sortable: true, filterable: true },
    { key: "color", label: "Color", type: "text", sortable: true, filterable: true },
    { key: "tier", label: "Tier", type: "text", sortable: true, filterable: true },
    { key: "totalQuantity", label: "On hand", type: "number", sortable: true, filterable: true },
    { key: "belowPar", label: "Below par", type: "boolean", filterable: true },
    { key: "active", label: "Active", type: "boolean", filterable: true },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
