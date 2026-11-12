CREATE TABLE "readiness_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"signature" text NOT NULL,
	"state" text NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"responded_by" uuid NOT NULL,
	"responded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "readiness_responses_state_check" CHECK ("readiness_responses"."state" in ('answered', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "readiness_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_responses_event_key_idx" ON "readiness_responses" USING btree ("event_id","check_key");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'production_urgent', 'offline_reminder', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'production_urgent', 'offline_reminder', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));
--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value", '{urgentNotificationTypes}',
  COALESCE("value"->'urgentNotificationTypes', '[]'::jsonb) || '"production_urgent"'::jsonb)
WHERE "key" = 'defaults' AND NOT COALESCE("value"->'urgentNotificationTypes', '[]'::jsonb) @> '"production_urgent"'::jsonb;
