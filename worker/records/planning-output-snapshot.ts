import { and, eq, isNull } from "drizzle-orm";
import type { DbLike } from "../db/client";
import { beos, consumableAllocations, eventRequirements, pullListLines, pullLists, truckAssignments } from "../db/schema";

export type RefreshableOutput = "requirements" | "order_list" | "beo" | "truck_log";

// Values are rendered as strings so the same snapshot can be compared and shown
// to a planner without interpreting each module's private database rows.
export async function planningOutputSnapshot(db: DbLike, eventId: string, kind: RefreshableOutput): Promise<Record<string, string>> {
  if (kind === "requirements") {
    const rows = await db.select().from(eventRequirements).where(and(eq(eventRequirements.eventId, eventId), isNull(eventRequirements.archivedAt)));
    return Object.fromEntries(rows.map((row) => [`${row.source}:${row.itemId}`, `${row.quantity} (${row.basis})`]));
  }
  if (kind === "order_list") {
    const rows = await db.select().from(consumableAllocations).where(and(eq(consumableAllocations.eventId, eventId), isNull(consumableAllocations.archivedAt)));
    return Object.fromEntries(rows.map((row) => [row.itemId, `${row.required} required, ${row.shortage} short`]));
  }
  if (kind === "beo") {
    const [row] = await db.select({ snapshot: beos.snapshot }).from(beos).where(and(eq(beos.eventId, eventId), isNull(beos.archivedAt)));
    return row?.snapshot ?? {};
  }
  const assignments = await db.select().from(truckAssignments).where(and(eq(truckAssignments.eventId, eventId), isNull(truckAssignments.archivedAt)));
  const [pull] = await db.select({ id: pullLists.id }).from(pullLists).where(eq(pullLists.eventId, eventId));
  const lines = pull ? await db.select().from(pullListLines).where(and(eq(pullListLines.pullListId, pull.id), isNull(pullListLines.archivedAt))) : [];
  return Object.fromEntries([
    ...assignments.map((row) => [`truck:${row.truckId}`, `${row.departsAt.toISOString()}–${row.returnsAt.toISOString()}, driver ${row.driverId ?? "unassigned"}`] as const),
    ...lines.map((row) => [`line:${row.id}`, `${row.name}: ${row.truckId ?? "unassigned"}`] as const),
  ]);
}
