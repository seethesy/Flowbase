import { z } from "zod";

export const historyEntrySchema = z.object({
  id: z.uuid(),
  action: z.enum(["create", "update", "archive", "restore"]),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable().optional(),
  at: z.iso.datetime(),
  changes: z.record(
    z.string(),
    z.object({ before: z.unknown(), after: z.unknown() }),
  ),
});
// Record history (FLOW-41), returned by GET /api/{clients,venues,events}/<id>/history,
// GET /api/inventory/items/<id>/history, GET /api/leads/<id>/history (FLOW-185),
// and GET /api/recipes/<id>/history (FLOW-93).
export type AuditEntity =
  | "client"
  | "venue"
  | "event"
  // The event's staff roster (FLOW-140).
  | "event_shift"
  | "event_staff_slot"
  | "user"
  | "setting"
  | "list_value"
  | "recipe"
  | "inventory_item"
  | "inventory_section"
  | "lead"
  // Proposals and their stage changes and versions (FLOW-122/123).
  | "proposal"
  // One create row per stock movement (FLOW-168).
  | "stock_movement";
export type HistoryEntry = {
  id: string;
  action: "create" | "update" | "archive" | "restore";
  // The user who made the change; null when the system made it.
  actorId: string | null;
  actorName?: string | null;
  at: string;
  // Changed fields by their API name, with only what the caller may see.
  changes: Record<string, { before: unknown; after: unknown }>;
};
