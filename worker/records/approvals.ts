import { and, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { Actor, Role } from "../../shared/access";
import {
  proposedChangeSchema,
  type ApprovalFilter,
  type ApprovalRequest,
  type ApprovalStatus,
  type ProposedChange,
} from "../../shared/approvals";
import { appPathSchema } from "../../shared/notifications";
import { writeAudit } from "../audit/log";
import type { DbLike } from "../db/client";
import { approvalRequests, users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { approvalScope, mayDecideApproval } from "../policy";
import { indexBy, keyset, type Page, type PageRequest } from "./paging";

// Approval workflow engine (FLOW-44). Rental Master changes, finalized
// proposals, order lists and BEOs all get approved here (design principle 4):
// each module registers its subject type once and then creates requests with
// requestApproval in the same transaction as its own change.
//
// A request either proposes a change to its subject (field -> { from, to }), which
// approving writes, or approves the subject as a whole (proposedChange null), in
// which case the module's onApproved hook does whatever approval means for it.
// Approving or rejecting is open to the subject's approver role and to Admin
// (AC3); a requester may withdraw their own pending request. Approval runs in one
// transaction: the change, the module's hook, the decision, its audit row and the
// requester's notification all commit together or not at all.

export type ApprovalRow = typeof approvalRequests.$inferSelect;

export type ApprovalSubject = {
  // The role that approves this subject's requests. Admin can act on any.
  approverRole: Role;
  // For change requests: the subject's current value of each field, read with a
  // row lock in the approving transaction, as JSON values (cents as integers,
  // times as ISO strings) so they compare with the stored `from` values. Null
  // when the subject no longer exists.
  readFields?: (
    tx: DbLike,
    subjectId: string,
    fields: string[],
  ) => Promise<Record<string, unknown> | null>;
  // For change requests: writes the approved values (each field's `to`).
  applyChange?: (
    tx: DbLike,
    actor: Actor,
    subjectId: string,
    values: Record<string, unknown>,
    request: ApprovalRow,
  ) => Promise<void>;
  // Run in the deciding transaction, after the change is applied.
  onApproved?: (tx: DbLike, actor: Actor, request: ApprovalRow) => Promise<void>;
  onRejected?: (tx: DbLike, actor: Actor, request: ApprovalRow) => Promise<void>;
  onWithdrawn?: (tx: DbLike, actor: Actor, request: ApprovalRow) => Promise<void>;
};

const subjects = new Map<string, ApprovalSubject>();

// Called once by each module, at import time.
export function registerApprovalSubject(type: string, subject: ApprovalSubject) {
  if (subjects.has(type))
    throw new Error(`Approval subject "${type}" is already registered.`);
  subjects.set(type, subject);
}

function subjectOf(type: string) {
  const subject = subjects.get(type);
  if (!subject) throw new Error(`Approval subject "${type}" is not registered.`);
  return subject;
}

// Requests the actor made, requests their role approves, and everything for Admin.
export function visibleApprovals(actor: Actor): SQL | undefined {
  if (approvalScope(actor) === "all") return undefined;
  return or(
    eq(approvalRequests.requesterId, actor.userId),
    eq(approvalRequests.approverRole, actor.role),
  );
}

export const mayDecide = (actor: Actor, row: ApprovalRow) =>
  row.status === "pending" && mayDecideApproval(actor, row.approverRole);
export const mayWithdraw = (actor: Actor, row: ApprovalRow) =>
  row.status === "pending" && row.requesterId === actor.userId;

const snapshot = (row: ApprovalRow) => ({
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  summary: row.summary,
  link: row.link,
  proposedChange: row.proposedChange,
  requesterId: row.requesterId,
  approverRole: row.approverRole,
  status: row.status,
  comment: row.comment,
  decidedBy: row.decidedBy,
  decidedAt: row.decidedAt?.toISOString() ?? null,
});

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export type NewApprovalRequest = {
  subjectType: string;
  subjectId: string;
  // One line saying what is asked, e.g. "Price of Chiavari chairs: $8.00 → $9.00".
  summary: string;
  // The subject's page in the app, for the queue and the notifications.
  link?: string | null;
  proposedChange?: ProposedChange | null;
};

// Creates a pending request inside the caller's transaction and tells the
// approvers. Returns its id. The module checks that the actor may ask for it.
export async function requestApproval(
  tx: DbLike,
  actor: Actor,
  input: NewApprovalRequest,
): Promise<string> {
  const subject = subjectOf(input.subjectType);
  let proposedChange: ProposedChange | null = null;
  if (input.proposedChange) {
    if (!subject.readFields || !subject.applyChange)
      throw new Error(
        `Approval subject "${input.subjectType}" does not take changes.`,
      );
    proposedChange = proposedChangeSchema.parse(input.proposedChange);
    if (!Object.keys(proposedChange).length)
      throw new ApiError(400, "INVALID_REQUEST", "The request changes nothing.");
  }
  const [row] = await tx
    .insert(approvalRequests)
    .values({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      summary: clip(input.summary.trim(), 500),
      // A path inside the app, as notifications require.
      link: appPathSchema.nullable().parse(input.link ?? null),
      proposedChange,
      requesterId: actor.userId,
      approverRole: subject.approverRole,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();
  await writeAudit(tx, actor, {
    entityType: "approval_request",
    entityId: row.id,
    action: "create",
    before: null,
    after: snapshot(row),
  });
  const approvers = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, subject.approverRole),
        eq(users.status, "active"),
        isNull(users.archivedAt),
        ne(users.id, actor.userId),
      ),
    );
  const [requester] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actor.userId));
  await emitDomainEvent(tx, {
    name: "approval.requested",
    entityId: row.id,
    idempotencyKey: `approval.requested:${row.id}`,
    data: {
      recipientIds: approvers.map((approver) => approver.id),
      title: clip(`Approval needed: ${row.summary}`, 200),
      body: `${requester?.name || "Someone"} asked for your approval.`,
      link: row.link,
    },
  });
  return row.id;
}

async function lockRequest(tx: DbLike, actor: Actor, id: string) {
  const [row] = await tx
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, id), visibleApprovals(actor)))
    .for("update");
  if (!row) throw notFound("Approval request");
  return row;
}

function requirePending(row: ApprovalRow) {
  if (row.status !== "pending")
    throw new ApiError(
      409,
      "APPROVAL_CLOSED",
      `This request is already ${row.status}, so it can't change.`,
    );
}

// The same JSON value, whatever the key order; a missing value counts as null.
function canonical(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

// AC1: approving writes exactly the proposed values, and only while every field
// still holds the value the request was made from. Otherwise nothing is written
// and the request stays pending, so the approver can reject it.
async function applyProposedChange(
  tx: DbLike,
  actor: Actor,
  subject: ApprovalSubject,
  row: ApprovalRow,
  change: ProposedChange,
) {
  const fields = Object.keys(change);
  const current = await subject.readFields!(tx, row.subjectId, fields);
  const changed =
    !current ||
    fields.some((field) => canonical(current[field]) !== canonical(change[field].from));
  if (changed)
    throw new ApiError(
      409,
      "APPROVAL_CONFLICT",
      current
        ? "The record changed after this request was made, so the request can't be applied. Reject it, and ask for a new one if the change is still wanted."
        : "The record no longer exists, so this request can't be applied. Reject it.",
    );
  await subject.applyChange!(
    tx,
    actor,
    row.subjectId,
    Object.fromEntries(fields.map((field) => [field, change[field].to])),
    row,
  );
}

async function close(
  tx: DbLike,
  actor: Actor,
  row: ApprovalRow,
  status: Exclude<ApprovalStatus, "pending">,
  comment: string,
) {
  const [after] = await tx
    .update(approvalRequests)
    .set({
      status,
      comment,
      decidedBy: actor.userId,
      decidedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(eq(approvalRequests.id, row.id))
    .returning();
  await writeAudit(tx, actor, {
    entityType: "approval_request",
    entityId: row.id,
    action: "update",
    before: snapshot(row),
    after: snapshot(after),
  });
  return after;
}

// Approves or rejects a pending request (AC1-AC3) and tells the requester.
export async function decideApproval(
  tx: DbLike,
  actor: Actor,
  id: string,
  decision: "approve" | "reject",
  comment: string,
) {
  const row = await lockRequest(tx, actor, id);
  requirePending(row);
  if (!mayDecide(actor, row)) throw forbidden();
  const subject = subjectOf(row.subjectType);
  if (decision === "approve") {
    if (row.proposedChange)
      await applyProposedChange(tx, actor, subject, row, row.proposedChange);
    await subject.onApproved?.(tx, actor, row);
  } else {
    // AC2: rejecting writes nothing to the subject.
    await subject.onRejected?.(tx, actor, row);
  }
  const after = await close(
    tx,
    actor,
    row,
    decision === "approve" ? "approved" : "rejected",
    comment,
  );
  if (after.requesterId && after.requesterId !== actor.userId)
    await emitDomainEvent(tx, {
      name: "approval.decided",
      entityId: after.id,
      idempotencyKey: `approval.decided:${after.id}`,
      data: {
        recipientIds: [after.requesterId],
        title: clip(
          `${after.status === "approved" ? "Approved" : "Rejected"}: ${after.summary}`,
          200,
        ),
        body: clip(comment, 1000),
        link: after.link,
      },
    });
  return after;
}

// The requester takes back a pending request. Nothing is applied.
export async function withdrawApproval(tx: DbLike, actor: Actor, id: string) {
  const row = await lockRequest(tx, actor, id);
  requirePending(row);
  if (!mayWithdraw(actor, row)) throw forbidden();
  await subjectOf(row.subjectType).onWithdrawn?.(tx, actor, row);
  return close(tx, actor, row, "withdrawn", "");
}

async function toApprovals(
  db: DbLike,
  actor: Actor,
  rows: ApprovalRow[],
): Promise<ApprovalRequest[]> {
  const ids = [
    ...new Set(
      rows.flatMap((row) => [row.requesterId, row.decidedBy]).filter((id): id is string => id !== null),
    ),
  ];
  const people = indexBy(
    ids.length
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ids))
      : [],
    (person) => person.id,
  );
  const person = (id: string | null) =>
    id ? (people.get(id) ?? { id, name: "" }) : null;
  return rows.map((row) => ({
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    summary: row.summary,
    link: row.link,
    proposedChange: row.proposedChange ?? null,
    requester: person(row.requesterId),
    approverRole: row.approverRole,
    status: row.status,
    comment: row.comment,
    decidedBy: person(row.decidedBy),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canDecide: mayDecide(actor, row),
    canWithdraw: mayWithdraw(actor, row),
  }));
}

export async function getApproval(
  db: DbLike,
  actor: Actor,
  id: string,
): Promise<ApprovalRequest> {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, id), visibleApprovals(actor)));
  if (!row) throw notFound("Approval request");
  const [approval] = await toApprovals(db, actor, [row]);
  return approval;
}

// The pending-approvals queue (oldest first) or any other list of the requests
// the actor can see (newest first).
export async function listApprovalsPage(
  db: DbLike,
  actor: Actor,
  filter: ApprovalFilter,
  page: PageRequest = {},
): Promise<Page<ApprovalRequest>> {
  const newestFirst = !filter.queue;
  const paging = keyset<ApprovalRow>(
    [
      {
        column: approvalRequests.createdAt,
        type: "timestamp",
        desc: newestFirst,
        of: (row) => row.createdAt,
      },
      {
        column: approvalRequests.id,
        type: "uuid",
        desc: newestFirst,
        of: (row) => row.id,
      },
    ],
    page,
  );
  const rows = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        visibleApprovals(actor),
        filter.queue
          ? and(
              eq(approvalRequests.status, "pending"),
              approvalScope(actor) === "all"
                ? undefined
                : eq(approvalRequests.approverRole, actor.role),
            )
          : undefined,
        filter.mine ? eq(approvalRequests.requesterId, actor.userId) : undefined,
        filter.status ? eq(approvalRequests.status, filter.status) : undefined,
        filter.subjectType
          ? eq(approvalRequests.subjectType, filter.subjectType)
          : undefined,
        filter.subjectId
          ? eq(approvalRequests.subjectId, filter.subjectId)
          : undefined,
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => toApprovals(db, actor, kept));
}
