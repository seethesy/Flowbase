import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { RegeneratePreview } from "../../shared/planning";
import { can } from "../../shared/policy";
import type { Db } from "../db/client";
import { eventPlanningOutputs } from "../db/schema";
import { ApiError, forbidden } from "../hono";
import { findVisibleEvent } from "./events";
import { syncBeo } from "./beo";
import { planningOutputSnapshot, type RefreshableOutput } from "./planning-output-snapshot";
import { clearPlanningStale } from "./planning-stale";

const staleRow = (db: Db, eventId: string, kind: RefreshableOutput) => db.select()
  .from(eventPlanningOutputs).where(and(eq(eventPlanningOutputs.eventId, eventId),
    eq(eventPlanningOutputs.kind, kind), isNull(eventPlanningOutputs.archivedAt)));

export async function previewPlanningRefresh(db: Db, actor: Actor, eventId: string, kind: RefreshableOutput): Promise<RegeneratePreview> {
  await findVisibleEvent(db, actor, eventId);
  const [row] = await staleRow(db, eventId, kind);
  if (!row) return { changes: [], upToDate: true };
  const after = await planningOutputSnapshot(db, eventId, kind);
  const changes = [...new Set([...Object.keys(row.before), ...Object.keys(after)])].sort().flatMap((key) => {
    const current = row.before[key] ?? null;
    const generated = after[key] ?? null;
    if (current === generated) return [];
    return [{ kind: current === null ? "added" as const : generated === null ? "removed" as const : "changed" as const,
      label: key, current, generated, reason: null }];
  });
  return { changes, upToDate: changes.length === 0 };
}

export async function regeneratePlanningOutput(db: Db, actor: Actor, eventId: string, kind: RefreshableOutput, expectedStaleAt: string) {
  if (!can(actor, "events.write")) throw forbidden();
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(eventPlanningOutputs).where(and(eq(eventPlanningOutputs.eventId, eventId),
      eq(eventPlanningOutputs.kind, kind), isNull(eventPlanningOutputs.archivedAt))).for("update");
    if (!row) return;
    if (row.staleAt.toISOString() !== expectedStaleAt)
      throw new ApiError(409, "STALE_PREVIEW", "Event details changed again. Review the new diff before regenerating.");
    // The requirements and order list are live projections; the truck log is
    // manually maintained. Confirming their diff keeps those manual values.
    // BEO synchronization handles key-field re-approval after approval.
    if (kind === "beo") await syncBeo(tx, actor, eventId);
    await clearPlanningStale(tx, eventId, kind);
  });
  return previewPlanningRefresh(db, actor, eventId, kind);
}
