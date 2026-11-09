import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { defaultDepartment } from "../../shared/event-staff";
import { diffProposalMappings, unmatchedLines, type ProposalMapping } from "../../shared/proposal-mapping";
import type { Db } from "../db/client";
import { writeAudit } from "../audit/log";
import { eventShifts, eventStaffSlots, events, inventoryItems, proposalMappings, proposalVersions, proposalVersionMappings, proposalChangeLog, approvalRequests, recipes } from "../db/schema";
import { ApiError } from "../hono";
import { findVisibleProposal } from "./proposals";
import { assertListLabels } from "./settings";

export async function getProposalMapping(db: Db, actor: Actor, proposalId: string) {
  const proposal = await findVisibleProposal(db, actor, proposalId);
  const [row] = await db.select().from(proposalMappings).where(eq(proposalMappings.proposalId, proposalId));
  return row?.versionId === proposal.currentVersionId ? row.data : null;
}

export async function getPreviousProposalMapping(db: Db, actor: Actor, proposalId: string) {
  const proposal = await findVisibleProposal(db, actor, proposalId);
  const [row] = await db.select().from(proposalMappings).where(eq(proposalMappings.proposalId, proposalId));
  if (!row || row.versionId === proposal.currentVersionId || !proposal.currentVersionId) return null;
  const data = row.data;
  return { ...data, versionId: proposal.currentVersionId,
    fields: Object.fromEntries(Object.entries(data.fields).map(([key, field]) => [key, { ...field, sourceBlockId: null }])),
    lines: data.lines.map((line) => ({ ...line, sourceBlockId: null })),
    staffing: data.staffing.map((line) => ({ ...line, sourceBlockId: null })),
    timeline: data.timeline.map((line) => ({ ...line, sourceBlockId: null })),
    charges: data.charges.map((line) => ({ ...line, sourceBlockId: null })),
    paymentSchedule: data.paymentSchedule.map((line) => ({ ...line, sourceBlockId: null })),
    unextractedBlockIds: [],
  };
}

export async function getProposalCatalog(db: Db, actor: Actor, proposalId: string) {
  await findVisibleProposal(db, actor, proposalId);
  const [dishes, items] = await Promise.all([
    db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(and(eq(recipes.active, true), isNull(recipes.archivedAt))),
    db.select({ id: inventoryItems.id, name: inventoryItems.name, kind: inventoryItems.kind, subtype: inventoryItems.subtype }).from(inventoryItems).where(and(eq(inventoryItems.active, true), isNull(inventoryItems.archivedAt))),
  ]);
  return { recipes: dishes, items };
}

// Save the confirmed mapping and roster together. Slot keys are stable across
// saves, so an assigned slot keeps its person and a second save adds no duplicate.
export async function saveProposalMapping(db: Db, actor: Actor, proposalId: string, data: ProposalMapping) {
  const current = await findVisibleProposal(db, actor, proposalId);
  if (current.stage !== "finalized")
    throw new ApiError(409, "INVALID_TRANSITION", "Only a finalized proposal can be reviewed for approval.");
  if (current.currentVersionId !== data.versionId)
    throw new ApiError(409, "VERSION_CHANGED", "Review the current proposal version before saving.");
  const [pending] = await db.select({ id: approvalRequests.id }).from(approvalRequests)
    .where(and(eq(approvalRequests.subjectType, "proposal_version"), eq(approvalRequests.subjectId, data.versionId), eq(approvalRequests.status, "pending")));
  if (pending) throw new ApiError(409, "APPROVAL_PENDING", "Withdraw or reject the pending request before changing its mapping.");
  const unmatched = unmatchedLines(data);
  if (unmatched.length)
    throw new ApiError(400, "UNMATCHED_LINE", `Match or mark not tracked: ${unmatched.join(", ")}`);
  const [version] = await db.select({ status: proposalVersions.status }).from(proposalVersions).where(eq(proposalVersions.id, data.versionId));
  if (version?.status !== "ready") throw new ApiError(409, "VERSION_CHANGED", "The current version is not ready.");
  const catalog = await getProposalCatalog(db, actor, proposalId);
  const recipeIds = new Set(catalog.recipes.map((item) => item.id));
  const itemKinds = new Map(catalog.items.map((item) => [item.id, item]));
  for (const line of data.lines) {
    if (!line.catalogId || line.notTracked) continue;
    const item = itemKinds.get(line.catalogId);
    if (line.kind === "menu" ? !recipeIds.has(line.catalogId) :
      item?.kind !== (line.kind === "service" ? "service" : line.kind === "supply" ? "consumable" : "rental") ||
      (line.kind === "supply" && item?.subtype !== "supply"))
      throw new ApiError(400, "INVALID_MAPPING", `Choose a valid catalog match for ${line.name}.`);
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(proposalMappings).where(eq(proposalMappings.proposalId, proposalId)).for("update");
    const [currentVersion] = await tx.select({ number: proposalVersions.number }).from(proposalVersions).where(eq(proposalVersions.id, data.versionId));
    const priorVersion = currentVersion?.number && currentVersion.number > 1
      ? await tx.select({ id: proposalVersions.id }).from(proposalVersions)
        .where(and(eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.number, currentVersion.number - 1)))
      : [];
    const [prior] = priorVersion.length
      ? await tx.select({ data: proposalVersionMappings.data }).from(proposalVersionMappings).where(eq(proposalVersionMappings.versionId, priorVersion[0].id))
      : [];
    const previousMapping = prior?.data ?? (row && row.versionId !== data.versionId ? row.data : null);
    await tx.delete(proposalChangeLog).where(eq(proposalChangeLog.versionId, data.versionId));
    if (previousMapping) {
      const changes = diffProposalMappings(previousMapping, data);
      if (changes.length) await tx.insert(proposalChangeLog).values(changes.map((change) => ({
        proposalId, versionId: data.versionId, path: change.path,
        oldValue: change.oldValue, newValue: change.newValue, createdBy: actor.userId, updatedBy: actor.userId,
      })));
    }
    const [snapshot] = await tx.select({ id: proposalVersionMappings.id }).from(proposalVersionMappings).where(eq(proposalVersionMappings.versionId, data.versionId));
    if (snapshot) await tx.update(proposalVersionMappings).set({ data, updatedBy: actor.userId }).where(eq(proposalVersionMappings.id, snapshot.id));
    else await tx.insert(proposalVersionMappings).values({ versionId: data.versionId, data, createdBy: actor.userId, updatedBy: actor.userId });
    if (row) await tx.update(proposalMappings).set({ versionId: data.versionId, data, updatedBy: actor.userId }).where(eq(proposalMappings.id, row.id));
    else await tx.insert(proposalMappings).values({ proposalId, versionId: data.versionId, data, createdBy: actor.userId, updatedBy: actor.userId });
    await writeAudit(tx, actor, { entityType: "proposal", entityId: proposalId, action: "update", before: { mapping: row?.data ?? null }, after: { mapping: data } });

    const [event] = await tx.select().from(events).where(eq(events.id, current.eventId));
    let [shift] = await tx.select().from(eventShifts).where(and(eq(eventShifts.eventId, event.id), eq(eventShifts.kind, "event_day"), isNull(eventShifts.archivedAt))).orderBy(eventShifts.createdAt).limit(1);
    if (data.staffing.length && !shift) {
      if (!event.endsAt)
        throw new ApiError(400, "EVENT_TIME_REQUIRED", "Set the event end time before mapping staffing slots.");
      [shift] = await tx.insert(eventShifts).values({ eventId: event.id, kind: "event_day", startsAt: event.startsAt, endsAt: event.endsAt, createdBy: actor.userId, updatedBy: actor.userId }).returning();
    }
    const counts = new Map<string, number>();
    const wanted = data.staffing.flatMap((line) => Array.from({ length: line.count }, () => {
      const positionKey = line.position.trim().toLowerCase();
      const next = (counts.get(positionKey) ?? 0) + 1;
      counts.set(positionKey, next);
      return { key: `${positionKey}:${next}`, position: line.position };
    }));
    const previous = await tx.select().from(eventStaffSlots).where(and(eq(eventStaffSlots.proposalId, proposalId), isNull(eventStaffSlots.archivedAt)));
    await assertListLabels(tx, "staff_position", [...new Set(wanted.map((slot) => slot.position))], previous.map((slot) => slot.position));
    const byKey = new Map(previous.map((slot) => [slot.proposalSlotKey, slot]));
    const keys = new Set(wanted.map((slot) => slot.key));
    for (const slot of wanted) {
      const old = byKey.get(slot.key);
      if (old) {
        if (old.position !== slot.position)
          await tx.update(eventStaffSlots).set({ position: slot.position, department: defaultDepartment(slot.position), updatedBy: actor.userId }).where(eq(eventStaffSlots.id, old.id));
      } else await tx.insert(eventStaffSlots).values({ shiftId: shift!.id, position: slot.position, department: defaultDepartment(slot.position), proposalId, proposalSlotKey: slot.key, createdBy: actor.userId, updatedBy: actor.userId });
    }
    for (const old of previous)
      if (!keys.has(old.proposalSlotKey!) && !old.assigneeId)
        await tx.update(eventStaffSlots).set({ archivedAt: new Date(), updatedBy: actor.userId }).where(eq(eventStaffSlots.id, old.id));
  });
  return data;
}
