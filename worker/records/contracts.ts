import { and, eq, isNull, lte } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { RecordContractInput } from "../../shared/contracts";
import type { Db } from "../db/client";
import { addendums, approvalRequests, attachments, contracts, events, proposalChangeLog, proposals, proposalVersions, settings } from "../db/schema";
import { ApiError, notFound } from "../hono";
import { writeAudit } from "../audit/log";
import { emitDomainEvent } from "../jobs/queue";
import { advanceEventStatus, findVisibleEvent, lockVisibleEvent, visibleEvents } from "./events";
import { findVisibleProposal, markProposalSigned } from "./proposals";
import { defaultBusinessDefaults, businessDefaultsSchema } from "../../shared/settings";

const contractView = (row: typeof contracts.$inferSelect) => ({
  id: row.id, eventId: row.eventId, proposalId: row.proposalId, versionId: row.versionId,
  signedAt: row.signedAt.toISOString(), clientSigner: row.clientSigner,
  salespersonSigner: row.salespersonSigner, cardOnFile: row.cardOnFile,
  cardLast4: row.cardLast4, attachmentId: row.attachmentId,
});
const addendumView = (row: typeof addendums.$inferSelect) => ({
  id: row.id, eventId: row.eventId, proposalId: row.proposalId, proposalVersionId: row.proposalVersionId,
  changeIds: row.changeIds, sentAt: row.sentAt.toISOString(),
  signedAt: row.signedAt?.toISOString() ?? null,
  reminderSentAt: row.reminderSentAt?.toISOString() ?? null,
});

export async function listEventContracts(db: Db, actor: Actor, eventId: string) {
  await findVisibleEvent(db, actor, eventId);
  return (await db.select().from(contracts).where(eq(contracts.eventId, eventId))).map(contractView);
}
export async function recordContract(db: Db, actor: Actor, proposalId: string, input: RecordContractInput) {
  const proposal = await findVisibleProposal(db, actor, proposalId);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(proposals).where(eq(proposals.id, proposalId)).for("update");
    const event = await lockVisibleEvent(tx, actor, proposal.eventId);
    if (!current || current.stage !== "sent" || !current.currentVersionId)
      throw new ApiError(409, "INVALID_TRANSITION", "Record a sent proposal before signing its contract.");
    if (input.attachmentId) {
      const [file] = await tx.select().from(attachments).where(and(eq(attachments.id, input.attachmentId), eq(attachments.recordType, "event"), eq(attachments.recordId, event.id), eq(attachments.status, "ready"), isNull(attachments.archivedAt)));
      if (!file || !/\.pdf$/i.test(file.fileName) || file.variants[0]?.contentType !== "application/pdf")
        throw new ApiError(400, "INVALID_ATTACHMENT", "Choose a completed event PDF attachment.");
    }
    const [row] = await tx.insert(contracts).values({
      eventId: event.id, proposalId, versionId: current.currentVersionId,
      signedAt: new Date(input.signedAt), clientSigner: input.clientSigner,
      salespersonSigner: input.salespersonSigner, cardOnFile: input.cardOnFile,
      cardLast4: input.cardLast4, attachmentId: input.attachmentId,
      createdBy: actor.userId, updatedBy: actor.userId,
    }).returning();
    await writeAudit(tx, actor, { entityType: "contract", entityId: row.id, action: "create", before: null, after: contractView(row) });
    if (!event.bookedAt) {
      await tx.update(events).set({ bookedAt: new Date(input.signedAt), updatedBy: actor.userId }).where(eq(events.id, event.id));
      await writeAudit(tx, actor, { entityType: "event", entityId: event.id, action: "update",
        before: { bookedAt: null }, after: { bookedAt: input.signedAt } });
    }
    await markProposalSigned(tx, actor, proposalId);
    if (event.status === "initial_proposal_sent") await advanceEventStatus(tx, event.id, "negotiation", "Contract signed");
    if (event.status === "initial_proposal_sent" || event.status === "negotiation")
      await advanceEventStatus(tx, event.id, "closing", "Contract signed");
    return contractView(row);
  });
}

export async function listEventAddendums(db: Db, actor: Actor, eventId: string) {
  await findVisibleEvent(db, actor, eventId);
  return (await db.select().from(addendums).where(eq(addendums.eventId, eventId))).map(addendumView);
}
export async function listOpenAddendums(db: Db, actor: Actor) {
  const rows = await db.select({ addendum: addendums, eventTitle: events.title })
    .from(addendums).innerJoin(events, eq(events.id, addendums.eventId))
    .where(and(isNull(addendums.signedAt), isNull(addendums.archivedAt), visibleEvents(actor)));
  return rows.map(({ addendum, eventTitle }) => ({ ...addendumView(addendum), eventTitle }));
}
export async function recordAddendum(db: Db, actor: Actor, eventId: string, input: { proposalVersionId: string; changeIds: string[]; sentAt: string }) {
  await findVisibleEvent(db, actor, eventId);
  return db.transaction(async (tx) => {
    await lockVisibleEvent(tx, actor, eventId);
    const [version] = await tx.select({ proposalId: proposalVersions.proposalId }).from(proposalVersions).where(eq(proposalVersions.id, input.proposalVersionId));
    const [proposal] = version ? await tx.select({ eventId: proposals.eventId }).from(proposals).where(eq(proposals.id, version.proposalId)) : [];
    if (proposal?.eventId !== eventId) throw notFound("Proposal version");
    const [approved] = await tx.select({ id: approvalRequests.id }).from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, "proposal_version"), eq(approvalRequests.subjectId, input.proposalVersionId), eq(approvalRequests.status, "approved")));
    if (!approved) throw new ApiError(409, "APPROVAL_REQUIRED", "Approve the revised proposal before recording an addendum.");
    const [contract] = await tx.select({ id: contracts.id }).from(contracts).where(eq(contracts.eventId, eventId));
    if (!contract) throw new ApiError(409, "CONTRACT_REQUIRED", "Record a signed contract before an addendum.");
    const changes = await tx.select({ id: proposalChangeLog.id }).from(proposalChangeLog).where(eq(proposalChangeLog.versionId, input.proposalVersionId));
    if (input.changeIds.some((id) => !changes.some((change) => change.id === id)))
      throw new ApiError(400, "INVALID_CHANGE", "Choose changes from this proposal version.");
    const [row] = await tx.insert(addendums).values({ eventId, proposalId: version!.proposalId, proposalVersionId: input.proposalVersionId,
      changeIds: input.changeIds, sentAt: new Date(input.sentAt), createdBy: actor.userId, updatedBy: actor.userId }).returning();
    await writeAudit(tx, actor, { entityType: "addendum", entityId: row.id, action: "create", before: null, after: addendumView(row) });
    return addendumView(row);
  });
}
export async function signAddendum(db: Db, actor: Actor, eventId: string, id: string, signedAt: string) {
  await findVisibleEvent(db, actor, eventId);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(addendums).where(and(eq(addendums.id, id), eq(addendums.eventId, eventId))).for("update");
    if (!row) throw notFound("Addendum");
    if (row.signedAt) throw new ApiError(409, "ALREADY_SIGNED", "This addendum is already signed.");
    const [updated] = await tx.update(addendums).set({ signedAt: new Date(signedAt), updatedBy: actor.userId }).where(eq(addendums.id, id)).returning();
    await writeAudit(tx, actor, { entityType: "addendum", entityId: id, action: "update", before: addendumView(row), after: addendumView(updated) });
    return addendumView(updated);
  });
}

export async function emitAddendumReminders(db: Db, now = new Date()) {
  const [setting] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(setting?.value);
  const days = parsed.success ? parsed.data.addendumReminderDays : defaultBusinessDefaults.addendumReminderDays;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const due = await db.select().from(addendums).where(and(isNull(addendums.signedAt), isNull(addendums.reminderSentAt), lte(addendums.sentAt, cutoff)));
  let count = 0;
  for (const addendum of due) await db.transaction(async (tx) => {
    const [row] = await tx.select().from(addendums).where(eq(addendums.id, addendum.id)).for("update");
    if (!row || row.signedAt || row.reminderSentAt) return;
    const [event] = await tx.select({ assignedSalespersonId: events.assignedSalespersonId, title: events.title }).from(events).where(eq(events.id, row.eventId));
    if (!event?.assignedSalespersonId) return;
    await tx.update(addendums).set({ reminderSentAt: now }).where(eq(addendums.id, row.id));
    await emitDomainEvent(tx, { name: "addendum.reminder", entityId: row.id,
      idempotencyKey: `addendum.reminder:${row.id}`, data: { recipientIds: [event.assignedSalespersonId],
        title: `Unsigned addendum: ${event.title}`, body: `Sent ${row.sentAt.toISOString().slice(0, 10)} and still unsigned.`, link: `/events/${row.eventId}` } });
    count++;
  });
  return count;
}
