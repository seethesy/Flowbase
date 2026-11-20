import { z } from "zod";
import {
  deletedRecordSchema,
  deleteResultSchema,
  type DeletableEntity,
} from "../../shared/deletions";
import { id } from "../../shared/schema-primitives";
import { request } from "./core";

// Bulk delete and restore (FLOW-260): one batched request of at most 100 ids.
export const deletionsApi = {
  remove: (entityType: DeletableEntity, ids: string[]) =>
    request(deleteResultSchema, `/api/deletions/${entityType}`, "POST", { ids }),
  restore: (entityType: DeletableEntity, ids: string[]) =>
    request(z.object({ restored: z.array(id) }), `/api/deletions/${entityType}/restore`, "POST", { ids }),
  // Settings › Archived (Admin).
  list: () => request(deletedRecordSchema.array(), "/api/deletions"),
};
