import { z } from "zod";
import { id, timestamp } from "./schema-primitives";

// Automatic activity time tracking (FLOW-119). The browser credits time while a
// Flowbase tab is visible and the user has typed or clicked within the idle cutoff,
// to the record on screen and an activity type derived from the screen.

// 5 minutes (the developer's answer on FLOW-119; the ticket's default was 3). The
// default until business settings load; Admin changes it there (FLOW-45).
export const IDLE_CUTOFF_MS = 5 * 60_000;
// The browser sends at most one tracking request per this interval (free-tier limits).
export const FLUSH_INTERVAL_MS = 60_000;
// A single session can't be longer than this; anything longer is rejected.
export const MAX_SESSION_MS = 12 * 60 * 60_000;

export const activityTypeSchema = z.enum([
  "lead_follow_up",
  "client_work",
  "proposal_work",
  "event_planning",
  "beo_editing",
  "delegating",
  "inventory",
  "kitchen",
  "general",
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;
export const activityLabels: Record<ActivityType, string> = {
  lead_follow_up: "Lead follow-up",
  client_work: "Client work",
  proposal_work: "Proposal work",
  event_planning: "Event planning",
  beo_editing: "BEO editing",
  delegating: "Delegating",
  inventory: "Inventory",
  kitchen: "Kitchen",
  general: "General",
};

// Records time can be credited to. BEOs are listed for when that module stores
// records (FLOW-143); until then nothing credits a BEO.
export const trackedRecordTypeSchema = z.enum([
  "lead",
  "client",
  "proposal",
  "event",
  "beo",
  "task",
]);
export type TrackedRecordType = z.infer<typeof trackedRecordTypeSchema>;

// One stretch of active time on one screen. The browser picks the id and resends
// an open session with a later end, so a session is one row however often it's sent.
export const activitySessionInputSchema = z
  .object({
    id,
    startedAt: timestamp,
    endedAt: timestamp,
    recordType: trackedRecordTypeSchema.nullable().default(null),
    recordId: id.nullable().default(null),
    activity: activityTypeSchema,
  })
  .refine((s) => (s.recordType === null) === (s.recordId === null), {
    message: "A record needs both a type and an id.",
  })
  .refine(
    (s) => {
      const length = Date.parse(s.endedAt) - Date.parse(s.startedAt);
      return length >= 0 && length <= MAX_SESSION_MS;
    },
    {
      message: "A session must end after it starts and last at most 12 hours.",
    },
  );
export type ActivitySessionInput = z.input<typeof activitySessionInputSchema>;
export const activityRecordedSchema = z.object({
  recorded: z.number().int().nonnegative(),
});
// The most sessions one tracking request may carry, the open one included.
export const MAX_BATCH_SESSIONS = 100;
export const activityBatchSchema = z.object({
  sessions: z.array(activitySessionInputSchema).min(1).max(MAX_BATCH_SESSIONS),
});

// Reports (Q-51). Dates are New York dates, inclusive; time is in seconds.
export const effortRowSchema = z.object({
  eventId: id,
  title: z.string(),
  date: z.string(),
  clientName: z.string(),
  seconds: z.number().int(),
  people: z.number().int(),
});
export type EffortRow = z.infer<typeof effortRowSchema>;
// Time on each proposal (FLOW-167); it also counts toward its event's row above.
export const proposalEffortRowSchema = z.object({
  proposalId: id,
  title: z.string(),
  eventId: id,
  eventTitle: z.string(),
  seconds: z.number().int(),
  people: z.number().int(),
});
export type ProposalEffortRow = z.infer<typeof proposalEffortRowSchema>;
export const workloadRowSchema = z.object({
  userId: id,
  userName: z.string().optional(),
  activity: activityTypeSchema,
  seconds: z.number().int(),
});
export type WorkloadRow = z.infer<typeof workloadRowSchema>;
export const timeReportSchema = z.object({
  // "all" for Admin and Sales Manager; everyone else sees only their own time.
  scope: z.enum(["all", "own"]),
  effort: z.array(effortRowSchema),
  proposals: z.array(proposalEffortRowSchema),
  workload: z.array(workloadRowSchema),
});
export type TimeReport = z.infer<typeof timeReportSchema>;
