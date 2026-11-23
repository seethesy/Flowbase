import { type SourceDef } from "./types";

export const recipesFields: SourceDef = {
  key: "recipes", label: "Recipes", readAction: "recipes.read",
  listPath: "/api/recipes",
  detailPath: (id) => `/api/recipes/${encodeURIComponent(id)}`,
  recordRoute: (row) => typeof row.id === "string" ? `/recipes/${row.id}` : null,
  titleField: "name",
  fields: [
    { key: "name", label: "Dish", type: "text", sortable: true, filterable: true, required: true },
    { key: "category", label: "Category", type: "text", sortable: true, filterable: true },
    { key: "description", label: "Description", type: "text", sortable: true, filterable: true },
    { key: "allergens", label: "Allergens", type: "text", sortable: true, filterable: true },
    { key: "dietaryTags", label: "Dietary tags", type: "text", sortable: true, filterable: true },
    { key: "active", label: "Active", type: "boolean", sortable: true, filterable: true },
    { key: "updatedAt", label: "Last updated", type: "datetime", sortable: true, filterable: true },
  ],
};
