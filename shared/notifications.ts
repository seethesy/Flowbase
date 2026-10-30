import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";

// Notifications (FLOW-43, ADR-12): things that need someone's attention, shown in
// the app and, unless the person turns it off per type, sent by email. Each type
// is triggered by one domain event (worker/notifications/fanout.ts). Business
// settings mark types as urgent; the SMS channel (FLOW-52) reads that flag.

export const notificationTypes = [
  "task_assigned",
  "task_claimed",
  "task_due_soon",
  "task_due",
  "task_completed",
  "lead_assigned",
  "staff_assigned",
  "staff_unassigned",
  "approval_requested",
  "approval_decided",
  "inventory_conflict",
  "production_alert",
  "proposal_approved",
  "payment_due",
  "payment_overdue",
  "collector_failure",
] as const;
export const notificationTypeSchema = z.enum(notificationTypes);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export type NotificationTypeInfo = {
  label: string;
  description: string;
  // The domain event (FLOW-27) that creates it.
  event: string;
};
export const notificationCatalog: Record<NotificationType, NotificationTypeInfo> = {
  task_assigned: {
    label: "Task assigned",
    description: "A task is assigned to you, or reassigned from you to someone else.",
    event: "task.assigned",
  },
  task_claimed: {
    label: "Task claimed",
    description: "Someone claims a task you oversee.",
    event: "task.claimed",
  },
  task_due_soon: {
    label: "Task due soon",
    description: "A task you're assigned to is due within a day.",
    event: "task.due_soon",
  },
  task_due: {
    label: "Task overdue",
    description: "A task you're assigned to or oversee is past its due time.",
    event: "task.due",
  },
  task_completed: {
    label: "Task completed",
    description: "A task you oversee or created is marked done.",
    event: "task.completed",
  },
  lead_assigned: {
    label: "Lead assigned",
    description: "A lead is assigned to you.",
    event: "lead.assigned",
  },
  staff_assigned: {
    label: "Event staff assignment",
    description: "You're assigned to a shift on an event's staff roster.",
    event: "event.staff_assigned",
  },
  staff_unassigned: {
    label: "Removed from event staff",
    description: "A manager chooses to tell you that you were removed from a shift.",
    event: "event.staff_unassigned",
  },
  approval_requested: {
    label: "Approval requested",
    description: "Something is waiting for your approval.",
    event: "approval.requested",
  },
  approval_decided: {
    label: "Approval decided",
    description: "A request you made is approved or rejected.",
    event: "approval.decided",
  },
  inventory_conflict: {
    label: "Inventory conflict",
    description: "Items are double-booked or short for an event.",
    event: "inventory.conflict_detected",
  },
  production_alert: {
    label: "Production alert",
    description: "An event's production needs attention.",
    event: "production.alert_raised",
  },
  proposal_approved: {
    label: "Proposal approved",
    description: "A proposal is approved.",
    event: "proposal.approved",
  },
  payment_due: {
    label: "Payment due",
    description: "A client payment is coming due.",
    event: "payment.due",
  },
  payment_overdue: {
    label: "Payment overdue",
    description: "A client payment is past due.",
    event: "payment.overdue",
  },
  collector_failure: {
    label: "Lead collector failure",
    description: "The lead collector stopped collecting from a site.",
    event: "collector.failed",
  },
};

// A path inside the app (hash routing), e.g. "/events/<id>". Never a full URL, so
// a notification can't send anyone off-site.
export const appPathSchema = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/, "Use a path inside the app.");

// What an event emitted for the generic notification types must carry in its
// data. The producing module decides who is told and what they read; FLOW-43
// stores, de-duplicates and delivers it. Task and staff events are read in
// their own shape instead (see worker/notifications/fanout.ts).
export const notifyPayloadSchema = z.object({
  recipientIds: z.array(id).max(200),
  title: text(200).min(1),
  body: text(1000).default(""),
  link: appPathSchema.nullable().default(null),
});
export type NotifyPayload = z.input<typeof notifyPayloadSchema>;

export const notificationSchema = z.object({
  id,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  // Where opening it goes in the app; null when there is no record to show.
  link: z.string().nullable(),
  readAt: timestamp.nullable(),
  createdAt: timestamp,
});
export type Notification = z.infer<typeof notificationSchema>;

// GET /api/notifications: the newest notifications and how many are unread.
export const NOTIFICATION_INBOX_SIZE = 50;
export const notificationInboxSchema = z.object({
  unreadCount: z.number().int().min(0),
  notifications: z.array(notificationSchema),
});
export type NotificationInbox = z.infer<typeof notificationInboxSchema>;

// GET/PUT /api/notifications/preferences: email on or off per type. In-app
// notifications are always on.
export const notificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  label: z.string(),
  description: z.string(),
  email: z.boolean(),
  // Marked urgent in business settings (sent by SMS too once FLOW-52 lands).
  urgent: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;
export const notificationPreferencesInputSchema = z.object({
  email: z.partialRecord(notificationTypeSchema, z.boolean()),
});
export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesInputSchema
>;
