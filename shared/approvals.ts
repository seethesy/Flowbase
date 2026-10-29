import { z } from "zod";
import { roleSchema } from "./access";
import { id, text, timestamp } from "./schema-primitives";

// Approval workflow engine (FLOW-44): one approval mechanism (design principle 4)
// for rental Master changes, finalized proposals, order lists and BEO approval.
// Each of those modules registers its subject type with the engine
// (worker/records/approvals.ts) and creates requests through it; there are no
// approval tables per module.

export const approvalStatuses = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export const approvalStatusSchema = z.enum(approvalStatuses);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export const approvalStatusLabels: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

// A proposed change to a record, field by field: the value the requester saw and
// the value approval writes. Approving applies exactly these fields, and only
// while every field still holds its `from` value (AC1). Field names and values are
// the subject module's own.
export const changeValueSchema = z.object({
  from: z.unknown(),
  to: z.unknown(),
});
export const proposedChangeSchema = z.record(z.string().min(1).max(100), changeValueSchema);
export type ProposedChange = z.infer<typeof proposedChangeSchema>;

// POST /api/approvals/<id>/approve. The comment is optional.
export const approveInputSchema = z.object({
  comment: text(2000).default(""),
});
// POST /api/approvals/<id>/reject. Rejecting needs a comment saying why (AC2).
export const rejectInputSchema = z.object({
  // A missing comment reads as empty, so it gets the same message.
  comment: text(2000)
    .default("")
    .pipe(z.string().min(1, "Say why it's rejected.")),
});
export type DecisionInput = z.input<typeof approveInputSchema>;

// GET /api/approvals filters.
export const approvalFilterSchema = z.object({
  // The actor's pending-approvals queue: pending requests for their role, or every
  // pending request for Admin.
  queue: z.enum(["true"]).optional(),
  // Requests the actor made.
  mine: z.enum(["true"]).optional(),
  status: approvalStatusSchema.optional(),
  subjectType: text(100).min(1).optional(),
  subjectId: id.optional(),
});
export type ApprovalFilter = z.infer<typeof approvalFilterSchema>;

const person = z.object({ id, name: z.string() });

export const approvalRequestSchema = z.object({
  id,
  // Which module's record this is about, e.g. "rental_change", and its id.
  subjectType: z.string(),
  subjectId: id,
  // What the request is, as the requesting module wrote it.
  summary: z.string(),
  // Where the subject is in the app; null when there is no page for it.
  link: z.string().nullable(),
  // Null when the request approves the subject as a whole (a proposal version,
  // an order list, a BEO) rather than a change to it.
  proposedChange: proposedChangeSchema.nullable(),
  requester: person.nullable(),
  // The role that approves it; Admin can act on any request.
  approverRole: roleSchema,
  status: approvalStatusSchema,
  // The approver's comment, or empty.
  comment: z.string(),
  decidedBy: person.nullable(),
  decidedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  // May approve or reject it now (pending, and the approver role or Admin).
  canDecide: z.boolean(),
  // May withdraw it now (pending, and the requester).
  canWithdraw: z.boolean(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
