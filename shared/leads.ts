import { z } from "zod";
import { email, id, localDate, text, timestamp } from "./schema-primitives";
import { pipelineLabels, pipelineStatusSchema, pipelineStatuses } from "./pipeline";
import { sopContentSchema } from "./sops";
import { localTime } from "./core-records";

// Leads (FLOW-100 inbox, FLOW-111 triage and status, FLOW-112 conversion), shared by
// the API and the app. Every lead source (collector, webhook, manual entry, import)
// writes the same record through createLead on the worker.

export const leadChannelSchema = z.enum(["collector", "webhook", "manual", "import"]);
export type LeadChannel = z.infer<typeof leadChannelSchema>;
export const leadChannelLabels: Record<LeadChannel, string> = {
  collector: "Collector",
  webhook: "Webhook",
  manual: "Manual",
  import: "Import",
};

// Sources are free text so the list stays configurable; these are the ones the
// inbox filter and the manual-entry form offer by default.
export const defaultLeadSources = [
  "Bark",
  "Perfect Venue",
  "WeddingPro",
  "Eventective",
  "Thumbtack",
  "Shopify",
  "Referral",
  "Phone",
  "Walk-in",
  "Email inquiry",
  "Other",
] as const;

export const leadStatusSchema = pipelineStatusSchema;
export type LeadStatus = z.infer<typeof leadStatusSchema>;
export const leadStatusLabels = pipelineLabels;
export const openLeadStatuses = pipelineStatuses.filter((status) => status !== "closed" && status !== "lost");
export const isOpenLeadStatus = (status: LeadStatus) =>
  (openLeadStatuses as readonly string[]).includes(status);

// The pipeline stages each sidebar heading's Overview lists (FLOW-328): Leads
// holds getting and pitching leads, Sales closing them. Lost leads sit under
// Leads, shown only when its status filter picks Lost.
export const leadsHeadingStatuses: readonly LeadStatus[] = ["inquiry", "pitching", "p_creation", "p_sent", "lost"];
export const leadsHeadingDefaultStatuses: readonly LeadStatus[] = leadsHeadingStatuses.filter((status) => status !== "lost");
export const salesHeadingStatuses: readonly LeadStatus[] = ["negotiation", "closing", "closed"];

export const leadStatusTransitions: Record<LeadStatus, readonly LeadStatus[]> = Object.fromEntries(
  pipelineStatuses.map((from) => [from, from === "closed" || from === "lost" ? [] :
    pipelineStatuses.filter((to) => to !== from && (to !== "closed" || from === "closing"))]),
) as unknown as Record<LeadStatus, readonly LeadStatus[]>;

export const lostReasonRequired = "A reason is required when marking a lead lost.";

// The inbox's "needs review" view (F-09-01): no event date, or no way to reach them.
export const leadNeedsReview = (lead: {
  eventDate: string | null;
  email: string;
  phone: string;
}) => lead.eventDate === null || (lead.email.trim() === "" && lead.phone.trim() === "");

// What a source hands to createLead. Everything but channel and source may be
// missing; such leads land in "needs review".
export const leadIntakeSchema = z.object({
  channel: leadChannelSchema,
  source: z.string().trim().min(1, "Source is required.").max(100),
  sourceLeadId: text(200).default(""),
  sourceLeadUrl: text(2000).default(""),
  // The contact details were unlocked on the source site (a paid lead).
  purchased: z.boolean().default(false),
  receivedAt: timestamp.optional(),
  name: text(200).default(""),
  email: email.default(""),
  phone: text(40).default(""),
  eventDate: localDate.nullable().default(null),
  guestCount: z.number().int().min(0).max(100_000).nullable().default(null),
  location: text(500).default(""),
  eventType: text(100).default(""),
  eventName: text(200).default(""),
  notes: sopContentSchema.nullable().default(null),
  budgetCents: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  message: text(10_000).default(""),
  rawPayload: z.unknown().optional(),
});
export type LeadIntake = z.input<typeof leadIntakeSchema>;

// Duplicate detection and merge (FLOW-110). Matching order: same source and source
// lead id (the same lead again: it updates the existing lead instead), then email
// or phone, then name and event date.
export const leadDuplicateReasonSchema = z.enum(["email", "phone", "name_event_date"]);
export type LeadDuplicateReason = z.infer<typeof leadDuplicateReasonSchema>;
export const leadDuplicateReasonLabels: Record<LeadDuplicateReason, string> = {
  email: "Same email",
  phone: "Same phone",
  name_event_date: "Same name and event date",
};
// Shown to a salesperson whose lead matches a record they can't see; nothing else
// about the match is returned to them (Q-41c).
export const assignedElsewhereMessage =
  "A possible duplicate is already assigned to another salesperson. Admin will resolve it.";

export const leadSummarySchema = z.object({
  id,
  name: z.string(),
  source: z.string(),
  channel: leadChannelSchema,
  status: leadStatusSchema,
  receivedAt: timestamp,
  eventDate: z.string().nullable(),
  assignedSalespersonId: id.nullable(),
});
export type LeadSummary = z.infer<typeof leadSummarySchema>;

export const leadSourceLinkSchema = z.object({
  leadId: id,
  channel: leadChannelSchema,
  source: z.string(),
  sourceLeadId: z.string(),
  sourceLeadUrl: z.string(),
  receivedAt: timestamp,
  // Set on links that came from a merged lead.
  mergedAt: timestamp.nullable(),
  mergedBy: id.nullable(),
});
export type LeadSourceLink = z.infer<typeof leadSourceLinkSchema>;

// One possible duplicate, seen from one lead: the other lead or a client.
export const leadMatchSchema = z.object({
  duplicateId: id,
  reason: leadDuplicateReasonSchema,
  lead: leadSummarySchema.nullable(),
  client: z.object({ id, name: z.string() }).nullable(),
});
export type LeadMatch = z.infer<typeof leadMatchSchema>;

// An open pair in the duplicates queue. crossOwner: both leads are assigned, to
// different salespeople, so only Admin and the Sales Manager can resolve it.
export const leadDuplicateSchema = z.object({
  id,
  reason: leadDuplicateReasonSchema,
  lead: leadSummarySchema,
  matchedLead: leadSummarySchema.nullable(),
  matchedClient: z.object({ id, name: z.string() }).nullable(),
  crossOwner: z.boolean(),
  createdAt: timestamp,
});
export type LeadDuplicate = z.infer<typeof leadDuplicateSchema>;

export const leadMergeSchema = z.object({ keepLeadId: id });

// A BEO of one of a lead's events (FLOW-264). version counts approvals: an
// approved BEO is at the number of times it was approved; one being worked on
// after N approvals is version N + 1.
export const leadBeoSchema = z.object({
  id,
  eventId: id,
  version: z.number().int().min(1),
  status: z.enum(["working_on", "pending_approval", "approved"]),
});
export type LeadBeo = z.infer<typeof leadBeoSchema>;

export const leadSchema = z.object({
  id,
  receivedAt: timestamp,
  channel: leadChannelSchema,
  source: z.string(),
  sourceLeadId: z.string(),
  sourceLeadUrl: z.string(),
  purchased: z.boolean(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  eventDate: z.string().nullable(),
  guestCount: z.number().nullable(),
  location: z.string(),
  eventType: z.string(),
  budgetCents: z.number().nullable(),
  message: z.string(),
  status: leadStatusSchema,
  eventName: z.string().optional(),
  latestEvent: z.object({ id, title: z.string(), startsAt: timestamp }).nullable().optional(),
  latestProposal: z.object({ id, eventId: id, title: z.string() }).nullable().optional(),
  // FLOW-264: the latest BEO of the lead's events, for the Leads table link.
  latestBeo: leadBeoSchema.nullable().optional(),
  possibleDuplicate: z.boolean().optional(),
  notes: sopContentSchema.nullable().optional(),
  lostReason: z.string(),
  firstRespondedAt: timestamp.nullable(),
  // Seconds from received to the first move to "contacted".
  firstResponseSeconds: z.number().nullable(),
  assignedSalespersonId: id.nullable(),
  convertedClientId: id.nullable(),
  convertedEventId: id.nullable(),
  needsReview: z.boolean(),
  // Debugging payload as received. Present only for FT+ users and only on the detail
  // response; null for everyone else.
  rawPayload: z.unknown().nullable().optional(),
  // Detail response only (FLOW-110): every source record behind this lead, its
  // possible duplicates the caller may see, and whether one is hidden from them.
  sourceLinks: leadSourceLinkSchema.array().optional(),
  duplicates: leadMatchSchema.array().optional(),
  assignedElsewhere: z.boolean().optional(),
  mergedIntoLeadId: id.nullable(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Lead = z.infer<typeof leadSchema>;

export const leadStatusChangeSchema = z
  .object({
    status: leadStatusSchema,
    reason: text(1000).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.status === "lost" && value.reason === "") {
      ctx.addIssue({ code: "custom", path: ["reason"], message: lostReasonRequired });
    }
  });
export type LeadStatusChange = z.input<typeof leadStatusChangeSchema>;

// Manual entry (FLOW-101): a phone call, referral or walk-in typed in by a user.
// The channel is always manual; a salesperson's lead is assigned to them.
export const leadManualSchema = leadIntakeSchema
  .pick({
    source: true,
    name: true,
    email: true,
    phone: true,
    eventDate: true,
    guestCount: true,
    location: true,
    eventType: true,
    eventName: true,
    notes: true,
    budgetCents: true,
    message: true,
  })
  .extend({ name: text(200).min(1, "Name is required.") });
export type LeadManualInput = z.input<typeof leadManualSchema>;

export const leadAssignSchema = z.object({ assignedSalespersonId: id });
export const leadEventInputSchema = z.object({
  title: text(200).min(1, "Event name is required."),
  date: localDate,
  startTime: localTime,
});
export type LeadEventInput = z.infer<typeof leadEventInputSchema>;
// The lead page's Edit mode (FLOW-334): every stored field the page shows. The
// status moves through POST /:id/status; calculated values (first response,
// needs review, linked events) are never accepted: .strict() answers 400.
export const leadUpdateSchema = z.object({
  name: text(200).optional(),
  email: email.optional(),
  phone: text(40).optional(),
  eventName: text(200).optional(),
  eventDate: localDate.nullable().optional(),
  eventTime: localTime.optional(),
  guestCount: z.number().int().min(0).max(100_000).nullable().optional(),
  eventType: text(100).optional(),
  location: text(500).optional(),
  // Financials: only someone who may see the lead's budget may set it.
  budgetCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  message: text(10_000).optional(),
  source: z.string().trim().min(1, "Source is required.").max(100).optional(),
  channel: leadChannelSchema.optional(),
  receivedAt: timestamp.optional(),
  sourceLeadId: text(200).optional(),
  sourceLeadUrl: z.union([z.literal(""), z.string().trim().url("Enter a full link, starting with https://.").max(2000)]).optional(),
  // Only on a lost lead, and never empty there.
  lostReason: text(1000).optional(),
  notes: sopContentSchema.nullable().optional(),
}).strict();
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
export const leadBulkAssignSchema = z.object({
  leadIds: z.array(id).min(1, "Pick at least one lead.").max(200),
  assignedSalespersonId: id,
});

export const leadConvertSchema = z.object({
  client: z
    .discriminatedUnion("mode", [
      z.object({
        mode: z.literal("create"),
        // Empty takes the lead's name.
        name: text(200).default(""),
        kind: z.enum(["person", "organization"]).default("person"),
        // Set after the user has seen the duplicate warning and chosen to continue.
        allowDuplicate: z.boolean().default(false),
      }),
      z.object({ mode: z.literal("link"), clientId: id }),
    ])
    .default({ mode: "create", name: "", kind: "person", allowDuplicate: false }),
  event: z.object({
    existingEventId: id.optional(),
    // Empty takes "<client> - <event type>".
    title: text(200).default(""),
    // Empty takes the lead's event date.
    date: localDate.optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a start time.").optional(),
  }),
});
export type LeadConvertInput = z.input<typeof leadConvertSchema>;

export const leadConversionSchema = z.object({
  lead: leadSchema,
  client: z.object({ id, name: z.string() }),
  event: z.object({ id, title: z.string() }),
  // The event's first proposal, in Client communication (FLOW-163).
  proposal: z.object({ id, title: z.string() }),
});
export type LeadConversion = z.infer<typeof leadConversionSchema>;

// Lead dashboard (FLOW-113): which sources are worth paying for, over a date range of
// received dates (New York days, inclusive). Money is an estimate until proposals
// exist (FLOW-122): a closed lead counts at its stated budget, or at the average
// budget of the leads in range when it gave none (Ash, 2026-10-23).
export const leadDashboardRowSchema = z.object({
  leads: z.number(),
  converted: z.number(),
  // converted / leads, 0–1; null with no leads.
  conversionRate: z.number().nullable(),
  // Converted leads whose event reached Closed (paid and signed) or later.
  closed: z.number(),
  estimatedClosedCents: z.number(),
  medianFirstResponseSeconds: z.number().nullable(),
  // Open leads nobody has contacted yet (status New).
  awaitingAction: z.number(),
  purchased: z.number(),
});
export type LeadDashboardRow = z.infer<typeof leadDashboardRowSchema>;

export const leadDashboardSchema = z.object({
  from: z.string(),
  to: z.string(),
  // Only Admin, Technical and the Sales Manager see everyone's numbers.
  scope: z.enum(["all", "own"]),
  averageBudgetCents: z.number().nullable(),
  totals: leadDashboardRowSchema,
  bySource: leadDashboardRowSchema
    .extend({
      source: z.string(),
      // False when no lead from the source was purchased: the source has no
      // purchased flag, so purchased vs not isn't shown for it.
      hasPurchased: z.boolean(),
    })
    .array(),
  byChannel: leadDashboardRowSchema.extend({ channel: leadChannelSchema }).array(),
  byStatus: z.object({ status: leadStatusSchema, leads: z.number() }).array(),
  bySalesperson: leadDashboardRowSchema
    .extend({ salespersonId: id.nullable() })
    .array(),
});
export type LeadDashboard = z.infer<typeof leadDashboardSchema>;

