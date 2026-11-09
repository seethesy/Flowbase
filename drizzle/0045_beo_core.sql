CREATE TABLE "beo_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"beo_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"field_label" text NOT NULL,
	"section" text NOT NULL,
	"old_value" text DEFAULT '' NOT NULL,
	"new_value" text DEFAULT '' NOT NULL,
	"changed_by" uuid,
	"marked" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beo_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'working_on' NOT NULL,
	"approval_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"setup_details" text DEFAULT '' NOT NULL,
	"cleanup_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"additional_notes" text DEFAULT '' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "beos_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "beos_status_check" CHECK ("beos"."status" in ('working_on', 'pending_approval', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "beos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "beo_changes" ADD CONSTRAINT "beo_changes_beo_id_beos_id_fk" FOREIGN KEY ("beo_id") REFERENCES "public"."beos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beo_changes" ADD CONSTRAINT "beo_changes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beos" ADD CONSTRAINT "beos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beo_changes_beo_idx" ON "beo_changes" USING btree ("beo_id","created_at");--> statement-breakpoint
CREATE INDEX "beo_changes_event_idx" ON "beo_changes" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));