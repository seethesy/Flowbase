import { z } from "zod";
import { id, timestamp } from "./schema-primitives";
import type { Action } from "./policy";

// Bulk delete with Undo (FLOW-260). Deleting archives the record and marks it
// deleted in `deletions` (who and when); it is hidden even from the Show archived
// lists, and an Admin can restore it from Settings › Archived (A1: no purge yet).
export const deletableEntities = [
  "lead",
  "client",
  "venue",
  "event",
  "vendor",
  "inventory_item",
  "recipe",
  // The staff directory and SOPs tabs (FLOW-270).
  "staff_member",
  "sop",
] as const;
export const deletableEntitySchema = z.enum(deletableEntities);
export type DeletableEntity = z.infer<typeof deletableEntitySchema>;

export const deletableLabels: Record<DeletableEntity, string> = {
  lead: "Lead",
  client: "Client",
  venue: "Venue",
  event: "Event",
  vendor: "Vendor",
  inventory_item: "Inventory item",
  recipe: "Recipe",
  staff_member: "Staff member",
  sop: "SOP",
};

// Anyone who can edit a record can delete it (Art, 2026-11-20).
export const deletePermission: Record<DeletableEntity, Action> = {
  lead: "leads.update",
  client: "clients.write",
  venue: "venues.write",
  event: "events.write",
  vendor: "inventory.write",
  inventory_item: "inventory.write",
  recipe: "recipes.write",
  staff_member: "users.manage",
  sop: "sops.write",
};

export const MAX_BULK_DELETE = 100;
export const bulkDeleteSchema = z.object({
  entityType: deletableEntitySchema,
  ids: z.array(id).min(1).max(MAX_BULK_DELETE),
});
export type BulkDelete = z.infer<typeof bulkDeleteSchema>;

export const deleteResultSchema = z.object({
  deleted: z.array(id),
  skipped: z.array(z.object({ id, name: z.string(), reason: z.string() })),
});
export type DeleteResult = z.infer<typeof deleteResultSchema>;

export const deletedRecordSchema = z.object({
  id,
  entityType: deletableEntitySchema,
  entityId: id,
  name: z.string(),
  deletedAt: timestamp,
  deletedBy: z.object({ id, name: z.string() }).nullable(),
});
export type DeletedRecord = z.infer<typeof deletedRecordSchema>;
