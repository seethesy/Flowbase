import { z } from "zod";
import { inventoryCategorySchema, inventoryTypeSchema } from "../../shared/inventory";
import { request } from "./core";

const catalogSchema = z.object({ categories: inventoryCategorySchema.array(), types: inventoryTypeSchema.array() });
export const inventoryCategoriesApi = {
  list: () => request(catalogSchema, "/api/inventory/categories"),
  createCategory: (kind: string, name: string) => request(inventoryCategorySchema, "/api/inventory/categories", "POST", { kind, name }),
  updateCategory: (id: string, change: { name?: string; sortOrder?: number; archived?: boolean }) =>
    request(inventoryCategorySchema, `/api/inventory/categories/${id}`, "PATCH", change),
  createType: (categoryId: string, name: string) => request(inventoryTypeSchema, "/api/inventory/types", "POST", { categoryId, name }),
  updateType: (id: string, change: { name?: string; sortOrder?: number; archived?: boolean }) =>
    request(inventoryTypeSchema, `/api/inventory/types/${id}`, "PATCH", change),
};
