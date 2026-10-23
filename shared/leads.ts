import { z } from "zod";

// Leads (FLOW-100 inbox, FLOW-111 triage and status, FLOW-112 conversion), shared by
// the API and the app. Every lead source (collector, webhook, manual entry, import)
// writes the same record through createLead on the worker.
const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const timestamp = z.string().datetime();
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a date.");

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

export const leadStatusSchema = z.enum([
  "new",
  "contacted",
  "qualified",
  "converted",
  "lost",
]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;
export const leadStatusLabels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};
// Open leads can still move; converted and lost are final.
export const openLeadStatuses = ["new", "contacted", "qualified"] as const;
export const isOpenLeadStatus = (status: LeadStatus) =>
  (openLeadStatuses as readonly string[]).includes(status);

// new -> contacted -> qualified, and lost from any open status. "converted" is reached
// only through the convert action (FLOW-112), never by a status change.
export const leadStatusTransitions: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["lost"],
  converted: [],
  lost: [],
};

export const lostReasonRequired = "A reason is required when marking a lead lost.";

// The inbox's "needs review" view (F-09-01): no event date, or no way to reach them.
export const leadNeedsReview = (lead: {
  eventDate: string | null;
  email: string;
  phone: string;
}) => lead.eventDate === null || (lead.email.trim() === "" && lead.phone.trim() === "");

const optionalEmail = text(254).refine(
  (value) => value === "" || /^\S+@\S+\.\S+$/.test(value),
  "Enter a valid email address.",
);

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
  email: optionalEmail.default(""),
  phone: text(40).default(""),
  eventDate: localDate.nullable().default(null),
  guestCount: z.number().int().min(0).max(100_000).nullable().default(null),
  location: text(500).default(""),
  eventType: text(100).default(""),
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
    status: z.enum(["contacted", "qualified", "lost"]),
    reason: text(1000).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.status === "lost" && value.reason === "") {
      ctx.addIssue({ code: "custom", path: ["reason"], message: lostReasonRequired });
    }
  });
export type LeadStatusChange = z.input<typeof leadStatusChangeSchema>;

export const leadAssignSchema = z.object({ assignedSalespersonId: id });
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
    // Empty takes "<client> - <event type>".
    title: text(200).default(""),
    // Empty takes the lead's event date.
    date: localDate.optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a start time."),
  }),
});
export type LeadConvertInput = z.input<typeof leadConvertSchema>;

export const leadConversionSchema = z.object({
  lead: leadSchema,
  client: z.object({ id, name: z.string() }),
  event: z.object({ id, title: z.string() }),
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
