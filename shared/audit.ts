// Record history (FLOW-41), returned by GET /api/{clients,venues,events}/<id>/history
// and GET /api/recipes/<id>/history (FLOW-93).
export type AuditEntity = "client" | "venue" | "event" | "recipe";
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
