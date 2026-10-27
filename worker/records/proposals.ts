import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import { DOWNLOAD_URL_SECONDS, UPLOAD_URL_SECONDS } from "../../shared/attachments";
import {
  manualProposalTargets,
  proposalStageLabels,
  uploadableProposalStages,
  type Proposal,
  type ProposalDetail,
  type ProposalStage,
  type ProposalStageChangeEntry,
  type ProposalUploadTicket,
  type ProposalVersion,
  type proposalCreateSchema,
  type proposalInputSchema,
  type proposalStageChangeSchema,
  type proposalUploadSchema,
} from "../../shared/proposals";
import { fileStorage } from "../attachments/storage";
import { writeAudit } from "../audit/log";
import type { Bindings } from "../bindings";
import type { Db, DbLike } from "../db/client";
import {
  events,
  proposals,
  proposalStageHistory,
  proposalVersions,
  users,
  type ProposalFile,
} from "../db/schema";
import { ApiError, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { eventScope } from "../policy";
import { advanceEventStatus, findVisibleEvent } from "./events";
import { indexBy } from "./paging";

// Proposals (FLOW-122) and their versions (FLOW-123). A proposal belongs to one
// event and is visible to whoever can open that event and read proposals.
type ProposalRow = typeof proposals.$inferSelect;

async function userNames(db: DbLike, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const rows = wanted.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, wanted))
    : [];
  return indexBy(rows, (row) => row.id);
}

async function toProposals(db: DbLike, rows: ProposalRow[]): Promise<Proposal[]> {
  if (!rows.length) return [];
  const versionIds = rows
    .map((row) => row.currentVersionId)
    .filter((id): id is string => !!id);
  const [names, current] = await Promise.all([
    userNames(
      db,
      rows.map((row) => row.assignedSalespersonId),
    ),
    versionIds.length
      ? db
          .select({ id: proposalVersions.id, number: proposalVersions.number })
          .from(proposalVersions)
          .where(inArray(proposalVersions.id, versionIds))
      : Promise.resolve([]),
  ]);
  const numberOf = indexBy(current, (row) => row.id);
  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    clientId: row.clientId,
    title: row.title,
    assignedSalesperson: row.assignedSalespersonId
      ? (names.get(row.assignedSalespersonId) ?? {
          id: row.assignedSalespersonId,
          name: "",
        })
      : null,
    notes: row.notes,
    stage: row.stage,
    lostReason: row.lostReason,
    currentVersion:
      (row.currentVersionId && numberOf.get(row.currentVersionId)?.number) ||
      null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

// The proposal as an audit snapshot (FLOW-41): the salesperson by id.
async function proposalSnapshot(db: DbLike, id: string) {
  const [row] = await db.select().from(proposals).where(eq(proposals.id, id));
  const [proposal] = await toProposals(db, [row]);
  const snapshot: Record<string, unknown> = {
    ...proposal,
    assignedSalespersonId: row.assignedSalespersonId,
  };
  delete snapshot.assignedSalesperson;
  return snapshot;
}

export async function findVisibleProposal(db: DbLike, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), isNull(proposals.archivedAt)));
  if (!row) throw notFound("Proposal");
  // An event the actor can't open hides its proposals too.
  await findVisibleEvent(db, actor, row.eventId).catch((error: unknown) => {
    throw error instanceof ApiError && error.status === 404
      ? notFound("Proposal")
      : error;
  });
  return row;
}

// The event's proposals, oldest first.
export async function listProposals(
  db: Db,
  actor: Actor,
  eventId: string,
): Promise<Proposal[]> {
  await findVisibleEvent(db, actor, eventId);
  const rows = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.eventId, eventId), isNull(proposals.archivedAt)))
    .orderBy(asc(proposals.createdAt), asc(proposals.id));
  return toProposals(db, rows);
}

const file = async (
  storage: ReturnType<typeof fileStorage>,
  stored: ProposalFile,
  now: Date,
) => ({
  fileName: stored.fileName,
  size: stored.size,
  url: await storage.downloadUrl(stored.key, DOWNLOAD_URL_SECONDS, now),
});

// One proposal with its versions and stage history, both newest first. Download
// links are signed only when there is a version to download.
export async function getProposal(
  db: DbLike,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  now = new Date(),
): Promise<ProposalDetail> {
  const row = await findVisibleProposal(db, actor, id);
  const [[proposal], versions, history] = await Promise.all([
    toProposals(db, [row]),
    db
      .select()
      .from(proposalVersions)
      .where(
        and(
          eq(proposalVersions.proposalId, id),
          eq(proposalVersions.status, "ready"),
        ),
      )
      .orderBy(desc(proposalVersions.number)),
    db
      .select()
      .from(proposalStageHistory)
      .where(eq(proposalStageHistory.proposalId, id))
      .orderBy(desc(proposalStageHistory.createdAt), desc(proposalStageHistory.id)),
  ]);
  const names = await userNames(db, [
    ...versions.map((version) => version.createdBy),
    ...history.map((change) => change.createdBy),
  ]);
  const person = (userId: string | null) =>
    userId ? (names.get(userId) ?? { id: userId, name: "" }) : null;
  const storage = versions.length ? fileStorage(env) : undefined;
  return {
    ...proposal,
    versions: storage
      ? await Promise.all(
          versions.map(
            async (version): Promise<ProposalVersion> => ({
              id: version.id,
              number: version.number!,
              docx: await file(storage, version.docx, now),
              pdf: version.pdf ? await file(storage, version.pdf, now) : null,
              uploadedBy: person(version.createdBy),
              uploadedAt: version.completedAt!.toISOString(),
              current: version.id === row.currentVersionId,
            }),
          ),
        )
      : [],
    history: history.map(
      (change): ProposalStageChangeEntry => ({
        id: change.id,
        from: change.fromStage,
        to: change.toStage,
        reason: change.reason,
        manual: change.manual,
        actor: person(change.createdBy),
        at: change.createdAt.toISOString(),
      }),
    ),
    urlsExpireAt: storage
      ? new Date(now.getTime() + DOWNLOAD_URL_SECONDS * 1000).toISOString()
      : null,
  };
}

// The salesperson a proposal is assigned to: whoever the caller names when they
// see every event, otherwise the caller (a salesperson works their own events).
const salespersonFor = (
  actor: Actor,
  named: string | null | undefined,
  fallback: string | null,
) =>
  eventScope(actor) === "all"
    ? named === undefined
      ? fallback
      : named
    : actor.userId;

// Inserts the proposal in Client communication, its first stage history row, its
// audit row and proposal.created inside the caller's transaction (lead conversion
// shares it, FLOW-163); returns the new id.
export async function insertProposal(
  tx: DbLike,
  actor: Actor,
  input: {
    eventId: string;
    clientId: string;
    title: string;
    assignedSalespersonId: string | null;
    notes: string;
  },
): Promise<string> {
  const [row] = await tx
    .insert(proposals)
    .values({
      ...input,
      stage: "client_communication",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: proposals.id });
  await tx.insert(proposalStageHistory).values({
    proposalId: row.id,
    fromStage: null,
    toStage: "client_communication",
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  await writeAudit(tx, actor, {
    entityType: "proposal",
    entityId: row.id,
    action: "create",
    before: null,
    after: await proposalSnapshot(tx, row.id),
  });
  await emitDomainEvent(tx, {
    name: "proposal.created",
    entityId: row.id,
    data: { eventId: input.eventId },
  });
  return row.id;
}

export async function createProposal(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  input: z.output<typeof proposalCreateSchema>,
): Promise<ProposalDetail> {
  const event = await findVisibleEvent(db, actor, input.eventId);
  const id = await db.transaction((tx) =>
    insertProposal(tx, actor, {
      eventId: event.id,
      clientId: event.clientId,
      title: input.title,
      assignedSalespersonId: salespersonFor(
        actor,
        input.assignedSalespersonId,
        event.assignedSalespersonId,
      ),
      notes: input.notes,
    }),
  );
  return getProposal(db, actor, env, id);
}

export async function updateProposal(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  input: z.output<typeof proposalInputSchema>,
): Promise<ProposalDetail> {
  const current = await findVisibleProposal(db, actor, id);
  await db.transaction(async (tx) => {
    const before = await proposalSnapshot(tx, id);
    await tx
      .update(proposals)
      .set({
        title: input.title,
        notes: input.notes,
        assignedSalespersonId: salespersonFor(
          actor,
          input.assignedSalespersonId,
          current.assignedSalespersonId,
        ),
        updatedBy: actor.userId,
      })
      .where(eq(proposals.id, id));
    await writeAudit(tx, actor, {
      entityType: "proposal",
      entityId: id,
      action: "update",
      before,
      after: await proposalSnapshot(tx, id),
    });
    await emitDomainEvent(tx, { name: "proposal.updated", entityId: id });
  });
  return getProposal(db, actor, env, id);
}

// Locked so two changes to the same proposal can't both succeed.
async function lockProposal(tx: DbLike, id: string) {
  const [row] = await tx
    .select()
    .from(proposals)
    .where(eq(proposals.id, id))
    .for("update");
  if (!row) throw notFound("Proposal");
  return row;
}

// Every stage change, by hand or by an action, records who, when and why in
// proposal_stage_history, writes the audit row and emits proposal.stage_changed
// (which the sales tracker, FLOW-117, follows), all in the caller's transaction.
async function changeStage(
  tx: DbLike,
  actor: Actor,
  current: ProposalRow,
  change: { to: ProposalStage; reason: string; manual: boolean },
) {
  const { to, reason, manual } = change;
  const before = await proposalSnapshot(tx, current.id);
  await tx
    .update(proposals)
    .set({
      stage: to,
      lostReason: to === "lost" ? reason : current.lostReason,
      updatedBy: actor.userId,
    })
    .where(eq(proposals.id, current.id));
  await tx.insert(proposalStageHistory).values({
    proposalId: current.id,
    fromStage: current.stage,
    toStage: to,
    reason,
    manual,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  await writeAudit(tx, actor, {
    entityType: "proposal",
    entityId: current.id,
    action: "update",
    before,
    after: await proposalSnapshot(tx, current.id),
  });
  await emitDomainEvent(tx, {
    name: "proposal.stage_changed",
    entityId: current.id,
    data: { eventId: current.eventId, from: current.stage, to, reason, manual },
  });
}

// A person moving a proposal (AC1): only between the manual stages, back to
// Revisions, or to Lost with a reason. Losing the event's last open proposal also
// moves the event to Lost (AC2); a signed proposal keeps the event too.
export async function changeProposalStage(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  input: z.output<typeof proposalStageChangeSchema>,
): Promise<ProposalDetail> {
  await findVisibleProposal(db, actor, id);
  await db.transaction(async (tx) => {
    const current = await lockProposal(tx, id);
    if (!manualProposalTargets(current.stage).includes(input.stage))
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        current.stage === input.stage
          ? `The proposal is already ${proposalStageLabels[input.stage]}.`
          : `A ${proposalStageLabels[current.stage]} proposal can't be moved to ${proposalStageLabels[input.stage]}.`,
        { allowed: manualProposalTargets(current.stage) },
      );
    await changeStage(tx, actor, current, {
      to: input.stage,
      reason: input.reason,
      manual: true,
    });
    if (input.stage !== "lost") return;
    const [kept] = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(
        and(
          eq(proposals.eventId, current.eventId),
          ne(proposals.id, id),
          isNull(proposals.archivedAt),
          ne(proposals.stage, "lost"),
        ),
      )
      .limit(1);
    if (kept) return;
    const [event] = await tx
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, current.eventId));
    if (event.status === "finished" || event.status === "lost") return;
    await advanceEventStatus(
      tx,
      current.eventId,
      "lost",
      `Proposal "${current.title}" was lost: ${input.reason}`,
    );
  });
  return getProposal(db, actor, env, id);
}

const uploadRefusal = (stage: ProposalStage) =>
  new ApiError(
    409,
    "INVALID_TRANSITION",
    stage === "sent"
      ? "This proposal was sent. Move it back to Revisions before uploading a new version."
      : `A ${proposalStageLabels[stage]} proposal takes no new versions.`,
  );
const mayUpload = (stage: ProposalStage) =>
  (uploadableProposalStages as readonly ProposalStage[]).includes(stage);

// Starts a version upload (FLOW-123): records it as pending and returns signed PUT
// URLs for the .docx and the optional PDF. Object keys are generated here; file
// names never become storage paths.
export async function startProposalUpload(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  input: z.output<typeof proposalUploadSchema>,
  now = new Date(),
): Promise<ProposalUploadTicket> {
  const storage = fileStorage(env);
  const proposal = await findVisibleProposal(db, actor, id);
  if (!mayUpload(proposal.stage)) throw uploadRefusal(proposal.stage);
  const versionId = crypto.randomUUID();
  const stored = (
    name: "docx" | "pdf",
    picked: { fileName: string; contentType: string; size: number },
  ): ProposalFile => ({
    key: `proposal/${id}/${versionId}/proposal.${name}`,
    fileName: picked.fileName,
    contentType: picked.contentType,
    size: picked.size,
  });
  const docx = stored("docx", input.docx!);
  const pdf = input.pdf ? stored("pdf", input.pdf) : null;
  await db.insert(proposalVersions).values({
    id: versionId,
    proposalId: id,
    docx,
    pdf,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  const files = [
    { name: "docx" as const, file: docx },
    ...(pdf ? [{ name: "pdf" as const, file: pdf }] : []),
  ];
  return {
    versionId,
    uploads: await Promise.all(
      files.map(async ({ name, file }) => ({
        name,
        url: await storage.uploadUrl(
          file.key,
          file.contentType,
          file.size,
          UPLOAD_URL_SECONDS,
          now,
        ),
        headers: { "Content-Type": file.contentType },
      })),
    ),
    expiresAt: new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000).toISOString(),
  };
}

// Completes the upload: with the R2 binding, each file must exist at its declared
// size first. The version takes the next number and becomes current, and the
// proposal moves to Finalized. A ready version is never changed again (AC2).
export async function completeProposalUpload(
  db: Db,
  actor: Actor,
  env: Partial<Bindings>,
  id: string,
  versionId: string,
): Promise<ProposalDetail> {
  await findVisibleProposal(db, actor, id);
  const [version] = await db
    .select()
    .from(proposalVersions)
    .where(
      and(eq(proposalVersions.id, versionId), eq(proposalVersions.proposalId, id)),
    );
  if (!version) throw notFound("Proposal version");
  if (version.status !== "pending")
    throw new ApiError(409, "ALREADY_UPLOADED", "This version was already uploaded.");
  if (env.FILES)
    for (const stored of [version.docx, version.pdf])
      if (stored) {
        const object = await env.FILES.head(stored.key);
        if (object?.size !== stored.size)
          throw notFound(`Uploaded file ${stored.fileName}`);
      }
  await db.transaction(async (tx) => {
    const current = await lockProposal(tx, id);
    if (!mayUpload(current.stage)) throw uploadRefusal(current.stage);
    const [{ last }] = await tx
      .select({ last: sql<number>`coalesce(max(${proposalVersions.number}), 0)::int` })
      .from(proposalVersions)
      .where(eq(proposalVersions.proposalId, id));
    const number = last + 1;
    const ready = await tx
      .update(proposalVersions)
      .set({
        status: "ready",
        number,
        completedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(proposalVersions.id, versionId),
          eq(proposalVersions.status, "pending"),
        ),
      )
      .returning({ id: proposalVersions.id });
    if (!ready.length)
      throw new ApiError(409, "ALREADY_UPLOADED", "This version was already uploaded.");
    const before = await proposalSnapshot(tx, id);
    await tx
      .update(proposals)
      .set({ currentVersionId: versionId, updatedBy: actor.userId })
      .where(eq(proposals.id, id));
    await writeAudit(tx, actor, {
      entityType: "proposal",
      entityId: id,
      action: "update",
      before,
      after: await proposalSnapshot(tx, id),
    });
    await emitDomainEvent(tx, {
      name: "proposal.version_uploaded",
      entityId: id,
      data: { versionId, number },
    });
    if (current.stage !== "finalized")
      await changeStage(
        tx,
        actor,
        { ...current, currentVersionId: versionId },
        { to: "finalized", reason: `Version ${number} uploaded`, manual: false },
      );
  });
  return getProposal(db, actor, env, id);
}
