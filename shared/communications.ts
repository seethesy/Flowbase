import { z } from "zod";
import { id, localDate, text, timestamp } from "./schema-primitives";

// Client communication log (FLOW-120): every call, email, text, meeting and note
// with a lead, client or event. A next follow-up date creates a task for the
// record's salesperson through the task engine (FLOW-58).
export const communicationKinds = ["call", "email", "text", "meeting", "note"] as const;
export const communicationKindSchema = z.enum(communicationKinds);
export type CommunicationKind = z.infer<typeof communicationKindSchema>;
export const communicationKindLabels: Record<CommunicationKind, string> = {
  call: "Call",
  email: "Email",
  text: "Text",
  meeting: "Meeting",
  note: "Note",
};

export const communicationRecordKinds = ["lead", "client", "event"] as const;
export type CommunicationRecordKind = (typeof communicationRecordKinds)[number];

// A follow-up task is due at the close of this business day (New York time).
export const followUpDueTime = "17:00";

// What a log entry attaches to: exactly one of the three.
export const communicationTargetSchema = z
  .object({
    leadId: id.optional(),
    clientId: id.optional(),
    eventId: id.optional(),
  })
  .refine(
    (target) =>
      [target.leadId, target.clientId, target.eventId].filter(Boolean).length === 1,
    "Choose one lead, client or event.",
  );

export const communicationInputSchema = z
  .object({
    leadId: id.optional(),
    clientId: id.optional(),
    eventId: id.optional(),
    kind: communicationKindSchema,
    // Defaults to now.
    occurredAt: timestamp.optional(),
    summary: text(5000).min(1, "Enter a summary."),
    // A New York date; creates the follow-up task.
    followUpDate: localDate.nullable().default(null),
  })
  .refine(
    (input) =>
      [input.leadId, input.clientId, input.eventId].filter(Boolean).length === 1,
    "Choose one lead, client or event.",
  );
export type CommunicationInput = z.input<typeof communicationInputSchema>;

export const communicationSchema = z.object({
  id,
  leadId: id.nullable(),
  clientId: id.nullable(),
  eventId: id.nullable(),
  kind: communicationKindSchema,
  occurredAt: timestamp,
  summary: z.string(),
  // Who logged it.
  loggedById: id.nullable(),
  loggedByName: z.string(),
  followUpDate: localDate.nullable(),
  followUpTaskId: id.nullable(),
  // Whether the follow-up task is still open.
  followUpOpen: z.boolean(),
  createdAt: timestamp,
});
export type Communication = z.infer<typeof communicationSchema>;
