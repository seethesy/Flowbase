import { z } from "zod";
import { eventStatusSchema } from "./core-records";
import { id, timestamp } from "./schema-primitives";

// The BEOs tab (FLOW-265): every event's BEO the viewer may open, one row each.
// The BEO row stores three states (beoStatuses); the tab shows four. Final means
// the BEO is approved and its event has reached Finished (FLOW-265 A1), so
// nothing new is stored.
export const beoListStatuses = ["draft", "awaiting_approval", "approved", "final"] as const;
export const beoListStatusSchema = z.enum(beoListStatuses);
export type BeoListStatus = z.infer<typeof beoListStatusSchema>;
export const beoListStatusLabels: Record<BeoListStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  final: "Final",
};

export const beoListWhens = ["upcoming", "past", "all"] as const;
export const beoListWhenSchema = z.enum(beoListWhens);
export type BeoListWhen = z.infer<typeof beoListWhenSchema>;
export const beoListWhenLabels: Record<BeoListWhen, string> = {
  upcoming: "Upcoming",
  past: "Past",
  all: "All",
};

// GET /api/beos?when=&status=&owner=
export const beoListQuerySchema = z.object({
  when: beoListWhenSchema.default("upcoming"),
  status: beoListStatusSchema.optional(),
  owner: id.optional(),
});
export type BeoListQuery = z.infer<typeof beoListQuerySchema>;

export const beoListRowSchema = z.object({
  id,
  eventId: id,
  eventTitle: z.string(),
  eventStatus: eventStatusSchema,
  // The event's start, a UTC instant.
  eventStartsAt: timestamp,
  // The approved version count, plus one while a new version is being written
  // (the same rule as the lead page's "BEO v3").
  version: z.number().int().min(1),
  status: beoListStatusSchema,
  guestCount: z.number().int().nullable(),
  owner: z.object({ id, name: z.string() }).nullable(),
  lastEditedBy: z.object({ id, name: z.string() }).nullable(),
  updatedAt: timestamp,
  // The latest approved PDF saved in Documents (FLOW-263), if there is one.
  pdf: z.object({ documentId: id, name: z.string() }).nullable(),
});
export type BeoListRow = z.infer<typeof beoListRowSchema>;

export function beoListStatus(
  beoStatus: "working_on" | "pending_approval" | "approved",
  eventStatus: z.infer<typeof eventStatusSchema>,
): BeoListStatus {
  if (beoStatus === "working_on") return "draft";
  if (beoStatus === "pending_approval") return "awaiting_approval";
  return eventStatus === "finished" ? "final" : "approved";
}
