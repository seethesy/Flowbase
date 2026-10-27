import { asc, eq } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { writeAudit } from "../audit/log";
import type { DbLike } from "../db/client";
import { leads } from "../db/schema";
import { notFound } from "../hono";

// Lead audit snapshots (FLOW-185), shared by leads.ts and lead-duplicates.ts. The
// snapshot uses the lead's API field names and leaves out the raw source payload
// (it never changes after intake and stays FT+ only) and derived values. It adds
// the leads merged into this one, so a merge shows on the kept lead.
const audited = [
  "receivedAt",
  "channel",
  "source",
  "sourceLeadId",
  "sourceLeadUrl",
  "purchased",
  "name",
  "email",
  "phone",
  "eventDate",
  "guestCount",
  "location",
  "eventType",
  "budgetCents",
  "message",
  "status",
  "lostReason",
  "firstRespondedAt",
  "assignedSalespersonId",
  "convertedClientId",
  "convertedEventId",
  "mergedIntoLeadId",
  "archivedAt",
] as const;

export async function leadSnapshot(db: DbLike, id: string) {
  const [row] = await db.select().from(leads).where(eq(leads.id, id));
  if (!row) throw notFound("Lead");
  const merged = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.mergedIntoLeadId, id))
    .orderBy(asc(leads.id));
  const snapshot: Record<string, unknown> = Object.fromEntries(
    audited.map((key) => {
      const value = row[key];
      return [key, value instanceof Date ? value.toISOString() : value];
    }),
  );
  snapshot.mergedLeadIds = merged.map((lead) => lead.id);
  return snapshot;
}

// Writes the lead's audit row for a change made in tx, given its snapshot from
// before the change.
export async function auditLead(
  tx: DbLike,
  actor: Actor,
  id: string,
  before: Record<string, unknown>,
  action: "update" | "archive" = "update",
) {
  await writeAudit(tx, actor, {
    entityType: "lead",
    entityId: id,
    action,
    before,
    after: await leadSnapshot(tx, id),
  });
}
