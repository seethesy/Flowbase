ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_approver_role_check";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_status_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "proposal_stage_history" DROP CONSTRAINT "proposal_stage_history_from_stage_check";--> statement-breakpoint
ALTER TABLE "proposal_stage_history" DROP CONSTRAINT "proposal_stage_history_to_stage_check";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_stage_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_employment_type_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'inquiry';--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "stage" SET DEFAULT 'p_creation';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "event_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notes" jsonb;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "sms" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "secondary_email" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_lead_idx" ON "events" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "employment_type";--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approver_role_check" CHECK ("approval_requests"."approver_role" in ('admin', 'technical', 'sales_manager', 'salesperson', 'kitchen_lead', 'kitchen_staff', 'staff', 'part_time_staff'));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('inquiry', 'pitching', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'lost'));--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK ("notification_preferences"."type" in ('account_email_changed', 'task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'production_urgent', 'offline_reminder', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('account_email_changed', 'task_assigned', 'task_claimed', 'task_due_soon', 'task_due', 'task_completed', 'lead_assigned', 'staff_assigned', 'staff_unassigned', 'event_day_change', 'approval_requested', 'approval_decided', 'inventory_conflict', 'production_alert', 'production_urgent', 'offline_reminder', 'planning_stale', 'proposal_approved', 'addendum_reminder', 'payment_due', 'payment_overdue', 'collector_failure', 'beo_changed'));--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_stage_check" CHECK ("proposals"."stage" in ('inquiry', 'pitching', 'p_creation', 'p_sent', 'negotiation', 'closing', 'closed', 'lost'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'technical', 'sales_manager', 'salesperson', 'kitchen_lead', 'kitchen_staff', 'staff', 'part_time_staff'));
--> statement-breakpoint
UPDATE "events" AS event SET "lead_id" = lead."id"
FROM "leads" AS lead WHERE lead."converted_event_id" = event."id" AND event."lead_id" IS NULL;
--> statement-breakpoint
UPDATE "leads" AS lead SET "event_name" = event."title"
FROM "events" AS event WHERE lead."converted_event_id" = event."id" AND lead."event_name" = '';
