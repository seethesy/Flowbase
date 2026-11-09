CREATE TABLE "addendums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"change_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "addendums" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"event_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"client_signer" text NOT NULL,
	"salesperson_signer" text NOT NULL,
	"card_on_file" boolean DEFAULT false NOT NULL,
	"card_last_4" text,
	"attachment_id" uuid
);
--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "proposal_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"proposal_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb
);
--> statement-breakpoint
ALTER TABLE "proposal_change_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "proposal_version_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"version_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "proposal_version_mappings_version_id_unique" UNIQUE("version_id")
);
--> statement-breakpoint
ALTER TABLE "proposal_version_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "planning_stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD COLUMN "sent_method" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "sent_method" text;--> statement-breakpoint
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addendums" ADD CONSTRAINT "addendums_proposal_version_id_proposal_versions_id_fk" FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_version_id_proposal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_change_log" ADD CONSTRAINT "proposal_change_log_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_change_log" ADD CONSTRAINT "proposal_change_log_version_id_proposal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_version_mappings" ADD CONSTRAINT "proposal_version_mappings_version_id_proposal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addendums_event_idx" ON "addendums" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "contracts_event_idx" ON "contracts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "proposal_change_log_proposal_idx" ON "proposal_change_log" USING btree ("proposal_id","created_at");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure'));