import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import type { BeoView } from "../../../shared/beo";
import { eventFieldsOf, mayGenerateBeoFrom } from "../../../shared/beo-from-proposal";
import type { ProposalMapping } from "../../../shared/proposal-mapping";
import { utcToBusinessTime } from "../../../shared/time";
import { timelineLines } from "../events/event-timeline";
import { parseTimelineLine } from "../../../shared/event-timeline";
import type { Db, DbLike } from "../../db/client";
import { beos, eventTimelineEntries, events, proposalMappings } from "../../db/schema";
import { ApiError, forbidden } from "../../hono";
import { can } from "../../policy";
import { writeAudit } from "../../audit/log";
import { emitDomainEvent } from "../../jobs/queue";
import { eventSnapshot, instants, lockVisibleEvent } from "../events/events";
import { markPlanningStale } from "../events/planning-stale";
import { syncEventHolds } from "../events/holds";
import { requestEventRecompute } from "../inventory/allocations";
import { generateKitchenMenu } from "../kitchen/kitchen-menu";
import { findVisibleProposal } from "../sales/proposals";
import { ensureBeoDraft, findBeo, getBeo, syncBeo } from "./beo";

// Generate BEO from a proposal at Closing or Closed (FLOW-337). The proposal's
// confirmed mapping for its current version (A1: reviewed first) is applied to
// the event records the BEO reads: guest count, date, times and address on the
// event; the kitchen menu from its menu lines; its timed timeline lines as event
// timeline entries. The staffing roster was written when the mapping was saved,
// and rental, decor and service lines reach the BEO through the pull list. Then
// the event's BEO is created if it has none, or updated (A2): an approved BEO
// logs the changes as any edit after approval does (FLOW-144). Safe to repeat:
// nothing is added twice.
export async function generateBeoFromProposal(db: Db, actor: Actor, proposalId: string): Promise<BeoView> {
  if (!can(actor, "events.write")) throw forbidden();
  const proposal = await findVisibleProposal(db, actor, proposalId);
  if (!mayGenerateBeoFrom(proposal.stage))
    throw new ApiError(409, "INVALID_TRANSITION", "A BEO is generated from a proposal at Closing or Closed.");
  const [mapped] = await db.select().from(proposalMappings)
    .where(and(eq(proposalMappings.proposalId, proposalId), isNull(proposalMappings.archivedAt)));
  if (!proposal.currentVersionId || mapped?.versionId !== proposal.currentVersionId)
    throw new ApiError(409, "MAPPING_REQUIRED", "Review and confirm the proposal's current version before generating the BEO.");
  const mapping = mapped.data;
  const eventId = proposal.eventId;
  await db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const before = await findBeo(tx, eventId, true);
    await applyEventFields(tx, actor, eventId, mapping);
    await generateKitchenMenu(tx, actor, eventId);
    await addTimelineEntries(tx, actor, eventId, proposalId, mapping);
    const created = await ensureBeoDraft(tx, actor.userId, eventId);
    // A2: an existing BEO is updated from this proposal; changes after approval
    // are logged and marked.
    if (!created) await syncBeo(tx, actor, eventId);
    const beo = (await findBeo(tx, eventId, true))!;
    await tx.update(beos)
      .set({ sourceProposalId: proposalId, sourceVersionId: mapping.versionId, updatedBy: actor.userId })
      .where(eq(beos.id, beo.id));
    await writeAudit(tx, actor, {
      entityType: "beo",
      entityId: beo.id,
      action: created ? "create" : "update",
      before: before ? { sourceProposalId: before.sourceProposalId, sourceVersionId: before.sourceVersionId } : null,
      after: { sourceProposalId: proposalId, sourceVersionId: mapping.versionId, fromProposal: proposal.title },
    });
  });
  return getBeo(db, actor, eventId);
}

// The mapping's event fields, written only where they differ.
async function applyEventFields(tx: DbLike, actor: Actor, eventId: string, mapping: ProposalMapping) {
  const fields = eventFieldsOf(mapping);
  const [current] = await tx.select().from(events).where(eq(events.id, eventId));
  const local = utcToBusinessTime(current.startsAt);
  const date = fields.date ?? local.date;
  const startTime = fields.startTime ?? local.time;
  const endTime = fields.endTime ?? (current.endsAt ? utcToBusinessTime(current.endsAt).time : null);
  const { startsAt, endsAt } = instants({ date, startTime, endTime });
  const changes = {
    ...(startsAt.getTime() !== current.startsAt.getTime() && { startsAt }),
    ...((endsAt?.getTime() ?? null) !== (current.endsAt?.getTime() ?? null) && { endsAt }),
    ...(fields.guestCount !== null && fields.guestCount !== current.guestCount && { guestCount: fields.guestCount }),
    ...(fields.address !== null && fields.address !== current.address && { address: fields.address }),
  };
  if (!Object.keys(changes).length) return;
  const before = await eventSnapshot(tx, eventId);
  await tx.update(events).set({ ...changes, updatedBy: actor.userId }).where(eq(events.id, eventId));
  await writeAudit(tx, actor, { entityType: "event", entityId: eventId, action: "update", before, after: await eventSnapshot(tx, eventId) });
  await emitDomainEvent(tx, { name: "event.updated", entityId: eventId });
  const causes = [
    "guestCount" in changes && "Guest count changed",
    ("startsAt" in changes || "endsAt" in changes) && "Event date or time changed",
  ].filter((cause): cause is string => Boolean(cause));
  if (causes.length) await markPlanningStale(tx, actor, eventId, causes.join(", "));
  await syncEventHolds(tx, eventId);
  await requestEventRecompute(tx, eventId);
}

// Each timed line of the mapping's timeline becomes an event-day entry, once: a
// line already added (by hand or an earlier run) is skipped. Lines without a time
// stay suggestions on the event's timeline.
async function addTimelineEntries(tx: DbLike, actor: Actor, eventId: string, proposalId: string, mapping: ProposalMapping) {
  const existing = await tx.select({ sourceKey: eventTimelineEntries.sourceKey }).from(eventTimelineEntries)
    .where(and(eq(eventTimelineEntries.eventId, eventId), eq(eventTimelineEntries.proposalId, proposalId), isNull(eventTimelineEntries.archivedAt)));
  const used = new Set(existing.map((row) => row.sourceKey));
  const [event] = await tx.select({ startsAt: events.startsAt }).from(events).where(eq(events.id, eventId));
  const date = utcToBusinessTime(event.startsAt).date;
  for (const line of timelineLines(mapping)) {
    if (!line.text || used.has(line.sourceKey)) continue;
    const parsed = parseTimelineLine(line.text);
    if (!parsed.startTime) continue;
    const endTime = parsed.endTime && parsed.endTime !== parsed.startTime ? parsed.endTime : halfHourAfter(parsed.startTime);
    // An end before the start runs past midnight, as on the timeline.
    const times = instants({ date, startTime: parsed.startTime, endTime });
    const [row] = await tx.insert(eventTimelineEntries).values({
      eventId,
      kind: "event",
      startsAt: times.startsAt,
      endsAt: times.endsAt!,
      activity: parsed.activity.slice(0, 500),
      proposalId,
      sourceKey: line.sourceKey,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    }).returning();
    await writeAudit(tx, actor, { entityType: "event_timeline_entry", entityId: row.id, action: "create", before: null,
      after: { eventId, activity: row.activity, proposalId, sourceKey: line.sourceKey } });
  }
}

const halfHourAfter = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60 + minute + 30) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
